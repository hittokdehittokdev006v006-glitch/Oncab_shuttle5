'use strict';

const { Op } = require('sequelize');
const { Refund, Booking, Payment, CustomerUser, SystemSetting, sequelize } = require('../models');
const { checkRefundStatus, initiateRefund } = require('../utils/payu');

const buildPagination = (page, limit) => {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit) || 15));
  return { offset: (p - 1) * l, limit: l, page: p };
};

const REFUND_INCLUDE = [
  { model: Booking, as: 'booking', attributes: ['id', 'booking_reference', 'passenger_name', 'travel_date', 'final_amount', 'payment_status', 'trip_id'] },
  { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile', 'email'] },
  { model: Payment, as: 'payment', attributes: ['id', 'payment_gateway', 'payu_txnid', 'payu_mihpayid', 'amount', 'status'] },
];

const getPayURefundMode = async () => {
  const setting = await SystemSetting.findOne({ where: { key: 'payu_refund_mode' } });
  const mode = String(setting?.value || 'standard').toLowerCase();
  return ['instant', 'standard'].includes(mode) ? mode : 'standard';
};

// ── List All Refunds ───────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { page, limit, status, search } = req.query;
    const { offset, limit: lim, page: p } = buildPagination(page, limit);
    const where = {};
    if (status) where.status = status;
    if (search) where[Op.or] = [{ refund_reference: { [Op.like]: `%${search}%` } }];

    const { count, rows } = await Refund.findAndCountAll({ where, include: REFUND_INCLUDE, offset, limit: lim, order: [['created_at', 'DESC']] });
    res.json({ success: true, data: rows, pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) } });
  } catch (err) {
    next(err);
  }
};

// ── Failed Refunds ─────────────────────────────────────────
exports.failedList = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const { offset, limit: lim, page: p } = buildPagination(page, limit);
    const { count, rows } = await Refund.findAndCountAll({ where: { status: 'failed' }, include: REFUND_INCLUDE, offset, limit: lim, order: [['created_at', 'DESC']] });
    res.json({ success: true, data: rows, pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) } });
  } catch (err) {
    next(err);
  }
};

// ── Completed/Paid Refunds ─────────────────────────────────
exports.completedList = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const { offset, limit: lim, page: p } = buildPagination(page, limit);
    const { count, rows } = await Refund.findAndCountAll({ where: { status: 'completed' }, include: REFUND_INCLUDE, offset, limit: lim, order: [['processed_at', 'DESC']] });
    res.json({ success: true, data: rows, pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) } });
  } catch (err) {
    next(err);
  }
};

// ── Process Refund ─────────────────────────────────────────
exports.process = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const refund = await Refund.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!refund) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Refund not found' });
    }
    if (refund.status === 'completed') {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Refund already processed' });
    }
    if (refund.status === 'processing') {
      await transaction.rollback();
      return res.status(409).json({ success: false, message: 'Refund is already processing' });
    }

    const booking = await Booking.findByPk(refund.booking_id, { transaction });
    const payment = refund.payment_id
      ? await Payment.findByPk(refund.payment_id, { transaction, lock: transaction.LOCK.UPDATE })
      : await Payment.findOne({
        where: { booking_id: refund.booking_id, status: { [Op.in]: ['captured', 'partial_refund'] } },
        order: [['created_at', 'DESC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

    const refundAmount = Number(refund.refund_amount);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Refund amount must be greater than zero' });
    }

    const payuMode = await getPayURefundMode();
    if (!payment || !payment.payu_mihpayid || payment.amount == null || Number(payment.amount) <= 0) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        message: 'A valid PayU payment transaction is required to process this refund.',
      });
    }

    try {
      const refundResult = await initiateRefund({
        mihpayid: payment.payu_mihpayid,
        amount: refundAmount,
        refundToken: refund.refund_reference,
      });
      const statusValue = String(refundResult?.status || refundResult?.action_status || '').toLowerCase();
      const refundStatus = ['success', 'successful', 'completed'].includes(statusValue) ? 'completed' : 'processing';
      await refund.update({
        payment_id: payment.id,
        status: refundStatus,
        refund_method: 'payu',
        gateway_refund_id: refundResult?.request_id || refund.gateway_refund_id || null,
        gateway_response: refundResult,
        notes: req.body?.notes || refund.notes,
        failure_reason: null,
        processed_at: refundStatus === 'completed' ? new Date() : null,
      }, { transaction });

      if (refundStatus === 'completed') {
        const refundedAmount = await Refund.sum('refund_amount', { where: { payment_id: payment.id, status: 'completed' }, transaction });
        const isFullRefund = Number(refundedAmount || 0) >= Number(payment.amount);
        await payment.update({ status: isFullRefund ? 'refunded' : 'partial_refund' }, { transaction });
        if (booking) {
          const bookingRefundedAmount = await Refund.sum('refund_amount', { where: { booking_id: booking.id, status: 'completed' }, transaction });
          const isBookingFullyRefunded = Number(bookingRefundedAmount || 0) >= Number(booking.final_amount);
          await booking.update({ payment_status: isBookingFullyRefunded ? 'refunded' : 'partial_refund' }, { transaction });
        }
      }

      await transaction.commit();
      const processedRefund = await Refund.findByPk(refund.id, { include: REFUND_INCLUDE });
      return res.json({
        success: true,
        message: refundStatus === 'completed'
          ? `PayU refund completed using ${payuMode} mode`
          : `PayU refund submitted using ${payuMode} mode; awaiting PayU confirmation`,
        data: processedRefund,
      });
    } catch (payuErr) {
      await refund.update({
        payment_id: payment.id,
        status: 'failed',
        refund_method: 'payu',
        failure_reason: payuErr?.message || 'PayU refund initiation failed',
      }, { transaction });
      await transaction.commit();
      return res.status(502).json({
        success: false,
        message: payuErr?.message || 'PayU refund initiation failed.',
      });
    }
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    next(err);
  }
};

exports.getUserRefunds = async (req, res, next) => {
  try {
    const body = req.body || {};
    const query = req.query || {};
    const passenger_id = query.passenger_id || body.passenger_id;
    const passenger_mobile = query.passenger_mobile || body.passenger_mobile;
    const booking_id = query.booking_id || body.booking_id;

    if (!passenger_id && !passenger_mobile && !booking_id) {
      return res.status(400).json({ success: false, status: 400, message: 'passenger_id, passenger_mobile, or booking_id is required' });
    }

    const where = {};
    if (booking_id) where.booking_id = booking_id;
    if (passenger_id) where.passenger_id = passenger_id;
    if (passenger_mobile) {
      const passenger = await CustomerUser.findOne({ where: { mobile: passenger_mobile } });
      if (passenger) where.passenger_id = passenger.id;
      else return res.json({ success: true, status: 200, data: [], pagination: { total: 0, page: 1, limit: 20, pages: 0 } });
    }

    const { count, rows } = await Refund.findAndCountAll({
      where,
      include: REFUND_INCLUDE,
      order: [['created_at', 'DESC']],
    });

    res.json({ success: true, status: 200, data: rows, pagination: { total: count, page: 1, limit: rows.length || 20, pages: Math.max(1, Math.ceil(count / (rows.length || 1))) } });
  } catch (err) {
    next(err);
  }
};

exports.verifyPayU = async (req, res, next) => {
  try {
    const refund = await Refund.findByPk(req.params.id, { include: REFUND_INCLUDE });
    if (!refund) return res.status(404).json({ success: false, message: 'Refund not found' });
    if (refund.status !== 'processing' || refund.refund_method !== 'payu' || !refund.gateway_refund_id) {
      return res.status(409).json({ success: false, message: 'No pending PayU refund to verify' });
    }

    const result = await checkRefundStatus(refund.gateway_refund_id);
    const details = result.transaction_details && Object.values(result.transaction_details)[0];
    const actionStatus = String(details?.status || details?.action_status || '').toLowerCase();
    let status = refund.status;
    const updates = { gateway_response: result };

    if (['success', 'successful', 'completed'].includes(actionStatus)) {
      status = 'completed';
      updates.status = status;
      updates.processed_at = new Date();
      updates.failure_reason = null;
    } else if (['failure', 'failed', 'failure_initiated'].includes(actionStatus)) {
      status = 'failed';
      updates.status = status;
      updates.failure_reason = details?.error_message || details?.msg || 'PayU refund failed';
    }

    await refund.update(updates);
    if (status === 'completed') {
      const payment = refund.payment || await Payment.findByPk(refund.payment_id);
      if (payment) {
        const booking = await Booking.findByPk(refund.booking_id);
        const refundedAmount = await Refund.sum('refund_amount', { where: { payment_id: payment.id, status: 'completed' } });
        const isFullRefund = Number(refundedAmount || 0) >= Number(payment.amount);
        await payment.update({ status: isFullRefund ? 'refunded' : 'partial_refund' });
        if (booking) await booking.update({ payment_status: isFullRefund ? 'refunded' : 'partial_refund' });
      }
    }

    res.json({ success: true, message: `PayU refund status: ${status}`, data: refund });
  } catch (err) {
    next(err);
  }
};

// ── Retry Failed Refund ────────────────────────────────────
exports.retry = async (req, res, next) => {
  try {
    const refund = await Refund.findByPk(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: 'Refund not found' });
    if (refund.status !== 'failed') return res.status(400).json({ success: false, message: 'Only failed refunds can be retried' });
    await refund.update({ status: 'pending', retry_count: refund.retry_count + 1, failure_reason: null });
    res.json({ success: true, message: 'Refund queued for retry', data: refund });
  } catch (err) {
    next(err);
  }
};

// ── Mark Refund Failed ─────────────────────────────────────
exports.markFailed = async (req, res, next) => {
  try {
    const refund = await Refund.findByPk(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: 'Refund not found' });
    const { failure_reason } = req.body;
    await refund.update({ status: 'failed', failure_reason });
    res.json({ success: true, message: 'Refund marked as failed', data: refund });
  } catch (err) {
    next(err);
  }
};
