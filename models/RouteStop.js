'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RouteStop = sequelize.define('RouteStop', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  route_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  stop_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  stop_sequence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  travel_time_minutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0, comment: 'Minutes from the previous route stop; zero for the first stop' },
  pickup_allowed: { type: DataTypes.BOOLEAN, defaultValue: true },
  dropoff_allowed: { type: DataTypes.BOOLEAN, defaultValue: true },
  status: { type: DataTypes.ENUM('Active', 'Inactive'), defaultValue: 'Active' },
}, {
  tableName: 'route_stops',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['route_id', 'stop_id'] },
    { unique: true, fields: ['route_id', 'stop_sequence'] },
  ],
});

module.exports = RouteStop;
