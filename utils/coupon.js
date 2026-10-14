'use strict';

const { Coupon, CouponUsage } = require('../models');

const getCoupon = async ({ couponId, couponCode, transaction, lock }) => {
  const options = { transaction };
  if (lock && transaction) options.lock = transaction.LOCK.UPDATE;
  if (couponId) return Coupon.findByPk(couponId, options);
  if (couponCode) return Coupon.findOne({
    ...options,
    where: { code: String(couponCode).trim().toUpperCase() },
  });
  return null;
};

const calculateCouponDiscount = async ({
  couponId,
  couponCode,
  amount,
  seatCount = 1,
  passengerId,
  deviceId,
  transaction,
  lock = false,
}) => {
  const coupon = await getCoupon({ couponId, couponCode, transaction, lock });
  if (!coupon) return { error: 'Invalid coupon code' };
  if (coupon.status !== 'Active') return { error: 'Coupon is not active' };

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

  const usageWhere = { coupon_id: coupon.id };
  if (passengerId) {
    try {
      const { cleanCompletedTripCouponUsagesForPassenger } = require('../services/couponReleaseService');
      await cleanCompletedTripCouponUsagesForPassenger(passengerId, { transaction });
    } catch (cleanErr) {
      // ignore
    }

    const userLimit = Number(coupon.per_user_limit);
    if (Number.isFinite(userLimit) && userLimit > 0) {
      const userCount = await CouponUsage.count({
        where: { ...usageWhere, passenger_id: passengerId },
        transaction,
      });
      if (userCount >= userLimit) {
        return { error: 'You have already used this coupon. It cannot be reused until the usage is cleared.' };
      }

      // Prevent reuse if currently locked in an ongoing booking that is not completed
      const { Booking, Trip } = require('../models');
      const { Op } = require('sequelize');
      const activeBooking = await Booking.findOne({
        where: {
          coupon_id: coupon.id,
          passenger_id: passengerId,
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
    return { error: 'A passenger_id is required to use this coupon' };
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