'use strict';

const { Op } = require('sequelize');
const { Coupon, CouponUsage, CustomerUser, Booking, Trip } = require('../models');
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
        status: 'Active',
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

exports.destroy = async (req, res, next) => {
  try {
    const coupon = await Coupon.findByPk(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    await coupon.destroy();
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (err) { next(err); }
};

exports.validate = async (req, res, next) => {
  try {
    const { code, amount, passenger_id, device_id } = req.body;
    const seatCount = Number(req.body.seat_count || 1);
    if (!Number.isInteger(seatCount) || seatCount < 1) {
      return res.status(400).json({ success: false, message: 'seat_count must be a positive integer' });
    }
    const result = await calculateCouponDiscount({ couponCode: code, amount, seatCount, passengerId: passenger_id, deviceId: device_id });
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, message: 'Valid coupon', data: { coupon: result.coupon, discount: result.discount.toFixed(2), final_amount: (Number(amount) - result.discount).toFixed(2) } });
  } catch (err) { next(err); }
};

exports.usages = async (req, res, next) => {
  try {
    const coupon = await Coupon.findByPk(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const { offset, limit, page } = buildPagination(req.query.page, req.query.limit);
    const { count, rows } = await CouponUsage.findAndCountAll({
      where: { coupon_id: coupon.id },
      include: [
        { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile', 'email'] },
        { model: Booking, as: 'booking', attributes: ['id', 'booking_reference', 'travel_date', 'booking_status', 'payment_status'] },
      ],
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
