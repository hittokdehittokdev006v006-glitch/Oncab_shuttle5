'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PayuWebhook = sequelize.define('PayuWebhook', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  event_type: { type: DataTypes.STRING(100), defaultValue: null },
  payu_txnid: { type: DataTypes.STRING(100), defaultValue: null },
  payu_mihpayid: { type: DataTypes.STRING(100), defaultValue: null },
  booking_id: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  payment_id: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  refund_id: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  status: { type: DataTypes.STRING(50), defaultValue: null },
  amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: null },
  payload: { type: DataTypes.JSON, defaultValue: null },
  hash_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
  processed: { type: DataTypes.BOOLEAN, defaultValue: false },
  processed_at: { type: DataTypes.DATE, defaultValue: null },
}, {
  tableName: 'payu_webhooks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = PayuWebhook;
