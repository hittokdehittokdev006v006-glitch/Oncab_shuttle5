'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TripStopArrival = sequelize.define('TripStopArrival', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  },
  trip_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: 'Foreign key to trips.id',
  },
  stop_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: 'Foreign key to stops.id',
  },
  driver_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: 'Foreign key to drivers.id',
  },
  vehicle_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    defaultValue: null,
    comment: 'Foreign key to vehicles.id (if known)',
  },
  stop_sequence: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  stop_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  scheduled_arrival_time: {
    type: DataTypes.TIME,
    allowNull: true,
    defaultValue: null,
  },
  arrived_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'Timestamp when driver reached this stoppage',
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
    comment: 'Timestamp when driver departed / completed operations at this stoppage',
  },
  status: {
    type: DataTypes.ENUM('ARRIVED', 'COMPLETED', 'SKIPPED'),
    allowNull: false,
    defaultValue: 'ARRIVED',
  },
  arrival_latitude: {
    type: DataTypes.DECIMAL(10, 7),
    allowNull: true,
    defaultValue: null,
  },
  arrival_longitude: {
    type: DataTypes.DECIMAL(10, 7),
    allowNull: true,
    defaultValue: null,
  },
  passengers_boarded: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  passengers_pending: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  passengers_no_show: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: null,
  },
}, {
  tableName: 'trip_stop_arrivals',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      name: 'unique_trip_stop',
      unique: true,
      fields: ['trip_id', 'stop_id'],
    },
    {
      name: 'idx_trip_stop_arrived_at',
      fields: ['arrived_at'],
    },
    {
      name: 'idx_trip_stop_driver',
      fields: ['driver_id'],
    },
    {
      name: 'idx_trip_stop_vehicle',
      fields: ['vehicle_id'],
    },
  ],
});

module.exports = TripStopArrival;
