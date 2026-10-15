'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OwnerKyc = sequelize.define('OwnerKyc', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  owner_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  owner_name: { type: DataTypes.STRING(150), allowNull: false },
  owner_email: { type: DataTypes.STRING(150), allowNull: false },
  owner_mobile: { type: DataTypes.STRING(25), allowNull: false },
  vehicle_id: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  vehicle_number: { type: DataTypes.STRING(35), defaultValue: null },
  aadhaar_number: { type: DataTypes.STRING(20), allowNull: false },
  pan_number: { type: DataTypes.STRING(20), allowNull: false },
  bank_name: { type: DataTypes.STRING(150), allowNull: false },
  account_holder_name: { type: DataTypes.STRING(150), allowNull: false },
  account_number: { type: DataTypes.STRING(50), allowNull: false },
  ifsc_code: { type: DataTypes.STRING(20), allowNull: false },
  upi_id: { type: DataTypes.STRING(100), defaultValue: null },
  status: { type: DataTypes.ENUM('pending', 'verified', 'rejected'), defaultValue: 'pending' },
  admin_note: { type: DataTypes.TEXT, defaultValue: null },
  verified_by: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  verified_at: { type: DataTypes.DATE, defaultValue: null },
}, {
  tableName: 'owner_kycs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = OwnerKyc;
