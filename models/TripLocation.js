'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TripLocation = sequelize.define('TripLocation', {
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
  driver_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: 'Foreign key to drivers.id',
  },
  vehicle_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: 'Foreign key to vehicles.id (if known)',
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 7),
    allowNull: false,
  },
  longitude: {
    type: DataTypes.DECIMAL(10, 7),
    allowNull: false,
  },
  speed_kmh: {
    type: DataTypes.DECIMAL(7, 2),
    allowNull: true,
    defaultValue: null,
  },
  heading: {
    type: DataTypes.DECIMAL(6, 2),
    allowNull: true,
    defaultValue: null,
  },
  accuracy: {
    type: DataTypes.DECIMAL(6, 2),
    allowNull: true,
    defaultValue: null,
    comment: 'Horizontal GPS accuracy radius in meters',
  },
  battery_level: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    defaultValue: null,
  },
  recorded_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'trip_locations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      name: 'idx_trip_locations_trip_recorded',
      fields: ['trip_id', 'recorded_at'],
    },
    {
      name: 'idx_trip_locations_recorded_at',
      fields: ['recorded_at'],
    },
    {
      name: 'idx_trip_locations_driver_id',
      fields: ['driver_id'],
    },
  ],
});

module.exports = TripLocation;
