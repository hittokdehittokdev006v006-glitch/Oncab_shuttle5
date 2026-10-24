'use strict';

const { Op } = require('sequelize');
const {
  RidePackage,
  PassengerPackagePurchase,
  PackageRideUsage,
  Booking,
  CustomerUser,
  Payment,
} = require('../models');
const sequelize = require('../config/database');

const serializePurchase = (purchase) => {
  const data = purchase.toJSON();
  data.available_rides = Math.max(0, Number(data.total_rides) - Number(data.used_rides) - Number(data.reserved_rides));
  data.remaining_rides = data.available_rides;
  data.unconsumed_rides = Math.max(0, Number(data.total_rides) - Number(data.used_rides));
  return data;
};

const expirePurchaseIfNeeded = async (purchase, transaction) => {
  if (purchase.status === 'active' && purchase.expires_at && new Date(purchase.expires_at) <= new Date()) {
    await purchase.update({ status: 'expired' }, { transaction });
  }
};

exports.create = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const packageKey = req.body?.package_id || req.body?.package_code;
    if (!packageKey) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'package_id or package_code is required' });
    }
    const pkg = await RidePackage.findOne({
      where: {
        [Op.or]: [
          ...(Number.isInteger(Number(packageKey)) && Number(packageKey) > 0 ? [{ id: Number(packageKey) }] : []),
          { package_code: String(packageKey).trim() },
        ],
        status: 'Active',
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!pkg) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Active package was not found' });
    }
    const ridesCount = Number(pkg.rides_count);
    const validityDays = Number(pkg.validity_days);
    const totalPrice = Number(pkg.total_price);
    const pricePerRide = Number(pkg.price_per_ride);
    if (!Number.isInteger(ridesCount) || ridesCount < 1
      || !Number.isInteger(validityDays) || validityDays < 1
      || !Number.isFinite(totalPrice) || totalPrice <= 0
      || !Number.isFinite(pricePerRide) || pricePerRide <= 0) {
      await transaction.rollback();
      return res.status(409).json({ success: false, message: 'Package is not configured with valid rides, validity, and price' });
    }

    const purchase = await PassengerPackagePurchase.create({
      passenger_id: req.passenger.id,
      package_id: pkg.id,
      route_id: pkg.route_id,
      package_code: pkg.package_code,
      package_name: pkg.name,
      total_rides: ridesCount,
      validity_days: validityDays,
      price_per_ride: pricePerRide,
      amount_paid: totalPrice,
      payment_status: 'pending',
      status: 'pending_payment',
    }, { transaction });
    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: 'Package purchase created. Complete PayU checkout to activate it.',
      data: serializePurchase(purchase),
    });
  } catch (err) {
    if (!transaction.finished) await transaction.rollback();
    next(err);
  }
};

exports.listMine = async (req, res, next) => {
  try {
    const purchases = await PassengerPackagePurchase.findAll({
      where: { passenger_id: req.passenger.id },
      order: [['created_at', 'DESC']],
    });
    for (const purchase of purchases) await expirePurchaseIfNeeded(purchase);
    return res.json({ success: true, data: purchases.map(serializePurchase) });
  } catch (err) {
    next(err);
  }
};

exports.showMine = async (req, res, next) => {
  try {
    const purchase = await PassengerPackagePurchase.findOne({
      where: { id: req.params.purchaseId, passenger_id: req.passenger.id },
    });
    if (!purchase) return res.status(404).json({ success: false, message: 'Package purchase not found' });
    await expirePurchaseIfNeeded(purchase);
    return res.json({ success: true, data: serializePurchase(purchase) });
  } catch (err) {
    next(err);
  }
};

exports.usageMine = async (req, res, next) => {
  try {
    const purchase = await PassengerPackagePurchase.findOne({
      where: { id: req.params.purchaseId, passenger_id: req.passenger.id },
      attributes: ['id'],
    });
    if (!purchase) return res.status(404).json({ success: false, message: 'Package purchase not found' });
    const usage = await PackageRideUsage.findAll({
      where: { purchase_id: purchase.id },
      include: [{ model: Booking, as: 'booking', attributes: ['id', 'booking_reference', 'travel_date', 'booking_status'] }],
      order: [['reserved_at', 'DESC']],
    });
    return res.json({ success: true, data: usage });
  } catch (err) {
    next(err);
  }
};

exports.getBookingMine = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({
      where: { id: req.params.bookingId, passenger_id: req.passenger.id },
      include: [{ model: PackageRideUsage, as: 'package_ride_usage', required: false }],
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    return res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
};

exports.listAdmin = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 15));
    const where = {};
    const { status, payment_status: paymentStatus, search, from_date: fromDate, to_date: toDate } = req.query;

    if (status) where.status = status;
    if (paymentStatus) where.payment_status = paymentStatus;
    if (fromDate || toDate) {
      const validDate = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
        const date = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      };
      if ((fromDate && !validDate(fromDate)) || (toDate && !validDate(toDate))) {
        return res.status(400).json({ success: false, message: 'from_date and to_date must use YYYY-MM-DD format' });
      }
      if (fromDate && toDate && fromDate > toDate) {
        return res.status(400).json({ success: false, message: 'from_date must be on or before to_date' });
      }
      const createdAt = {};
      if (fromDate) createdAt[Op.gte] = new Date(`${fromDate}T00:00:00.000Z`);
      if (toDate) createdAt[Op.lte] = new Date(`${toDate}T23:59:59.999Z`);
      where.created_at = createdAt;
    }
    if (search) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { package_name: { [Op.like]: term } },
        { package_code: { [Op.like]: term } },
        ...(Number.isInteger(Number(search)) ? [{ id: Number(search) }] : []),
        { '$passenger.name$': { [Op.like]: term } },
        { '$passenger.mobile$': { [Op.like]: term } },
        { '$passenger.email$': { [Op.like]: term } },
      ];
    }

    const { count, rows } = await PassengerPackagePurchase.findAndCountAll({
      where,
      include: [
        { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile', 'email'] },
        {
          model: Payment,
          as: 'payments',
          attributes: ['id', 'payu_txnid', 'payu_mihpayid', 'payment_gateway', 'payment_method', 'amount', 'currency', 'status', 'created_at'],
          separate: true,
          order: [['created_at', 'DESC']],
        },
      ],
      distinct: true,
      offset: (page - 1) * limit,
      limit,
      order: [['created_at', 'DESC']],
    });

    return res.json({
      success: true,
      data: rows.map(serializePurchase),
      pagination: { total: count, page, limit, pages: Math.ceil(count / limit) },
    });
  } catch (err) {
    return next(err);
  }
};

exports.showAdmin = async (req, res, next) => {
  try {
    const purchase = await PassengerPackagePurchase.findByPk(req.params.purchaseId, {
      include: [
        { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile', 'email'] },
        {
          model: Payment,
          as: 'payments',
          attributes: ['id', 'payu_txnid', 'payu_mihpayid', 'payment_gateway', 'payment_method', 'amount', 'currency', 'status', 'event', 'created_at', 'updated_at'],
          separate: true,
          order: [['created_at', 'DESC']],
        },
        {
          model: PackageRideUsage,
          as: 'usage',
          separate: true,
          include: [{
            model: Booking,
            as: 'booking',
            attributes: ['id', 'booking_reference', 'travel_date', 'booking_status', 'boarding_status'],
          }],
          order: [['reserved_at', 'DESC']],
        },
      ],
    });
    if (!purchase) return res.status(404).json({ success: false, message: 'Package purchase not found' });
    return res.json({ success: true, data: serializePurchase(purchase) });
  } catch (err) {
    return next(err);
  }
};

exports.listTransactionsMine = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const { count, rows } = await Payment.findAndCountAll({
      where: {
        passenger_id: req.passenger.id,
        package_purchase_id: { [Op.ne]: null },
      },
      attributes: ['id', 'package_purchase_id', 'payu_txnid', 'payu_mihpayid', 'payment_gateway', 'payment_method', 'amount', 'currency', 'status', 'created_at'],
      include: [{
        model: PassengerPackagePurchase,
        as: 'package_purchase',
        attributes: ['id', 'package_name', 'package_code', 'total_rides', 'validity_days', 'status'],
      }],
      offset: (page - 1) * limit,
      limit,
      order: [['created_at', 'DESC']],
    });
    return res.json({
      success: true,
      data: rows,
      pagination: { total: count, page, limit, pages: Math.ceil(count / limit) },
    });
  } catch (err) {
    return next(err);
  }
};
