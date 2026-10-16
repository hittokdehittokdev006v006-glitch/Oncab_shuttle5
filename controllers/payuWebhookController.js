'use strict';

const { Payment, Refund, Booking, PayuWebhook, sequelize } = require('../models');
const { getPayUConfig, responseHash, secureCompare } = require('../utils/payu');
const refundController = require('./refundController');
const { confirmPaidBooking } = require('../services/bookingConfirmationService');

const normalizeAmount = (amount) => {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : String(amount || '');
};

const lower = (v) => String(v || '').toLowerCase();

// Find the refund record a webhook row refers to.
const resolveRefund = async ({ payment, body, tx }) => {
  const requestId = body.request_id || body.refund_id || body.action_request_id;
  if (requestId) {
    const byRequest = await Refund.findOne({ where: { gateway_refund_id: String(requestId) }, transaction: tx });
    if (byRequest) return byRequest;
  }
  if (payment) {
    // newest processing/pending payu refund for this payment
    return Refund.findOne({
      where: { payment_id: payment.id, refund_method: 'payu', status: ['pending', 'processing'] },
      order: [['created_at', 'DESC']],
      transaction: tx,
    });
  }
  return null;
};

// ── PayU Webhook Receiver ────────────────────────────────────
// URL TO PUT IN THE PAYU DASHBOARD (Settings → Webhooks):
//   {APP_URL}/api2/payu/webhook
// e.g. https://api.oncabshuttle.com/api2/payu/webhook
// PayU posts payment success/failure, refund status AND
// dispute/chargeback updates here (form-encoded POST).
exports.receive = async (req, res, next) => {
  let tx;
  try {
    const body = { ...(req.body || {}) };
    // PayU may send JSON or form-encoded
    if (!Object.keys(body).length && typeof req.body === 'string') {
      try { Object.assign(body, JSON.parse(req.body)); } catch { /* ignore */ }
    }

    const txnid = body.txnid || body.txnId || null;
    const mihpayid = body.mihpayid || body.mihPayid || body.payment_id || null;

    // Detect the event type: PayU sends payment updates, refund updates
    // (request_id / refund_id) and dispute/chargeback updates.
    const isRefundEvent = !!(body.request_id || body.refund_id);
    const rawEvent = String(body.event_type || body.event || body.webhook_type || body.type || '').toLowerCase();
    const isDisputeEvent = rawEvent.includes('dispute') || rawEvent.includes('chargeback') ||
      lower(body.status).includes('dispute') || lower(body.status).includes('chargeback') ||
      !!body.dispute_id;

    const eventType = rawEvent
      || (isRefundEvent ? 'refund_status' : isDisputeEvent ? 'dispute_status' : 'payment_status');

    const config = getPayUConfig();

    // Hash verification (skip gracefully if PayU does not send a hash).
    let hashVerified = false;
    if (body.hash) {
      try {
        const expected = responseHash(body, config.salt);
        hashVerified = secureCompare(lower(body.hash), expected.toLowerCase());
      } catch {
        hashVerified = false;
      }
      if (!hashVerified) {
        // try the additionalCharges variant already handled inside responseHash
        return res.status(401).json({ success: false, message: 'Invalid PayU webhook signature' });
      }
    }

    tx = await sequelize.transaction();

    // Resolve related records
    const payment = mihpayid
      ? await Payment.findOne({ where: { payu_mihpayid: String(mihpayid) }, transaction: tx })
      || await Payment.findOne({ where: { payu_txnid: String(txnid || '') }, transaction: tx })
      : (txnid ? await Payment.findOne({ where: { payu_txnid: String(txnid) }, transaction: tx }) : null);

    const refund = await resolveRefund({ payment, body, tx });

    // 1. Always log the raw webhook first
    const webhookLog = await PayuWebhook.create({
      event_type: eventType,
      payu_txnid: txnid,
      payu_mihpayid: mihpayid,
      booking_id: payment?.booking_id || refund?.booking_id || (body.udf1 ? Number(body.udf1) : null),
      payment_id: payment?.id || refund?.payment_id || null,
      refund_id: refund?.id || null,
      status: body.status || body.action_status || body.current_status || null,
      amount: Number(body.amount) || null,
      payload: body,
      hash_verified: hashVerified,
      processed: false,
    }, { transaction: tx });

    // 2. Payment status updates
    const isPaymentStatusEvent = !isRefundEvent && !isDisputeEvent;
    if (payment && body.status && isPaymentStatusEvent) {
      const succeeded = lower(body.status) === 'success';
      if (succeeded && payment.status !== 'refunded' && payment.status !== 'partial_refund') {
        await payment.update({
          status: 'captured',
          payu_mihpayid: mihpayid || payment.payu_mihpayid,
          gateway_response: body,
          event: 'payment_captured_webhook',
        }, { transaction: tx });
        const booking = await Booking.findByPk(payment.booking_id, { transaction: tx, lock: tx.LOCK.UPDATE });
        if (booking && booking.booking_status !== 'cancelled') {
          await booking.update({
            payment_status: 'paid',
            transaction_id: txnid || booking.transaction_id,
            payu_mihpayid: mihpayid || booking.payu_mihpayid,
          }, { transaction: tx });
          await confirmPaidBooking({ booking, transaction: tx });
        }
      } else if (lower(body.status) === 'failed' && payment.status === 'pending') {
        await payment.update({ status: 'failed', gateway_response: body, event: 'payment_failed_webhook' }, { transaction: tx });
      }
    }

    // 3. Refund status updates
    let refundUpdated = false;
    let disputeHandled = false;
    if (refund) {
      const statusText = lower(
        body.action_status || body.status || body.current_status || body.refund_status || ''
      );
      const isRefundEvent = eventType === 'refund_status' || !!body.request_id || !!body.refund_id;

      if (isRefundEvent || (payment && statusText)) {
        let newStatus = null;
        let failureReason = null;

        if (['success', 'successful', 'completed', 'done', 'refunded', 'money_settled', 'refunded_to_customer'].includes(statusText)) {
          newStatus = 'completed';
        } else if (['failure', 'failed', 'failure_initiated', 'rejected', 'cancelled'].includes(statusText)) {
          newStatus = 'failed';
          failureReason = body.error_message || body.msg || body.message || 'PayU reported the refund as failed';
        } else if (['initiated', 'processing', 'in_progress', 'queued', 'pending'].includes(statusText)) {
          newStatus = 'processing';
        }

        if (newStatus && refund.status !== 'completed') {
          await refund.update({
            status: newStatus,
            gateway_refund_id: body.request_id || body.refund_id || refund.gateway_refund_id,
            payu_txnid: txnid || refund.payu_txnid,
            payu_mihpayid: mihpayid || refund.payu_mihpayid,
            gateway_response: body,
            failure_reason: failureReason,
            ...(newStatus === 'completed' ? { processed_at: new Date() } : {}),
          }, { transaction: tx });
          refundUpdated = true;
        }

        // sync payment/booking when refund completed
        if (newStatus === 'completed') {
          const reloadedPayment = refund.payment_id ? await Payment.findByPk(refund.payment_id, { transaction: tx }) : null;
          if (reloadedPayment) {
            const refundedAmount = await Refund.sum('refund_amount', {
              where: { payment_id: reloadedPayment.id, status: 'completed' },
              transaction: tx,
            });
            const isFullRefund = Number(refundedAmount || 0) >= Number(reloadedPayment.amount);
            await reloadedPayment.update({ status: isFullRefund ? 'refunded' : 'partial_refund' }, { transaction: tx });
          }
          if (refund.booking_id) {
            const booking = await Booking.findByPk(refund.booking_id, { transaction: tx });
            if (booking) {
              const bookingRefunded = await Refund.sum('refund_amount', {
                where: { booking_id: booking.id, status: 'completed' },
                transaction: tx,
              });
              const isBookingFullyRefunded = Number(bookingRefunded || 0) >= Number(booking.final_amount);
              await booking.update({ payment_status: isBookingFullyRefunded ? 'refunded' : 'partial_refund' }, { transaction: tx });
            }
          }
        }
      }
    }

    // 4. Dispute / chargeback updates — mark the payment & booking so admins
    //    can see there is a dispute in the PayU dashboard.
    // 4. Dispute / chargeback updates — mark the payment & booking so admins
    //    can see there is a dispute in the PayU dashboard.
    if (isDisputeEvent && payment) {
      const disputeStatus = lower(body.status || body.dispute_status || body.current_status);
      const disputeNote = `PayU dispute (${disputeStatus || 'opened'})${body.dispute_id ? ` — id ${body.dispute_id}` : ''}`;
      await payment.update({
        event: `dispute_${disputeStatus || 'opened'}`,
        payload: { ...(payment.payload || {}), dispute: body },
      }, { transaction: tx });
      const disputeBooking = await Booking.findByPk(payment.booking_id, { transaction: tx });
      if (disputeBooking) {
        await disputeBooking.update({
          cancellation_reason: disputeBooking.cancellation_reason
            ? `${disputeBooking.cancellation_reason} | ${disputeNote}`
            : disputeNote,
        }, { transaction: tx });
      }
      disputeHandled = true;
    }

    await webhookLog.update({ processed: true, processed_at: new Date() }, { transaction: tx });
    await tx.commit();

    // PayU expects a plain 200 acknowledgement
    return res.status(200).json({
      success: true,
      message: 'Webhook received',
      data: { webhook_id: webhookLog.id, refund_updated: refundUpdated, dispute_handled: disputeHandled },
    });
  } catch (err) {
    if (tx && !tx.finished) await tx.rollback();
    next(err);
  }
};

// ── Webhook Logs Panel (admin) ───────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const { Op } = require('sequelize');
    const where = {};
    if (req.query.event_type) where.event_type = req.query.event_type;
    if (req.query.txnid) where.payu_txnid = { [Op.like]: `%${req.query.txnid}%` };
    // Search both ids. PayU dashboard may show multiple events associated
    // with the same transaction, while some events omit one of these fields.
    if (req.query.mihpayid) {
      where[Op.or] = [
        { payu_mihpayid: { [Op.like]: `%${req.query.mihpayid}%` } },
        { payu_txnid: { [Op.like]: `%${req.query.mihpayid}%` } },
      ];
    }

    const { count, rows } = await PayuWebhook.findAndCountAll({
      where,
      offset: (page - 1) * limit,
      limit,
      order: [['created_at', 'DESC']],
    });
    res.json({ success: true, data: rows, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } });
  } catch (err) {
    next(err);
  }
};

// Manual re-sync: check a stuck 'processing' refund against PayU directly
exports.resync = async (req, res, next) => {
  try {
    const refund = await Refund.findByPk(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: 'Refund not found' });
    if (refund.status === 'completed') return res.status(400).json({ success: false, message: 'Refund already completed' });
    if (refund.refund_method !== 'payu' || !refund.gateway_refund_id) {
      return res.status(409).json({ success: false, message: 'No PayU refund request id to resync' });
    }
    // reuse the verify logic
    req.params.id = refund.id;
    return refundController.verifyPayU(req, res, next);
  } catch (err) {
    next(err);
  }
};
