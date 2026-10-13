'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Banner = sequelize.define('Banner', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  },
  title: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  subtitle: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  banner_type: {
    type: DataTypes.ENUM('image', 'video'),
    allowNull: false,
    defaultValue: 'image',
  },
  media_url: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  thumbnail_url: {
    type: DataTypes.TEXT,
    defaultValue: null,
  },
  video_type: {
    type: DataTypes.ENUM('file', 'youtube', 'vimeo', 'external_url'),
    defaultValue: 'file',
  },
  cta_title: {
    type: DataTypes.STRING(100),
    defaultValue: null,
  },
  cta_url: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  position: {
    type: DataTypes.STRING(50),
    defaultValue: 'home_top',
  },
  display_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  start_date: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  end_date: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  autoplay: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  is_muted: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  loop_video: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  show_controls: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  click_count: {
    type: DataTypes.INTEGER.UNSIGNED,
    defaultValue: 0,
  },
  view_count: {
    type: DataTypes.INTEGER.UNSIGNED,
    defaultValue: 0,
  },
  created_by: {
    type: DataTypes.INTEGER.UNSIGNED,
    defaultValue: null,
  },
  deleted_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
}, {
  tableName: 'banners',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  paranoid: true,
  deletedAt: 'deleted_at',
});

module.exports = Banner;
