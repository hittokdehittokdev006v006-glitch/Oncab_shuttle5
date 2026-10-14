'use strict';

const { Op } = require('sequelize');
const { Booking, Trip, Coupon, CouponUsage, CustomerUser } = require('../models');

/**
 * Release coupon usages for bookings on a trip where:
 * 1. Booking was cancelled (booking_status === 'cancelled') OR
 * 2. Passenger did not board (boarding_status !== 'boarded' or 'no_show' or not_boarded)
 *
 * Called whenever a trip status becomes 'Completed'.
 *
 * @param {number|string} tripId - The trip ID that just completed
 * @param {object} [options]
 * @param {object} [options.transaction] - Optional Sequelize transaction
 * @returns {Promise<{ released_count: number, bookings_released: Array }>}
 */
const releaseUnusedCouponOnTripCompletion = async (tripId, { transaction } = {}) => {
  if (!tripId) return { released_count: 0, bookings_released: [] };

  const parsedTripId = Number(tripId);
  const eligibleBookings = await Booking.findAll({
    where: {
      trip_id: parsedTripId,
      [Op.and]: [
        {
          [Op.or]: [
            { booking_status: 'cancelled' },
            { boarding_status: 'no_show' },
            { boarding_status: 'not_boarded' },
            { boarding_status: null },
            { boarding_status: { [Op.ne]: 'boarded' } },
          ],
        },
        {
          [Op.or]: [
            { coupon_id: { [Op.ne]: null } },
            { '$coupon_usage.id$': { [Op.ne]: null } },
          ],
        },
      ],
    },
    include: [
      {
        model: CouponUsage,
        as: 'coupon_usage',
        required: false,
      },
    ],
    transaction,
  });

  const releasedBookings = [];

  for (const booking of eligibleBookings) {
    // Strict Safeguard: Never release if passenger actually boarded unless the booking was cancelled
    if (booking.boarding_status === 'boarded' && booking.booking_status !== 'cancelled') {
      continue;
    }

    const couponId = booking.coupon_usage?.coupon_id || booking.coupon_id;
    if (!couponId) continue;

    // Decrement coupon used_count if it was counted
    const coupon = await Coupon.findByPk(couponId, { transaction });
    if (coupon && Number(coupon.used_count) > 0) {
      await coupon.decrement('used_count', { by: 1, transaction });
    }

    // Delete the CouponUsage record so the passenger can reuse the coupon
    if (booking.coupon_usage) {
      await booking.coupon_usage.destroy({ transaction });
    } else {
      // In case coupon_usage was not attached via association, clean any by booking_id
      await CouponUsage.destroy({
        where: {
          [Op.or]: [
            { booking_id: booking.id },
            { coupon_id: couponId, passenger_id: booking.passenger_id },
          ],
        },
        transaction,
      });
    }

    // Clear coupon_id from booking to avoid duplicate releases
    await booking.update({
      coupon_id: null,
    }, { transaction });

    releasedBookings.push({
      booking_id: booking.id,
      booking_reference: booking.booking_reference,
      coupon_id: couponId,
      coupon_code: coupon?.code,
      passenger_id: booking.passenger_id,
      reason: booking.booking_status === 'cancelled' ? 'booking_cancelled' : 'passenger_did_not_board',
    });
  }

  return {
    released_count: releasedBookings.length,
    bookings_released: releasedBookings,
  };
};

/**
 * Self-healing check for a passenger:
 * Checks if the passenger has any CouponUsage linked to a booking whose Trip is already 'Completed'
 * and where the passenger either cancelled or did not board. If found, automatically clears them.
 *
 * @param {number|string} passengerId
 * @param {object} [options]
 * @param {object} [options.transaction]
 */
const cleanCompletedTripCouponUsagesForPassenger = async (passengerId, { transaction } = {}) => {
  if (!passengerId) return;

  const usages = await CouponUsage.findAll({
    where: { passenger_id: passengerId },
    include: [
      {
        model: Booking,
        as: 'booking',
        required: true,
        include: [
          {
            model: Trip,
            as: 'trip',
            required: true,
          },
        ],
      },
    ],
    transaction,
  });

  for (const usage of usages) {
    const booking = usage.booking;
    const trip = booking?.trip;

    // Condition: Trip is Completed AND (booking cancelled OR passenger did not board)
    const tripCompleted = trip?.status === 'Completed';
    const passengerDidNotBoard = booking.booking_status === 'cancelled' || booking.boarding_status !== 'boarded';

    if (tripCompleted && passengerDidNotBoard) {
      const coupon = await Coupon.findByPk(usage.coupon_id, { transaction });
      if (coupon && Number(coupon.used_count) > 0) {
        await coupon.decrement('used_count', { by: 1, transaction });
      }

      await usage.destroy({ transaction });

      if (booking.coupon_id) {
        await booking.update({ coupon_id: null }, { transaction });
      }
    }
  }
};

module.exports = {
  releaseUnusedCouponOnTripCompletion,
  cleanCompletedTripCouponUsagesForPassenger,
};
