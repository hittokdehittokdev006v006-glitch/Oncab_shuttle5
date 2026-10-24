'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Payment = sequelize.define('Payment', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  booking_id: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  package_purchase_id: { type: DataTypes.BIGINT.UNSIGNED, defaultValue: null },
  passenger_id: { type: DataTypes.BIGINT.UNSIGNED, defaultValue: null },
  razorpay_payment_id: { type: DataTypes.STRING(100), defaultValue: null },
  razorpay_order_id: { type: DataTypes.STRING(100), defaultValue: null },
  razorpay_signature: { type: DataTypes.STRING(255), defaultValue: null },
  payment_gateway: { type: DataTypes.STRING(30), defaultValue: null },
  payu_txnid: { type: DataTypes.STRING(100), defaultValue: null, unique: true },
  payu_mihpayid: { type: DataTypes.STRING(100), defaultValue: null },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  currency: { type: DataTypes.STRING(10), defaultValue: 'INR' },
  payment_method: { type: DataTypes.STRING(50), defaultValue: null },
  status: { type: DataTypes.ENUM('pending', 'captured', 'failed', 'refunded', 'partial_refund'), defaultValue: 'pending' },
  event: { type: DataTypes.STRING(100), defaultValue: null },
  payload: { type: DataTypes.JSON, defaultValue: null },
  gateway_response: { type: DataTypes.JSON, defaultValue: null },
}, {
  tableName: 'payments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Payment;
