'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OwnerSettlement = sequelize.define('OwnerSettlement', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  },
  settlement_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  owner_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
  },
  owner_name: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  owner_mobile: {
    type: DataTypes.STRING(25),
    defaultValue: null,
  },
  owner_email: {
    type: DataTypes.STRING(150),
    defaultValue: null,
  },
  vehicle_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    defaultValue: null,
  },
  vehicle_number: {
    type: DataTypes.STRING(35),
    allowNull: false,
  },
  requested_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  tds_percentage: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  tds_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  net_payable_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  account_number: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  bank_name: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  ifsc_code: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  account_holder_name: {
    type: DataTypes.STRING(150),
    defaultValue: null,
  },
  upi_id: {
    type: DataTypes.STRING(100),
    defaultValue: null,
  },
  owner_notes: {
    type: DataTypes.TEXT,
    defaultValue: null,
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending',
    allowNull: false,
  },
  utr_number: {
    type: DataTypes.STRING(100),
    defaultValue: null,
  },
  admin_note: {
    type: DataTypes.TEXT,
    defaultValue: null,
  },
  processed_by: {
    type: DataTypes.INTEGER.UNSIGNED,
    defaultValue: null,
  },
  processed_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
}, {
  tableName: 'owner_settlements',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = OwnerSettlement;
