'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Refund = sequelize.define('Refund', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  booking_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  payment_id: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  passenger_id: { type: DataTypes.BIGINT.UNSIGNED, defaultValue: null },
  refund_reference: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  refund_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  refund_method: { type: DataTypes.STRING(50), defaultValue: null },
  refund_reason: { type: DataTypes.TEXT, defaultValue: null },
  gateway_refund_id: { type: DataTypes.STRING(100), defaultValue: null },
  gateway_response: { type: DataTypes.JSON, defaultValue: null },
  payu_txnid: { type: DataTypes.STRING(100), defaultValue: null },
  payu_mihpayid: { type: DataTypes.STRING(100), defaultValue: null },
  status: { type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'), defaultValue: 'pending' },
  initiated_by: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  processed_at: { type: DataTypes.DATE, defaultValue: null },
  failure_reason: { type: DataTypes.TEXT, defaultValue: null },
  retry_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  notes: { type: DataTypes.TEXT, defaultValue: null },
}, {
  tableName: 'refunds',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Refund;
