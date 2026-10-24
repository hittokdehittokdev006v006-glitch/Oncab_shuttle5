'use strict';

const assert = require('assert');
const { PassengerPackagePurchase, PackageRideUsage, Booking } = require('../models');
const {
  activatePurchase,
  cancelTripPackageBookings,
  consumeBookingReservation,
  getAvailableRides,
  releaseBookingReservation,
  reserveRides,
  settleTripPackageRides,
} = require('../services/packagePurchaseService');

const transaction = { LOCK: { UPDATE: 'UPDATE' } };

const makePurchase = (overrides = {}) => ({
  id: 51,
  total_rides: 10,
  used_rides: 1,
  reserved_rides: 1,
  validity_days: 30,
  amount_paid: '990.00',
  payment_status: 'paid',
  status: 'active',
  purchased_at: new Date('2026-10-23T10:00:00.000Z'),
  expires_at: new Date('2026-11-22T10:00:00.000Z'),
  async save() {},
  async update(values) {
    Object.assign(this, values);
  },
  ...overrides,
});

async function run() {
  const oldFindByPk = PassengerPackagePurchase.findByPk;
  const oldUsageCreate = PackageRideUsage.create;
  const oldUsageFindOne = PackageRideUsage.findOne;
  const oldBookingFindAll = Booking.findAll;

  try {
    const purchase = makePurchase({ reserved_rides: 0 });
    assert.strictEqual(getAvailableRides(purchase), 9);
    PassengerPackagePurchase.findByPk = async () => purchase;
    PackageRideUsage.create = async (values) => ({ ...values });

    const booking = { id: 1001 };
    const reservation = await reserveRides({
      purchase,
      booking,
      ridesCount: 2,
      transaction,
    });
    assert.strictEqual(reservation.status, 'reserved');
    assert.strictEqual(reservation.rides_count, 2);
    assert.strictEqual(purchase.reserved_rides, 2);
    assert.strictEqual(getAvailableRides(purchase), 7);

    const usage = {
      id: 1,
      purchase_id: purchase.id,
      booking_id: booking.id,
      rides_count: 2,
      status: 'reserved',
      async update(values) {
        Object.assign(this, values);
      },
    };
    PackageRideUsage.findOne = async ({ where }) => (
      usage.status === where.status ? usage : null
    );

    assert.strictEqual(await consumeBookingReservation({ bookingId: booking.id, transaction }), true);
    assert.strictEqual(purchase.used_rides, 3);
    assert.strictEqual(purchase.reserved_rides, 0);
    assert.strictEqual(usage.status, 'consumed');
    assert.strictEqual(await consumeBookingReservation({ bookingId: booking.id, transaction }), false);

    purchase.used_rides = 3;
    purchase.reserved_rides = 1;
    usage.status = 'reserved';
    assert.strictEqual(await releaseBookingReservation({ bookingId: booking.id, transaction }), true);
    assert.strictEqual(purchase.reserved_rides, 0);
    assert.strictEqual(usage.status, 'released');
    assert.strictEqual(await releaseBookingReservation({ bookingId: booking.id, transaction }), false);

    const pending = makePurchase({
      status: 'pending_payment',
      payment_status: 'pending',
      expires_at: null,
    });
    const activatedAt = new Date('2026-10-23T10:00:00.000Z');
    await activatePurchase(pending, { transaction, activatedAt });
    assert.strictEqual(pending.payment_status, 'paid');
    assert.strictEqual(pending.status, 'active');
    assert.strictEqual(pending.expires_at.getTime(), new Date('2026-11-22T10:00:00.000Z').getTime());

    const tripPurchase = makePurchase({ id: 52, used_rides: 0, reserved_rides: 2 });
    const tripUsages = new Map([
      [2001, { purchase_id: 52, booking_id: 2001, rides_count: 1, status: 'reserved' }],
      [2002, { purchase_id: 52, booking_id: 2002, rides_count: 1, status: 'reserved' }],
    ]);
    PassengerPackagePurchase.findByPk = async () => tripPurchase;
    PackageRideUsage.findOne = async ({ where }) => {
      const usage = tripUsages.get(where.booking_id);
      return usage?.status === where.status
        ? { ...usage, async update(values) { Object.assign(usage, values); } }
        : null;
    };
    Booking.findAll = async () => [
      { id: 2001, booking_status: 'confirmed', boarding_status: 'boarded', async update(values) { Object.assign(this, values); } },
      { id: 2002, booking_status: 'confirmed', boarding_status: 'no_show', async update(values) { Object.assign(this, values); } },
    ];
    await settleTripPackageRides({ tripId: 77, transaction });
    assert.strictEqual(tripPurchase.used_rides, 2);
    assert.strictEqual(tripPurchase.reserved_rides, 0);
    assert.strictEqual(tripPurchase.status, 'active');
    assert.strictEqual(tripUsages.get(2001).status, 'consumed');
    assert.strictEqual(tripUsages.get(2002).status, 'consumed');

    tripPurchase.reserved_rides = 1;
    tripUsages.set(2003, {
      purchase_id: 52,
      booking_id: 2003,
      rides_count: 1,
      status: 'reserved',
    });
    const cancellationBooking = {
      id: 2003,
      total_seats: 1,
      booking_status: 'confirmed',
      async update(values) {
        Object.assign(this, values);
      },
    };
    Booking.findAll = async () => [cancellationBooking];
    const cancelledTrip = {
      id: 78,
      booked_seats: 2,
      async save() {},
    };
    assert.strictEqual(await cancelTripPackageBookings({ trip: cancelledTrip, transaction }), 1);
    assert.strictEqual(cancellationBooking.booking_status, 'cancelled');
    assert.strictEqual(cancelledTrip.booked_seats, 1);
    assert.strictEqual(tripPurchase.reserved_rides, 0);
    assert.strictEqual(tripUsages.get(2003).status, 'released');

    console.log('Passenger package purchase service tests passed');
  } finally {
    PassengerPackagePurchase.findByPk = oldFindByPk;
    PackageRideUsage.create = oldUsageCreate;
    PackageRideUsage.findOne = oldUsageFindOne;
    Booking.findAll = oldBookingFindAll;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
