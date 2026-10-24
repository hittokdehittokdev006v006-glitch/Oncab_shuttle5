'use strict';

const jwt = require('jsonwebtoken');
const { CustomerUser } = require('../models');

const authenticatePassenger = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Passenger access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.token_type !== 'passenger' || !decoded.passenger_id) {
      return res.status(401).json({ success: false, message: 'Invalid passenger access token' });
    }

    const passenger = await CustomerUser.findByPk(decoded.passenger_id);
    if (!passenger || passenger.status === 'Inactive' || passenger.block_status === 'Block') {
      return res.status(401).json({ success: false, message: 'Passenger account is unavailable' });
    }

    req.passenger = passenger;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid or expired passenger access token' });
    }
    next(err);
  }
};

const optionalPassengerAuth = async (req, res, next) => {
  if (!req.body?.package_purchase_id) return next();
  return authenticatePassenger(req, res, next);
};

const optionalPassengerTokenAuth = async (req, res, next) => {
  if (!req.headers.authorization) return next();
  return authenticatePassenger(req, res, next);
};

module.exports = {
  authenticatePassenger,
  optionalPassengerAuth,
  optionalPassengerTokenAuth,
};
