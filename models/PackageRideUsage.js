'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PackageRideUsage = sequelize.define('PackageRideUsage', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  purchase_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  booking_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
  rides_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  status: {
    type: DataTypes.ENUM('reserved', 'consumed', 'released'),
    allowNull: false,
    defaultValue: 'reserved',
  },
  reserved_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  consumed_at: { type: DataTypes.DATE, defaultValue: null },
  released_at: { type: DataTypes.DATE, defaultValue: null },
}, {
  tableName: 'package_ride_usage',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['purchase_id', 'status'] },
  ],
});

module.exports = PackageRideUsage;
