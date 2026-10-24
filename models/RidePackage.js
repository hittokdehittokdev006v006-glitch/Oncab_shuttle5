'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RidePackage = sequelize.define('RidePackage', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  },
  package_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  package_type: {
    type: DataTypes.ENUM('single_trip', 'fixed_bundle', 'daily', 'weekly', 'monthly', 'quarterly', 'annual'),
    defaultValue: 'fixed_bundle',
    allowNull: false,
  },
  rides_count: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 10,
  },
  validity_days: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 30,
  },
  price_per_ride: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  total_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  original_price: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: null,
  },
  discount_percentage: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
  },
  route_id: {
    type: DataTypes.BIGINT.UNSIGNED,
    defaultValue: null,
  },
  description: {
    type: DataTypes.TEXT,
    defaultValue: null,
  },
  features: {
    type: DataTypes.JSON,
    defaultValue: null,
  },
  badge_text: {
    type: DataTypes.STRING(50),
    defaultValue: null,
  },
  is_popular: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  status: {
    type: DataTypes.ENUM('Active', 'Inactive'),
    defaultValue: 'Active',
  },
  deleted_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
}, {
  tableName: 'ride_packages',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  paranoid: true,
  deletedAt: 'deleted_at',
});

module.exports = RidePackage;
