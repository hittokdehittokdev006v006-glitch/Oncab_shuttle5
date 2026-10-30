'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AdminSession = sequelize.define('AdminSession', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    references: {
      model: 'admin_users',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  session_token: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
  },
  refresh_token: {
    type: DataTypes.TEXT,
    defaultValue: null,
  },
  device_type: {
    type: DataTypes.STRING(50),
    defaultValue: 'desktop', // desktop, laptop, mobile, tablet
  },
  device_name: {
    type: DataTypes.STRING(150),
    defaultValue: 'Unknown Device',
  },
  browser: {
    type: DataTypes.STRING(100),
    defaultValue: 'Unknown Browser',
  },
  os: {
    type: DataTypes.STRING(100),
    defaultValue: 'Unknown OS',
  },
  screen_resolution: {
    type: DataTypes.STRING(60),
    defaultValue: null, // e.g. 1920x1080 (FHD)
  },
  color_depth: {
    type: DataTypes.STRING(30),
    defaultValue: null, // e.g. 24-bit
  },
  pixel_ratio: {
    type: DataTypes.STRING(20),
    defaultValue: null, // e.g. 1.25x
  },
  ip_address: {
    type: DataTypes.STRING(64),
    defaultValue: null,
  },
  user_agent: {
    type: DataTypes.TEXT,
    defaultValue: null,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  last_activity_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'admin_sessions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id', 'is_active'] },
    { fields: ['session_token'], unique: true },
    { fields: ['last_activity_at'] },
  ],
});

module.exports = AdminSession;
