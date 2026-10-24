'use strict';

const { Op } = require('sequelize');
const { PassengerPackagePurchase, PackageRideUsage, Booking } = require('../models');

const getAvailableRides = (purchase) => (
  Number(purchase.total_rides) - Number(purchase.used_rides) - Number(purchase.reserved_rides)
);

const addCalendarDays = (date, days) => {
  return new Date(new Date(date).getTime() + Number(days) * 24 * 60 * 60 * 1000);
};

const activatePurchase = async (purchase, { transaction, activatedAt = new Date() } = {}) => {
  if (purchase.payment_status === 'paid') return purchase;
  if (purchase.status !== 'pending_payment') {
    const error = new Error('Package purchase cannot be activated from its current status');
    error.code = 'PACKAGE_PURCHASE_NOT_PAYABLE';
    throw error;
  }
  await purchase.update({
    payment_status: 'paid',
    status: 'active',
    purchased_at: activatedAt,
    expires_at: addCalendarDays(activatedAt, purchase.validity_days),
  }, { transaction });
  return purchase;
};

const reserveRides = async ({ purchase, booking, ridesCount, transaction }) => {
  const lockedPurchase = await PassengerPackagePurchase.findByPk(purchase.id, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!lockedPurchase || lockedPurchase.payment_status !== 'paid' || lockedPurchase.status !== 'active') {
    const error = new Error('Package purchase is not active');
    error.code = 'PACKAGE_PURCHASE_INACTIVE';
    throw error;
  }
  if (!lockedPurchase.expires_at || new Date(lockedPurchase.expires_at) <= new Date()) {
    const error = new Error('Package purchase has expired');
    error.code = 'PACKAGE_PURCHASE_EXPIRED';
    throw error;
  }
  const rides = Number(ridesCount);
  if (!Number.isInteger(rides) || rides < 1 || getAvailableRides(lockedPurchase) < rides) {
    const error = new Error('Package purchase does not have enough rides available');
    error.code = 'INSUFFICIENT_PACKAGE_RIDES';
    throw error;
  }

  lockedPurchase.reserved_rides = Number(lockedPurchase.reserved_rides) + rides;
  await lockedPurchase.save({ transaction });
  return PackageRideUsage.create({
    purchase_id: lockedPurchase.id,
    booking_id: booking.id,
    rides_count: rides,
    status: 'reserved',
  }, { transaction });
};

const releaseBookingReservation = async ({ bookingId, transaction }) => {
  const usage = await PackageRideUsage.findOne({
    where: { booking_id: bookingId, status: 'reserved' },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!usage) return false;

  const purchase = await PassengerPackagePurchase.findByPk(usage.purchase_id, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!purchase) throw new Error(`Package purchase ${usage.purchase_id} is missing for reserved usage`);

  purchase.reserved_rides = Math.max(0, Number(purchase.reserved_rides) - Number(usage.rides_count));
  if (purchase.expires_at && new Date(purchase.expires_at) <= new Date()) {
    purchase.status = 'expired';
  } else if (purchase.status === 'active' && Number(purchase.used_rides) >= Number(purchase.total_rides)) {
    purchase.status = 'exhausted';
  }
  await purchase.save({ transaction });
  await usage.update({ status: 'released', released_at: new Date() }, { transaction });
  return true;
};

const consumeBookingReservation = async ({ bookingId, transaction }) => {
  const usage = await PackageRideUsage.findOne({
    where: { booking_id: bookingId, status: 'reserved' },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!usage) return false;

  const purchase = await PassengerPackagePurchase.findByPk(usage.purchase_id, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!purchase) throw new Error(`Package purchase ${usage.purchase_id} is missing for reserved usage`);

  purchase.reserved_rides = Math.max(0, Number(purchase.reserved_rides) - Number(usage.rides_count));
  purchase.used_rides = Number(purchase.used_rides) + Number(usage.rides_count);
  purchase.status = purchase.used_rides >= purchase.total_rides
    ? 'exhausted'
    : (purchase.expires_at && new Date(purchase.expires_at) <= new Date() ? 'expired' : 'active');
  await purchase.save({ transaction });
  await usage.update({ status: 'consumed', consumed_at: new Date() }, { transaction });
  return true;
};

const settleTripPackageRides = async ({ tripId, transaction }) => {
  const bookings = await Booking.findAll({
    where: { trip_id: tripId },
    attributes: ['id', 'booking_status', 'boarding_status'],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  for (const booking of bookings) {
    if (booking.booking_status !== 'cancelled'
      && ['boarded', 'no_show'].includes(booking.boarding_status)) {
      if (booking.booking_status !== 'completed') {
        await booking.update({ booking_status: 'completed' }, { transaction });
      }
      await consumeBookingReservation({ bookingId: booking.id, transaction });
    } else {
      await releaseBookingReservation({ bookingId: booking.id, transaction });
    }
  }
};

const cancelTripPackageBookings = async ({ trip, transaction }) => {
  const bookings = await Booking.findAll({
    where: {
      trip_id: trip.id,
      package_purchase_id: { [Op.ne]: null },
      booking_status: { [Op.notIn]: ['cancelled', 'completed'] },
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  let seatsToRelease = 0;
  for (const booking of bookings) {
    await booking.update({
      booking_status: 'cancelled',
      status: 'Cancelled',
      cancellation_reason: 'Trip cancelled',
      cancelled_at: new Date(),
    }, { transaction });
    await releaseBookingReservation({ bookingId: booking.id, transaction });
    seatsToRelease += Number(booking.total_seats || 1);
  }
  if (seatsToRelease > 0) {
    trip.booked_seats = Math.max(0, Number(trip.booked_seats || 0) - seatsToRelease);
    await trip.save({ transaction });
  }
  return bookings.length;
};

module.exports = {
  activatePurchase,
  cancelTripPackageBookings,
  consumeBookingReservation,
  getAvailableRides,
  releaseBookingReservation,
  reserveRides,
  settleTripPackageRides,
};
