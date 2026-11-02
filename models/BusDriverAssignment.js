'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BusDriverAssignment = sequelize.define('BusDriverAssignment', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  schedule_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  driver_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  assignment_date: { type: DataTypes.DATEONLY, allowNull: false },
  reporting_time: { type: DataTypes.TIME, allowNull: false },
  status: { type: DataTypes.ENUM('assigned', 'accepted', 'started', 'completed', 'cancelled'), defaultValue: 'assigned' },
  start_odometer: { type: DataTypes.DECIMAL(10, 2), defaultValue: null },
  end_odometer: { type: DataTypes.DECIMAL(10, 2), defaultValue: null },
  notes: { type: DataTypes.TEXT, defaultValue: null },
  car_id: { type: DataTypes.BIGINT.UNSIGNED, defaultValue: null },
}, {
  tableName: 'bus_driver_assignments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['schedule_id', 'assignment_date'], name: 'bus_driver_assignment_schedule_date_unique' },
    { fields: ['driver_id', 'assignment_date', 'status'], name: 'bus_driver_assignment_driver_date_status' },
  ],
});

module.exports = BusDriverAssignment;