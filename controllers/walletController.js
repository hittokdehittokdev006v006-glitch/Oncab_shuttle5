'use strict';

const { CustomerUser, WalletTransaction } = require('../models');

const resolvePassenger = async (req) => {
  const passengerId = req.body?.passenger_id || req.query?.passenger_id;
  const mobile = String(req.body?.passenger_mobile || req.query?.passenger_mobile || req.body?.mobile || req.query?.mobile || '').trim();

  if (!passengerId && !mobile) return { error: 'passenger_id or passenger_mobile is required' };

  const where = {};
  if (passengerId) where.id = passengerId;
  if (mobile) where.mobile = mobile;

  const passenger = await CustomerUser.findOne({ where });
  if (!passenger) return { error: 'Passenger account could not be verified', status: 404 };
  if (passenger.status === 'Inactive' || passenger.block_status === 'Block') {
    return { error: 'Passenger account is not active', status: 403 };
  }
  return { passenger };
};

exports.balance = async (req, res, next) => {
  try {
    const result = await resolvePassenger(req);
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }
    return res.json({
      success: true,
      data: {
        passenger_id: result.passenger.id,
        currency: 'INR',
        balance: Number(result.passenger.wallet_balance || 0),
      },
    });
  } catch (err) {
    return next(err);
  }
};

exports.transactions = async (req, res, next) => {
  try {
    const result = await resolvePassenger(req);
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { count, rows } = await WalletTransaction.findAndCountAll({
      where: { passenger_id: result.passenger.id },
      offset: (page - 1) * limit,
      limit,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
    });
    return res.json({
      success: true,
      data: rows,
      balance: Number(result.passenger.wallet_balance || 0),
      pagination: { total: count, page, limit, pages: Math.ceil(count / limit) },
    });
  } catch (err) {
    return next(err);
  }
};