'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CrossConnection = sequelize.define('CrossConnection', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  },
  connection_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  trip1_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: 'First trip reference',
  },
  trip2_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: 'Second trip reference',
  },
  vehicle1_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
  },
  vehicle2_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
  },
  driver1_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
  },
  driver2_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
  },
  route_type1: {
    type: DataTypes.STRING(50),
    defaultValue: 'Regular',
  },
  route_type2: {
    type: DataTypes.STRING(50),
    defaultValue: 'Regular',
  },
  current_distance_meters: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Current distance between vehicles in meters',
  },
  min_distance_meters: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Minimum recorded distance during this overlap',
  },
  overlap_duration_seconds: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
    comment: 'Accumulated overlapping travel time in seconds',
  },
  overlap_started_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  last_overlap_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  shared_segment_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Common corridor, city pair, or route segment name',
  },
  shared_segment_details: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Details of matched common route segment / coordinates',
  },
  status: {
    type: DataTypes.ENUM('Active', 'Completed', 'No Longer Matching'),
    defaultValue: 'Active',
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'cross_connections',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['trip1_id', 'trip2_id', 'status'],
      name: 'unique_active_trip_pair',
      where: {
        status: 'Active',
      },
    },
    {
      fields: ['status'],
      name: 'idx_cross_connections_status',
    },
    {
      fields: ['last_overlap_at'],
      name: 'idx_cross_connections_last_overlap',
    },
  ],
});

module.exports = CrossConnection;
