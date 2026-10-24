'use strict';

const { Booking, Payment, Refund, PassengerPackagePurchase, CustomerUser } = require('../models');
const sequelize = require('../config/database');
const { getPayUConfig, paymentHash, responseHash, secureCompare } = require('../utils/payu');
const { confirmPaidBooking } = require('../services/bookingConfirmationService');
const { activatePurchase } = require('../services/packagePurchaseService');

const makeTxnId = () => `OC${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;
const normalizeAmount = (amount) => Number(amount).toFixed(2);

const redirectToResult = (res, payment, status) => {
  const target = process.env.PAYU_RETURN_URL;
  if (target) {
    const url = new URL(target);
    url.searchParams.set('payment_status', status);
    if (payment?.payu_txnid) url.searchParams.set('txnid', payment.payu_txnid);
    if (payment?.booking_id) url.searchParams.set('booking_id', payment.booking_id);
    if (payment?.package_purchase_id) url.searchParams.set('package_purchase_id', payment.package_purchase_id);
    return res.redirect(303, url.toString());
  }
  const messages = {
    success: 'Payment successful',
    refund_pending: 'Payment was received, but the seat is no longer available. A refund is pending.',
    failed: 'Payment was not completed',
  };
  return res.status(status === 'success' ? 200 : 400).json({
    success: status === 'success',
    message: messages[status] || messages.failed,
    data: payment ? {
      booking_id: payment.booking_id,
      package_purchase_id: payment.package_purchase_id,
      txnid: payment.payu_txnid,
      status: payment.status,
    } : undefined,
  });
};

exports.initiate = async (req, res, next) => {
  try {
    const { booking_id, package_purchase_id, passenger_mobile } = req.body || {};
    let booking = null;
    let purchase = null;
    let passenger = null;
    if (package_purchase_id) {
      if (!req.passenger) {
        return res.status(401).json({ success: false, message: 'Passenger authentication is required for package purchase payment' });
      }
      purchase = await PassengerPackagePurchase.findOne({
        where: { id: package_purchase_id, passenger_id: req.passenger.id },
      });
      if (!purchase) return res.status(404).json({ success: false, message: 'Package purchase not found for this passenger' });
      if (purchase.status !== 'pending_payment' || purchase.payment_status === 'paid') {
        return res.status(409).json({ success: false, message: 'Package purchase is not awaiting payment' });
      }
      const pendingPayment = await Payment.findOne({
        where: { package_purchase_id: purchase.id, status: 'pending' },
      });
      if (pendingPayment) {
        return res.status(409).json({
          success: false,
          message: 'A PayU payment is already pending for this package purchase',
          data: { txnid: pendingPayment.payu_txnid },
        });
      }
      passenger = req.passenger;
    } else {
      if (!booking_id || !passenger_mobile) {
        return res.status(400).json({ success: false, message: 'booking_id and passenger_mobile are required' });
      }
      booking = await Booking.findOne({ where: { id: booking_id, passenger_mobile } });
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found for this passenger' });
      if (booking.booking_status === 'cancelled') return res.status(409).json({ success: false, message: 'Cancelled booking cannot be paid' });
      if (booking.payment_status === 'paid') return res.status(409).json({ success: false, message: 'Booking is already paid' });
      passenger = booking.passenger_id ? await CustomerUser.findByPk(booking.passenger_id) : null;
    }

    const amount = normalizeAmount(purchase ? purchase.amount_paid : booking.final_amount);
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Booking amount must be greater than zero' });
    }

    const config = getPayUConfig();
    const txnid = makeTxnId();
    const firstname = String((purchase ? passenger?.name : booking.passenger_name) || 'Passenger').trim().slice(0, 60);
    const email = purchase ? (passenger?.email || 'noemail@oncabshuttle.com') : (booking.passenger_email || 'noemail@oncabshuttle.com');
    const productinfo = purchase
      ? `Ride Package ${purchase.package_code}`.slice(0, 100)
      : `Booking ${booking.booking_reference}`.slice(0, 100);
    const callbackPath = req.originalUrl.startsWith('/api2/shuttle')
      ? '/api2/shuttle/payment/payu-callback'
      : '/api2/bus/payment/payu-callback';
    const callbackUrl = process.env.PAYU_CALLBACK_URL || `${req.protocol}://${req.get('host')}${callbackPath}`;
    const payment = await Payment.create({
      booking_id: booking?.id || null,
      package_purchase_id: purchase?.id || null,
      passenger_id: purchase?.passenger_id || booking?.passenger_id || null,
      amount,
      currency: 'INR',
      payment_method: 'payu',
      payment_gateway: 'payu',
      status: 'pending',
      payu_txnid: txnid,
      event: 'checkout_initiated',
      payload: purchase
        ? { package_purchase_id: purchase.id, package_code: purchase.package_code }
        : { booking_reference: booking.booking_reference },
    });

    const fields = {
      key: config.key,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      phone: purchase ? passenger.mobile : booking.passenger_mobile,
      surl: callbackUrl,
      furl: callbackUrl,
      udf1: purchase ? `package_purchase:${purchase.id}` : String(booking.id),
      udf2: '', udf3: '', udf4: '', udf5: '',
    };
    fields.hash = paymentHash({ ...fields, salt: config.salt });
    res.json({
      success: true,
      message: 'PayU checkout initialized',
      data: { action: config.checkoutUrl, method: 'POST', fields },
    });
  } catch (err) {
    next(err);
  }
};

exports.callback = async (req, res, next) => {
  let transaction;
  try {
    transaction = await sequelize.transaction();
    const body = req.body || {};
    const txnid = String(body.txnid || '');
    const payment = txnid ? await Payment.findOne({ where: { payu_txnid: txnid }, transaction, lock: transaction.LOCK.UPDATE }) : null;
    if (!payment) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'PayU transaction not found' });
    }

    const config = getPayUConfig();
    if (String(body.key || '') !== config.key) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Invalid PayU merchant key' });
    }
    const expectedHash = responseHash(body, config.salt);
    if (!secureCompare(String(body.hash || '').toLowerCase(), expectedHash.toLowerCase())) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Invalid PayU response signature' });
    }

    if (normalizeAmount(body.amount) !== normalizeAmount(payment.amount)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'PayU amount does not match booking amount' });
    }
    const expectedUdf1 = payment.package_purchase_id
      ? `package_purchase:${payment.package_purchase_id}`
      : String(payment.booking_id);
    if (!expectedUdf1 || String(body.udf1 || '') !== expectedUdf1) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'PayU reference does not match the transaction' });
    }

    if (payment.status === 'captured') {
      if (payment.package_purchase_id) {
        const purchase = await PassengerPackagePurchase.findByPk(payment.package_purchase_id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!purchase) {
          await transaction.rollback();
          return res.status(404).json({ success: false, message: 'Package purchase was not found' });
        }
        await activatePurchase(purchase, { transaction });
        await transaction.commit();
        return redirectToResult(res, payment, 'success');
      }
      const booking = await Booking.findByPk(payment.booking_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (booking && booking.booking_status !== 'cancelled') {
        if (booking.payment_status !== 'paid') {
          await booking.update({
            payment_status: 'paid',
            payment_method: 'payu',
            transaction_id: txnid,
            payu_mihpayid: payment.payu_mihpayid || booking.payu_mihpayid || null,
          }, { transaction });
        }
        await confirmPaidBooking({ booking, transaction });
      }
      const pendingRefund = await Refund.findOne({
        where: { payment_id: payment.id, status: ['pending', 'processing'] },
        transaction,
      });
      await transaction.commit();
      return redirectToResult(res, payment, pendingRefund ? 'refund_pending' : 'success');
    }

    const succeeded = String(body.status || '').toLowerCase() === 'success';
    if (succeeded && !body.mihpayid) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'PayU success response is missing mihpayid' });
    }
    const booking = payment.booking_id
      ? await Booking.findByPk(payment.booking_id, { transaction, lock: transaction.LOCK.UPDATE })
      : null;
    const purchase = payment.package_purchase_id
      ? await PassengerPackagePurchase.findByPk(payment.package_purchase_id, { transaction, lock: transaction.LOCK.UPDATE })
      : null;
    if (!booking && !purchase) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Payment has no associated booking or package purchase' });
    }
    await payment.update({
      status: succeeded ? 'captured' : 'failed',
      payment_method: body.mode || 'payu',
      payu_mihpayid: body.mihpayid || null,
      event: succeeded ? 'payment_captured' : 'payment_failed',
      gateway_response: body,
      payload: { ...(payment.payload || {}), payu_status: body.status },
    }, { transaction });

    if (booking) {
      await booking.update({
        payment_status: succeeded ? 'paid' : 'failed',
        payment_method: 'payu',
        transaction_id: txnid,
        payu_mihpayid: body.mihpayid || booking.payu_mihpayid || null,
      }, { transaction });
      if (succeeded) {
        try {
          await confirmPaidBooking({ booking, transaction });
        } catch (activationError) {
          if (!['SEAT_ALREADY_BOOKED', 'TRIP_CAPACITY_REACHED'].includes(activationError.code)) throw activationError;
          await booking.update({
            booking_status: 'cancelled',
            status: 'Cancelled',
            cancellation_reason: activationError.message,
            cancelled_at: new Date(),
          }, { transaction });
          await Refund.create({
            booking_id: booking.id,
            payment_id: payment.id,
            passenger_id: booking.passenger_id,
            refund_reference: `REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            refund_amount: booking.final_amount,
            refund_method: 'payu',
            refund_reason: 'Payment captured after the selected seat became unavailable',
            status: 'pending',
            notes: activationError.message,
          }, { transaction });
          await transaction.commit();
          return redirectToResult(res, payment, 'refund_pending');
        }
      }
      if (purchase) {
        if (succeeded) {
          await activatePurchase(purchase, { transaction });
        } else {
          await purchase.update({ payment_status: 'failed' }, { transaction });
        }
      }
    }
    await transaction.commit();
    return redirectToResult(res, payment, succeeded ? 'success' : 'failed');
  } catch (err) {
    if (transaction && !transaction.finished) await transaction.rollback();
    next(err);
  }
};
