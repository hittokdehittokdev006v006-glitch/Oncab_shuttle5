'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ShuttleBooking = sequelize.define('ShuttleBooking', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  booking_id: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  user_id: { type: DataTypes.BIGINT.UNSIGNED, defaultValue: null },
  passenger_name: { type: DataTypes.STRING(100), defaultValue: null },
  passenger_mobile: { type: DataTypes.STRING(20), defaultValue: null },
  schedule_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  route_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  pickup_stop_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  drop_stop_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  travel_date: { type: DataTypes.DATEONLY, allowNull: false },
  pickup_time: { type: DataTypes.TIME, allowNull: false },
  drop_time: { type: DataTypes.TIME, allowNull: false },
  fare: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  seat_count: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 1 },
  total_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  pickup_stop_name: { type: DataTypes.STRING(150), defaultValue: null },
  drop_stop_name: { type: DataTypes.STRING(150), defaultValue: null },
  package_id: { type: DataTypes.BIGINT.UNSIGNED, defaultValue: null },
  package_name: { type: DataTypes.STRING(100), defaultValue: null },
  package_price_snapshot: { type: DataTypes.DECIMAL(10, 2), defaultValue: null },
  package_rides_count: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: null },
  package_price_per_ride: { type: DataTypes.DECIMAL(10, 2), defaultValue: null },
  is_package_booking: { type: DataTypes.BOOLEAN, defaultValue: false },
  status: { type: DataTypes.ENUM('pending', 'confirmed', 'cancelled', 'completed', 'no_show'), defaultValue: 'confirmed' },
  payment_status: { type: DataTypes.ENUM('pending', 'paid', 'failed', 'refunded'), defaultValue: 'paid' },
  payment_method: { type: DataTypes.STRING(50), defaultValue: 'cash' },
  qr_code: { type: DataTypes.TEXT, defaultValue: null },
}, {
  tableName: 'shuttle_bookings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = ShuttleBooking;
