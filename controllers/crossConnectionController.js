'use strict';

const { Op } = require('sequelize');
const {
  CrossConnection,
  Trip,
  Route,
  Stop,
  Vehicle,
  Driver,
  SystemSetting,
} = require('../models');
const {
  evaluateCrossConnections,
  getCrossConnectionConfig,
} = require('../services/crossConnectionService');
const { logAction } = require('../middleware/auditLog');
const { hasRole } = require('../utils/roles');

/**
 * List Cross Connections with filters, sorting, search, pagination, and date-range
 * GET /api2/cross-connections
 */
exports.list = async (req, res, next) => {
  try {
    const {
      status,
      date_from,
      date_to,
      search,
      sort_by = 'last_overlap_at',
      sort_order = 'DESC',
      page = 1,
      limit = 15,
      route_type,
    } = req.query;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
    const offset = (p - 1) * l;

    const where = {};

    // Status filter
    if (status && status !== 'All') {
      where.status = status;
    }

    // Route Type filter
    if (route_type && route_type !== 'All') {
      where[Op.or] = [
        { route_type1: route_type },
        { route_type2: route_type },
      ];
    }

    // Date range filter
    if (date_from || date_to) {
      where.last_overlap_at = {};
      if (date_from) {
        where.last_overlap_at[Op.gte] = new Date(`${date_from} 00:00:00`);
      }
      if (date_to) {
        where.last_overlap_at[Op.lte] = new Date(`${date_to} 23:59:59`);
      }
    }

    // Search query on connection code, shared segment name, or notes
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      where[Op.or] = [
        { connection_code: { [Op.like]: q } },
        { shared_segment_name: { [Op.like]: q } },
        { notes: { [Op.like]: q } },
      ];
    }

    // Owner role isolation
    const isOwner = hasRole(req.user, 'owner');
    let vehicleCondition = null;
    if (isOwner) {
      const ownedVehicles = await Vehicle.findAll({
        where: { owner_id: req.user.id },
        attributes: ['id'],
        raw: true,
      });
      const ownedVehicleIds = ownedVehicles.map((v) => v.id);
      if (ownedVehicleIds.length) {
        vehicleCondition = {
          [Op.or]: [
            { vehicle1_id: { [Op.in]: ownedVehicleIds } },
            { vehicle2_id: { [Op.in]: ownedVehicleIds } },
          ],
        };
      } else {
        return res.json({
          success: true,
          data: {
            rows: [],
            total: 0,
            page: p,
            limit: l,
            total_pages: 0,
            summary: { active: 0, completed: 0, no_longer_matching: 0, total: 0 },
          },
        });
      }
    }

    const finalWhere = vehicleCondition ? { [Op.and]: [where, vehicleCondition] } : where;

    // Allowed sort columns
    const allowedSortColumns = [
      'id',
      'current_distance_meters',
      'overlap_duration_seconds',
      'last_overlap_at',
      'overlap_started_at',
      'status',
    ];
    const orderColumn = allowedSortColumns.includes(sort_by) ? sort_by : 'last_overlap_at';
    const orderDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const { count, rows } = await CrossConnection.findAndCountAll({
      where: finalWhere,
      include: [
        {
          model: Trip,
          as: 'trip1',
          attributes: ['id', 'schedule_code', 'trip_date', 'departure_time', 'arrival_time', 'status', 'route_id'],
          include: [{ model: Route, as: 'route', attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'] }],
        },
        {
          model: Trip,
          as: 'trip2',
          attributes: ['id', 'schedule_code', 'trip_date', 'departure_time', 'arrival_time', 'status', 'route_id'],
          include: [{ model: Route, as: 'route', attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'] }],
        },
        {
          model: Vehicle,
          as: 'vehicle1',
          attributes: ['id', 'registration_number', 'company_model', 'color', 'status'],
        },
        {
          model: Vehicle,
          as: 'vehicle2',
          attributes: ['id', 'registration_number', 'company_model', 'color', 'status'],
        },
        {
          model: Driver,
          as: 'driver1',
          attributes: ['id', 'name', 'mobile', 'online_status'],
        },
        {
          model: Driver,
          as: 'driver2',
          attributes: ['id', 'name', 'mobile', 'online_status'],
        },
      ],
      order: [[orderColumn, orderDirection]],
      limit: l,
      offset,
    });

    // Counts for dashboard summary cards
    const [activeCount, completedCount, noLongerCount] = await Promise.all([
      CrossConnection.count({ where: vehicleCondition ? { [Op.and]: [{ status: 'Active' }, vehicleCondition] } : { status: 'Active' } }),
      CrossConnection.count({ where: vehicleCondition ? { [Op.and]: [{ status: 'Completed' }, vehicleCondition] } : { status: 'Completed' } }),
      CrossConnection.count({ where: vehicleCondition ? { [Op.and]: [{ status: 'No Longer Matching' }, vehicleCondition] } : { status: 'No Longer Matching' } }),
    ]);

    res.json({
      success: true,
      data: {
        rows,
        total: count,
        page: p,
        limit: l,
        total_pages: Math.ceil(count / l),
        summary: {
          active: activeCount,
          completed: completedCount,
          no_longer_matching: noLongerCount,
          total: activeCount + completedCount + noLongerCount,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get detailed cross-connection record including route stops, vehicle positions, and full geometry
 * GET /api2/cross-connections/:id
 */
exports.show = async (req, res, next) => {
  try {
    const { id } = req.params;
    const connection = await CrossConnection.findByPk(id, {
      include: [
        {
          model: Trip,
          as: 'trip1',
          include: [
            {
              model: Route,
              as: 'route',
              include: [{ model: Stop, as: 'physical_stops', required: false }],
            },
            { model: Vehicle, as: 'vehicle' },
            { model: Driver, as: 'driver' },
          ],
        },
        {
          model: Trip,
          as: 'trip2',
          include: [
            {
              model: Route,
              as: 'route',
              include: [{ model: Stop, as: 'physical_stops', required: false }],
            },
            { model: Vehicle, as: 'vehicle' },
            { model: Driver, as: 'driver' },
          ],
        },
        { model: Vehicle, as: 'vehicle1' },
        { model: Vehicle, as: 'vehicle2' },
        { model: Driver, as: 'driver1' },
        { model: Driver, as: 'driver2' },
      ],
    });

    if (!connection) {
      return res.status(404).json({ success: false, message: 'Cross connection record not found' });
    }

    res.json({
      success: true,
      data: connection,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Manually trigger live cross-connection detection and re-evaluation
 * POST /api2/cross-connections/evaluate
 */
exports.evaluate = async (req, res, next) => {
  try {
    const result = await evaluateCrossConnections();
    res.json({
      success: true,
      message: `Evaluated ${result.evaluatedCount} active trips across all route types. Found ${result.activeMatchesCount} active cross connections.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get dynamic configuration for Cross Connection
 * GET /api2/cross-connections/config
 */
exports.getConfig = async (req, res, next) => {
  try {
    const config = await getCrossConnectionConfig();
    res.json({
      success: true,
      data: config,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update dynamic configuration for Cross Connection
 * PUT /api2/cross-connections/config
 */
exports.updateConfig = async (req, res, next) => {
  try {
    const {
      cross_connection_max_distance_meters,
      cross_connection_min_overlap_minutes,
      cross_connection_eval_frequency_seconds,
      cross_connection_supported_route_types,
      cross_connection_match_expiration_minutes,
      cross_connection_heading_tolerance_degrees,
    } = req.body;

    const updates = [];

    if (cross_connection_max_distance_meters !== undefined) {
      const val = parseFloat(cross_connection_max_distance_meters);
      if (isNaN(val) || val < 10) {
        return res.status(400).json({ success: false, message: 'Max distance must be at least 10 meters' });
      }
      updates.push({
        key: 'cross_connection_max_distance_meters',
        value: String(val),
        label: 'Cross Connection Max Distance (Meters)',
        group: 'cross_connection',
        type: 'number',
        description: 'Maximum distance between vehicles or routes to qualify for cross connection',
      });
    }

    if (cross_connection_min_overlap_minutes !== undefined) {
      const val = parseFloat(cross_connection_min_overlap_minutes);
      if (isNaN(val) || val < 1) {
        return res.status(400).json({ success: false, message: 'Min overlap must be at least 1 minute' });
      }
      updates.push({
        key: 'cross_connection_min_overlap_minutes',
        value: String(val),
        label: 'Cross Connection Min Overlap Duration (Minutes)',
        group: 'cross_connection',
        type: 'number',
        description: 'Minimum travel duration sharing common segment to qualify as cross connection',
      });
    }

    if (cross_connection_eval_frequency_seconds !== undefined) {
      const val = parseInt(cross_connection_eval_frequency_seconds, 10);
      if (isNaN(val) || val < 5) {
        return res.status(400).json({ success: false, message: 'Evaluation frequency must be at least 5 seconds' });
      }
      updates.push({
        key: 'cross_connection_eval_frequency_seconds',
        value: String(val),
        label: 'Cross Connection Evaluation Frequency (Seconds)',
        group: 'cross_connection',
        type: 'number',
        description: 'Frequency at which vehicle locations are checked for cross connections',
      });
    }

    if (cross_connection_supported_route_types !== undefined) {
      updates.push({
        key: 'cross_connection_supported_route_types',
        value: String(cross_connection_supported_route_types).trim(),
        label: 'Cross Connection Supported Route Types',
        group: 'cross_connection',
        type: 'string',
        description: 'Comma-separated list of route types to include in cross connection detection',
      });
    }

    if (cross_connection_match_expiration_minutes !== undefined) {
      const val = parseFloat(cross_connection_match_expiration_minutes);
      if (isNaN(val) || val < 1) {
        return res.status(400).json({ success: false, message: 'Match expiration must be at least 1 minute' });
      }
      updates.push({
        key: 'cross_connection_match_expiration_minutes',
        value: String(val),
        label: 'Cross Connection Match Expiration (Minutes)',
        group: 'cross_connection',
        type: 'number',
        description: 'Time without GPS ping before active match is marked No Longer Matching',
      });
    }

    if (cross_connection_heading_tolerance_degrees !== undefined) {
      const val = parseFloat(cross_connection_heading_tolerance_degrees);
      if (isNaN(val) || val < 10 || val > 180) {
        return res.status(400).json({ success: false, message: 'Heading tolerance must be between 10 and 180 degrees' });
      }
      updates.push({
        key: 'cross_connection_heading_tolerance_degrees',
        value: String(val),
        label: 'Cross Connection Heading Tolerance (Degrees)',
        group: 'cross_connection',
        type: 'number',
        description: 'Maximum heading angle difference to consider vehicles traveling in same direction',
      });
    }

    for (const u of updates) {
      await SystemSetting.upsert(u);
    }

    // Audit log
    await logAction(req.user?.id, 'UPDATE_CROSS_CONNECTION_CONFIG', 'system_settings', null, {
      updates,
    });

    const updatedConfig = await getCrossConnectionConfig();
    res.json({
      success: true,
      message: 'Cross connection configuration saved successfully',
      data: updatedConfig,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Export Cross Connections data to JSON or CSV format
 * GET /api2/cross-connections/export
 */
exports.export = async (req, res, next) => {
  try {
    const { format = 'json', status, date_from, date_to } = req.query;

    const where = {};
    if (status && status !== 'All') where.status = status;
    if (date_from || date_to) {
      where.last_overlap_at = {};
      if (date_from) where.last_overlap_at[Op.gte] = new Date(`${date_from} 00:00:00`);
      if (date_to) where.last_overlap_at[Op.lte] = new Date(`${date_to} 23:59:59`);
    }

    const records = await CrossConnection.findAll({
      where,
      include: [
        {
          model: Trip,
          as: 'trip1',
          attributes: ['id', 'schedule_code', 'trip_date', 'departure_time'],
          include: [{ model: Route, as: 'route', attributes: ['route_name', 'route_code'] }],
        },
        {
          model: Trip,
          as: 'trip2',
          attributes: ['id', 'schedule_code', 'trip_date', 'departure_time'],
          include: [{ model: Route, as: 'route', attributes: ['route_name', 'route_code'] }],
        },
        { model: Vehicle, as: 'vehicle1', attributes: ['registration_number'] },
        { model: Vehicle, as: 'vehicle2', attributes: ['registration_number'] },
        { model: Driver, as: 'driver1', attributes: ['name', 'mobile'] },
        { model: Driver, as: 'driver2', attributes: ['name', 'mobile'] },
      ],
      order: [['last_overlap_at', 'DESC']],
      limit: 1000,
    });

    if (format === 'csv') {
      const headers = [
        'Connection Code',
        'Status',
        'Trip 1 ID',
        'Route 1',
        'Vehicle 1',
        'Driver 1',
        'Trip 2 ID',
        'Route 2',
        'Vehicle 2',
        'Driver 2',
        'Current Distance (m)',
        'Overlap Duration (min)',
        'Shared Segment',
        'Last Overlap Timestamp',
      ];

      const csvRows = [headers.join(',')];

      for (const r of records) {
        const overlapMinutes = Math.round((r.overlap_duration_seconds || 0) / 60);
        const row = [
          `"${r.connection_code || ''}"`,
          `"${r.status || ''}"`,
          `"${r.trip1_id || ''}"`,
          `"${r.trip1?.route?.route_name || ''}"`,
          `"${r.vehicle1?.registration_number || ''}"`,
          `"${r.driver1?.name || ''}"`,
          `"${r.trip2_id || ''}"`,
          `"${r.trip2?.route?.route_name || ''}"`,
          `"${r.vehicle2?.registration_number || ''}"`,
          `"${r.driver2?.name || ''}"`,
          `"${r.current_distance_meters || 0}"`,
          `"${overlapMinutes}"`,
          `"${r.shared_segment_name || ''}"`,
          `"${r.last_overlap_at ? new Date(r.last_overlap_at).toISOString() : ''}"`,
        ];
        csvRows.push(row.join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cross_connections_${new Date().toISOString().slice(0, 10)}.csv"`
      );
      return res.send(csvRows.join('\n'));
    }

    res.json({
      success: true,
      data: records,
    });
  } catch (err) {
    next(err);
  }
};
