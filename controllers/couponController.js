'use strict';

const { Op } = require('sequelize');
const { Coupon, CouponUsage, CustomerUser, Booking, Trip, Payment, Refund, sequelize } = require('../models');
const { releaseBookingReservation } = require('../services/packagePurchaseService');
const { logAction } = require('../middleware/auditLog');
const { calculateCouponDiscount } = require('../utils/coupon');
const { cleanCompletedTripCouponUsagesForPassenger } = require('../services/couponReleaseService');

const buildPagination = (page, limit) => {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit) || 15));
  return { offset: (p - 1) * l, limit: l, page: p };
};

exports.list = async (req, res, next) => {
  try {
    const { page, limit, search, status, code_type } = req.query;
    const { offset, limit: lim, page: p } = buildPagination(page, limit);
    const where = {};
    if (search) where[Op.or] = [{ code: { [Op.like]: `%${search}%` } }, { description: { [Op.like]: `%${search}%` } }];
    if (status) where.status = status;
    if (code_type) where.code_type = code_type;

    const { count, rows } = await Coupon.findAndCountAll({ where, offset, limit: lim, order: [['created_at', 'DESC']] });
    res.json({ success: true, data: rows, pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) } });
  } catch (err) { next(err); }
};

exports.listAvailable = async (req, res, next) => {
  try {
    const { passenger_id, device_id } = req.query;
    const mobile = req.query.passenger_mobile || req.query.mobile;
    const amount = req.query.amount === undefined ? null : Number(req.query.amount);
    const seatCount = req.query.seat_count === undefined ? 1 : Number(req.query.seat_count);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      return res.status(400).json({ success: false, message: 'amount must be a valid non-negative number' });
    }
    if (!Number.isInteger(seatCount) || seatCount < 1) {
      return res.status(400).json({ success: false, message: 'seat_count must be a positive integer' });
    }

    // Resolve passenger ID from either passenger_id or mobile number
    let resolvedPassengerId = passenger_id ? Number(passenger_id) : null;
    if (!resolvedPassengerId && mobile) {
      const customer = await CustomerUser.findOne({ where: { mobile: String(mobile).trim() } });
      if (customer) resolvedPassengerId = customer.id;
    }

    // Automatically clear coupon usages for past trips that are completed where passenger cancelled or didn't board
    if (resolvedPassengerId) {
      try {
        await cleanCompletedTripCouponUsagesForPassenger(resolvedPassengerId);
      } catch (cleanErr) {
        console.warn('[listAvailable] Error clearing completed trip coupon usages:', cleanErr.message);
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const coupons = await Coupon.findAll({
      where: {
        [Op.or]: [{ status: 'Active' }, { status: 'active' }, { status: 'ACTIVE' }],
        [Op.and]: [
          { [Op.or]: [{ start_date: null }, { start_date: { [Op.lte]: today } }] },
          { [Op.or]: [{ end_date: null }, { end_date: { [Op.gte]: today } }] },
        ],
      },
      attributes: ['id', 'code', 'code_type', 'amount', 'min_amount', 'max_discount', 'start_date', 'end_date', 'usage_limit', 'used_count', 'per_user_limit', 'per_device_limit', 'max_seats', 'description'],
      order: [['created_at', 'DESC']],
    });

    const available = await Promise.all(coupons.map(async (coupon) => {
      if (coupon.usage_limit !== null && Number(coupon.used_count) >= Number(coupon.usage_limit)) return null;
      if (amount !== null && amount < Number(coupon.min_amount || 0)) return null;
      if (Number(seatCount) > Number(coupon.max_seats || Number.MAX_SAFE_INTEGER)) return null;

      if (resolvedPassengerId) {
        const userLimit = Number(coupon.per_user_limit || 1);
        const usedByPassenger = await CouponUsage.count({
          where: { coupon_id: coupon.id, passenger_id: resolvedPassengerId },
        });

        // Hide coupon if passenger has already used it and limit reached
        if (usedByPassenger >= userLimit) return null;

        // Also check if passenger has an active booking using this coupon that is not completed
        const activeBooking = await Booking.findOne({
          where: {
            coupon_id: coupon.id,
            passenger_id: resolvedPassengerId,
            booking_status: { [Op.ne]: 'cancelled' },
          },
          include: [{ model: Trip, as: 'trip', required: true }],
        });
        if (activeBooking && activeBooking.trip?.status !== 'Completed') {
          return null; // Hide coupon until usage is cleared
        }
      }

      if (device_id && coupon.per_device_limit !== null && coupon.per_device_limit !== undefined) {
        const usedByDevice = await CouponUsage.count({ where: { coupon_id: coupon.id, device_id: String(device_id).trim() } });
        if (usedByDevice >= Number(coupon.per_device_limit)) return null;
      }
      return coupon;
    }));

    res.json({ success: true, data: available.filter(Boolean) });
  } catch (err) { next(err); }
};

exports.show = async (req, res, next) => {
  try {
    const coupon = await Coupon.findByPk(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, data: coupon });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const payload = normalizeCouponPayload(req.body);
    const exists = await Coupon.findOne({ where: { code: payload.code } });
    if (exists) return res.status(409).json({ success: false, message: 'Coupon code already exists' });
    const coupon = await Coupon.create({ ...payload, created_by: req.user?.id });
    res.status(201).json({ success: true, message: 'Coupon created', data: coupon });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const coupon = await Coupon.findByPk(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const payload = normalizeCouponPayload(req.body);
    const duplicate = await Coupon.findOne({ where: { code: payload.code, id: { [Op.ne]: coupon.id } } });
    if (duplicate) return res.status(409).json({ success: false, message: 'Coupon code already exists' });
    await coupon.update(payload);
    res.json({ success: true, message: 'Coupon updated', data: coupon });
  } catch (err) { next(err); }
};

const cancelBookingRecord = async ({ booking, reason, adminUser, transaction, reqIp }) => {
  const wasSeatAllocated = booking.booking_status === 'confirmed' && booking.payment_status === 'paid';
  const now = new Date();

  await booking.update({
    booking_status: 'cancelled',
    status: 'Cancelled',
    cancellation_reason: reason,
    cancelled_at: now,
    cancelled_by: adminUser?.id || null,
    coupon_id: null,
  }, { transaction });

  await releaseBookingReservation({ bookingId: booking.id, transaction });

  if (booking.trip_id && wasSeatAllocated) {
    const trip = await Trip.findByPk(booking.trip_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (trip) {
      const seatsToFree = Number(booking.total_seats || 1);
      await trip.update({
        booked_seats: Math.max(0, Number(trip.booked_seats || 0) - seatsToFree),
      }, { transaction });
    }
  }

  let refundRecord = null;
  if (booking.payment_status === 'paid' && Number(booking.final_amount) > 0) {
    const passenger = booking.passenger_id
      ? await CustomerUser.findByPk(booking.passenger_id, { transaction })
      : await CustomerUser.findOne({ where: { mobile: booking.passenger_mobile }, transaction });

    const payment = await Payment.findOne({
      where: { booking_id: booking.id, status: ['captured', 'partial_refund'] },
      order: [['created_at', 'DESC']],
      transaction,
    });

    const refundReference = `REF-${Date.now()}-${booking.id}`;
    refundRecord = await Refund.create({
      booking_id: booking.id,
      payment_id: payment?.id || null,
      passenger_id: passenger?.id || booking.passenger_id,
      refund_reference: refundReference,
      refund_amount: booking.final_amount,
      refund_reason: reason,
      status: 'pending',
      initiated_by: adminUser?.id || null,
    }, { transaction });
  }

  try {
    await logAction({
      userId: adminUser?.id,
      userType: adminUser?.role?.name,
      userName: adminUser?.name,
      action: 'cancel',
      module: 'bookings',
      entityType: 'Booking',
      entityId: booking.id,
      newValues: {
        booking_status: 'cancelled',
        cancellation_reason: reason,
      },
      ipAddress: reqIp,
      description: `Auto-cancelled booking ${booking.booking_reference}: ${reason}`,
    });
  } catch (logErr) {
    console.warn('[cancelBookingRecord] Audit log warning:', logErr.message);
  }

  return {
    id: booking.id,
    booking_reference: booking.booking_reference,
    passenger_name: booking.passenger_name,
    passenger_mobile: booking.passenger_mobile,
    refund_created: !!refundRecord,
    refund_amount: refundRecord?.refund_amount || null,
  };
};

exports.destroy = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const coupon = await Coupon.findByPk(req.params.id, { transaction: t });
    if (!coupon) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    // 1. Find all usages to get associated booking IDs and user IDs
    const usages = await CouponUsage.findAll({
      where: { coupon_id: coupon.id },
      transaction: t,
    });
    const usageBookingIds = usages.map((u) => u.booking_id).filter(Boolean);

    // 2. Find all active bookings that used this coupon
    const activeBookings = await Booking.findAll({
      where: {
        [Op.or]: [
          { coupon_id: coupon.id },
          ...(usageBookingIds.length ? [{ id: { [Op.in]: usageBookingIds } }] : []),
        ],
        booking_status: { [Op.notIn]: ['cancelled', 'completed'] },
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const cancellationReason = `Coupon ${coupon.code} was deleted by admin`;
    const cancelledBookings = [];

    for (const booking of activeBookings) {
      const info = await cancelBookingRecord({
        booking,
        reason: cancellationReason,
        adminUser: req.user,
        transaction: t,
        reqIp: req.ip,
      });
      cancelledBookings.push(info);
    }

    // 3. Also clear coupon_id reference from any non-active bookings (completed/cancelled) using this coupon
    await Booking.update({ coupon_id: null }, { where: { coupon_id: coupon.id }, transaction: t });

    // 4. Delete all associated coupon_usages from database
    await CouponUsage.destroy({ where: { coupon_id: coupon.id }, force: true, transaction: t });

    // 5. Delete the coupon itself
    await coupon.destroy({ force: true, transaction: t });

    await t.commit();

    try {
      await logAction({
        userId: req.user?.id,
        userType: req.user?.role?.name,
        userName: req.user?.name,
        action: 'delete',
        module: 'coupons',
        entityType: 'Coupon',
        entityId: coupon.id,
        oldValues: { code: coupon.code, amount: coupon.amount },
        ipAddress: req.ip,
        description: `Deleted coupon ${coupon.code} and auto-cancelled ${cancelledBookings.length} active booking(s)`,
      });
    } catch (logErr) {
      console.warn('[couponController.destroy] Coupon audit log warning:', logErr.message);
    }

    res.json({
      success: true,
      message: `Coupon ${coupon.code} deleted successfully. ${cancelledBookings.length} active booking(s) using this coupon were automatically cancelled.`,
      data: {
        cancelled_bookings_count: cancelledBookings.length,
        cancelled_bookings: cancelledBookings,
      },
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    next(err);
  }
};

exports.deleteUsage = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const usage = await CouponUsage.findByPk(req.params.usageId, { transaction: t });
    if (!usage) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Coupon usage record not found' });
    }

    const couponId = usage.coupon_id;
    const coupon = await Coupon.findByPk(couponId, { transaction: t });
    const couponCode = coupon?.code || `ID #${couponId}`;

    // Find active booking(s) for this user that used this coupon
    const bookingConditions = [];
    if (usage.booking_id) {
      bookingConditions.push({ id: usage.booking_id });
    }
    if (usage.passenger_id) {
      bookingConditions.push({
        passenger_id: usage.passenger_id,
        coupon_id: couponId,
      });
    }

    const activeBookings = bookingConditions.length > 0
      ? await Booking.findAll({
          where: {
            [Op.or]: bookingConditions,
            booking_status: { [Op.notIn]: ['cancelled', 'completed'] },
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        })
      : [];

    const cancellationReason = `Coupon usage for ${couponCode} was deleted by admin`;
    const cancelledBookings = [];

    for (const booking of activeBookings) {
      const info = await cancelBookingRecord({
        booking,
        reason: cancellationReason,
        adminUser: req.user,
        transaction: t,
        reqIp: req.ip,
      });
      cancelledBookings.push(info);
    }

    // Clear coupon_id if this specific booking still has it
    if (usage.booking_id) {
      await Booking.update({ coupon_id: null }, { where: { id: usage.booking_id }, transaction: t });
    }

    // Delete this usage record
    await usage.destroy({ force: true, transaction: t });

    // Decrement coupon used_count or recalculate accurate remaining count
    const remainingCount = await CouponUsage.count({ where: { coupon_id: couponId }, transaction: t });
    if (coupon) {
      await coupon.update({ used_count: remainingCount }, { transaction: t });
    }

    await t.commit();

    try {
      await logAction({
        userId: req.user?.id,
        userType: req.user?.role?.name,
        userName: req.user?.name,
        action: 'delete_usage',
        module: 'coupons',
        entityType: 'CouponUsage',
        entityId: usage.id,
        oldValues: { coupon_id: couponId, passenger_id: usage.passenger_id, booking_id: usage.booking_id },
        ipAddress: req.ip,
        description: `Deleted coupon usage #${usage.id} for passenger ${usage.passenger_id} and auto-cancelled ${cancelledBookings.length} active booking(s)`,
      });
    } catch (logErr) {
      console.warn('[couponController.deleteUsage] Audit log warning:', logErr.message);
    }

    const message = cancelledBookings.length > 0
      ? `Coupon usage deleted successfully and ${cancelledBookings.length} active booking(s) for this user were automatically cancelled.`
      : 'Coupon usage deleted successfully and used count updated.';

    res.json({
      success: true,
      message,
      data: {
        remaining_used_count: remainingCount,
        cancelled_bookings_count: cancelledBookings.length,
        cancelled_bookings: cancelledBookings,
      },
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    next(err);
  }
};

exports.validate = async (req, res, next) => {
  try {
    const { code, amount, passenger_id, device_id, passenger_mobile, mobile } = req.body;
    const seatCount = Number(req.body.seat_count || 1);
    if (!Number.isInteger(seatCount) || seatCount < 1) {
      return res.status(400).json({ success: false, message: 'seat_count must be a positive integer' });
    }
    const result = await calculateCouponDiscount({
      couponCode: code,
      amount,
      seatCount,
      passengerId: passenger_id,
      passengerMobile: passenger_mobile || mobile,
      deviceId: device_id,
    });
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, message: 'Valid coupon', data: { coupon: result.coupon, discount: result.discount.toFixed(2), final_amount: (Number(amount) - result.discount).toFixed(2) } });
  } catch (err) { next(err); }
};

exports.usages = async (req, res, next) => {
  try {
    const coupon = await Coupon.findByPk(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const { offset, limit, page } = buildPagination(req.query.page, req.query.limit);
    const search = req.query.search ? String(req.query.search).trim() : '';

    const where = { coupon_id: coupon.id };
    if (search) {
      where[Op.or] = [
        { '$passenger.name$': { [Op.like]: `%${search}%` } },
        { '$passenger.mobile$': { [Op.like]: `%${search}%` } },
        { '$booking.passenger_name$': { [Op.like]: `%${search}%` } },
        { '$booking.passenger_mobile$': { [Op.like]: `%${search}%` } },
        { '$booking.booking_reference$': { [Op.like]: `%${search}%` } },
        { device_id: { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows } = await CouponUsage.findAndCountAll({
      where,
      include: [
        { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile', 'email'], required: false },
        { model: Booking, as: 'booking', attributes: ['id', 'booking_reference', 'passenger_name', 'passenger_mobile', 'travel_date', 'booking_status', 'payment_status'], required: false },
      ],
      distinct: true,
      offset,
      limit,
      order: [['created_at', 'DESC']],
    });
    res.json({ success: true, data: rows, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } });
  } catch (err) { next(err); }
};

const normalizeCouponPayload = (body) => {
  const code = String(body.code || '').trim().toUpperCase();
  const codeType = String(body.code_type || '').toUpperCase() === 'PERCENT' ? 'PERCENTAGE' : String(body.code_type || '').toUpperCase();
  const amount = Number(body.amount);
  if (!code || !['FLAT', 'PERCENTAGE'].includes(codeType) || !Number.isFinite(amount) || amount <= 0 || (codeType === 'PERCENTAGE' && amount > 100)) {
    const error = new Error('Enter a valid coupon code and discount amount');
    error.status = 400;
    throw error;
  }
  const optionalNumber = (value) => value === '' || value === null || value === undefined ? null : Number(value);
  const maxDiscount = optionalNumber(body.max_discount);
  const minAmount = optionalNumber(body.min_amount) ?? 0;
  const usageLimit = optionalNumber(body.usage_limit);
  const perUserLimit = optionalNumber(body.per_user_limit) ?? 1;
  const perDeviceLimit = optionalNumber(body.per_device_limit);
  const maxSeats = optionalNumber(body.max_seats);
  const isPositiveIntegerOrNull = (value) => value === null || (Number.isInteger(value) && value > 0);
  if ((maxDiscount !== null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0))
    || !Number.isFinite(minAmount) || minAmount < 0
    || !isPositiveIntegerOrNull(usageLimit)
    || !isPositiveIntegerOrNull(perUserLimit)
    || !isPositiveIntegerOrNull(perDeviceLimit)
    || !isPositiveIntegerOrNull(maxSeats)) {
    const error = new Error('Coupon limits and amounts must be positive valid numbers');
    error.status = 400;
    throw error;
  }
  return {
    ...body,
    code,
    code_type: codeType,
    amount,
    max_discount: maxDiscount,
    min_amount: minAmount,
    usage_limit: usageLimit,
    per_user_limit: perUserLimit,
    per_device_limit: perDeviceLimit,
    max_seats: maxSeats,
  };
};
