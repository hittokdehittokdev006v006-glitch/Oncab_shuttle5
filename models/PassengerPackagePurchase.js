'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PassengerPackagePurchase = sequelize.define('PassengerPackagePurchase', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  passenger_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  package_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  route_id: { type: DataTypes.BIGINT.UNSIGNED, defaultValue: null },
  package_code: { type: DataTypes.STRING(50), allowNull: false },
  package_name: { type: DataTypes.STRING(100), allowNull: false },
  total_rides: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  used_rides: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  reserved_rides: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  validity_days: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  price_per_ride: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  amount_paid: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  payment_status: {
    type: DataTypes.ENUM('pending', 'paid', 'failed', 'refunded'),
    allowNull: false,
    defaultValue: 'pending',
  },
  status: {
    type: DataTypes.ENUM('pending_payment', 'active', 'exhausted', 'expired', 'cancelled', 'refunded'),
    allowNull: false,
    defaultValue: 'pending_payment',
  },
  purchased_at: { type: DataTypes.DATE, defaultValue: null },
  expires_at: { type: DataTypes.DATE, defaultValue: null },
}, {
  tableName: 'passenger_package_purchases',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['passenger_id', 'status'] },
    { fields: ['expires_at'] },
  ],
});

module.exports = PassengerPackagePurchase;
