'use strict';

const { Op } = require('sequelize');
const { Coupon, CouponUsage } = require('../models');

const getCoupon = async ({ couponId, couponCode, transaction, lock }) => {
  const options = { transaction };
  if (lock && transaction) options.lock = transaction.LOCK.UPDATE;
  if (couponId) return Coupon.findByPk(couponId, options);
  if (couponCode) {
    const code = String(couponCode).trim();
    if (!code) return null;
    return Coupon.findOne({
      ...options,
      where: {
        [Op.or]: [
          { code },
          { code: code.toUpperCase() },
          { code: code.toLowerCase() },
        ],
      },
    });
  }
  return null;
};

const resolvePassengerId = async ({ passengerId, passengerMobile, mobile, transaction }) => {
  if (passengerId) return Number(passengerId);
  const rawMobile = passengerMobile ?? mobile;
  if (!rawMobile) return null;
  const { CustomerUser } = require('../models');
  const customer = await CustomerUser.findOne({
    where: { mobile: String(rawMobile).trim() },
    transaction,
    attributes: ['id'],
  });
  return customer ? Number(customer.id) : null;
};

const calculateCouponDiscount = async ({
  couponId,
  couponCode,
  amount,
  seatCount = 1,
  passengerId,
  passengerMobile,
  mobile,
  deviceId,
  transaction,
  lock = false,
}) => {
  const coupon = await getCoupon({ couponId, couponCode, transaction, lock });
  if (!coupon) return { error: 'Invalid coupon code' };
  if (String(coupon.status || '').trim().toLowerCase() !== 'active') return { error: 'Coupon is not active' };

  const today = new Date().toISOString().slice(0, 10);
  if (coupon.start_date && today < coupon.start_date) return { error: 'Coupon is not active yet' };
  if (coupon.end_date && today > coupon.end_date) return { error: 'Coupon has expired' };

  if (coupon.max_seats !== null && coupon.max_seats !== undefined && Number(seatCount) > Number(coupon.max_seats)) {
    return { error: `This coupon is valid for up to ${coupon.max_seats} seats per booking` };
  }

  const fare = Number(amount);
  if (!Number.isFinite(fare) || fare < Number(coupon.min_amount || 0)) {
    return { error: `Minimum order amount is ₹${coupon.min_amount}` };
  }
  if (coupon.usage_limit !== null && coupon.usage_limit !== undefined && Number(coupon.used_count) >= Number(coupon.usage_limit)) {
    return { error: 'Coupon usage limit reached' };
  }

  const resolvedPassengerId = await resolvePassengerId({ passengerId, passengerMobile, mobile, transaction });
  const usageWhere = { coupon_id: coupon.id };
  if (resolvedPassengerId) {
    try {
      const { cleanCompletedTripCouponUsagesForPassenger } = require('../services/couponReleaseService');
      await cleanCompletedTripCouponUsagesForPassenger(resolvedPassengerId, { transaction });
    } catch (cleanErr) {
      // ignore
    }

    const userLimit = Number(coupon.per_user_limit);
    if (Number.isFinite(userLimit) && userLimit > 0) {
      const userCount = await CouponUsage.count({
        where: { ...usageWhere, passenger_id: resolvedPassengerId },
        transaction,
      });
      if (userCount >= userLimit) {
        return { error: 'You have already used this coupon. It cannot be reused until the usage is cleared.' };
      }

      // Prevent reuse if currently locked in an ongoing booking that is not completed
      const { Booking, Trip } = require('../models');
      const activeBooking = await Booking.findOne({
        where: {
          coupon_id: coupon.id,
          passenger_id: resolvedPassengerId,
          booking_status: { [Op.ne]: 'cancelled' },
        },
        include: [{ model: Trip, as: 'trip', required: true }],
        transaction,
      });
      if (activeBooking && activeBooking.trip?.status !== 'Completed') {
        return { error: 'This coupon is currently in use for an active trip booking and cannot be reused until the trip is completed.' };
      }
    }
  } else if (Number(coupon.per_user_limit) > 0) {
    return { error: 'A passenger_id or passenger_mobile is required to use this coupon' };
  }

  if (coupon.per_device_limit !== null && coupon.per_device_limit !== undefined) {
    if (!deviceId) return { error: 'A device_id is required to use this coupon' };
    const deviceCount = await CouponUsage.count({
      where: { ...usageWhere, device_id: String(deviceId).trim() },
      transaction,
    });
    if (deviceCount >= Number(coupon.per_device_limit)) return { error: 'This device has reached the coupon usage limit' };
  }

  let discount = coupon.code_type === 'FLAT'
    ? Number(coupon.amount)
    : (fare * Number(coupon.amount)) / 100;
  if (coupon.max_discount !== null && coupon.max_discount !== undefined) {
    discount = Math.min(discount, Number(coupon.max_discount));
  }
  discount = Math.min(fare, Math.max(0, discount));
  return { coupon, discount: Math.round(discount * 100) / 100 };
};

module.exports = { calculateCouponDiscount };