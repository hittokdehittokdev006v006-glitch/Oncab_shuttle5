'use strict';

const { Op, UniqueConstraintError } = require('sequelize');
const { sequelize, Driver, DriverDetail, BusType, Route, Stop, BusRoute, BusStop, BusSchedule, BusDriverAssignment, Trip } = require('../models');
const { getOrderedStopsForRoute } = require('../utils/routeStops');
const { COMPLETION_RADIUS_METERS, checkProximityToStop, getCompletionRadiusMeters } = require('../utils/geoUtils');

const assignmentIncludes = [
  {
    model: BusSchedule,
    as: 'schedule',
    include: [
      {
        model: Route,
        as: 'main_route',
        required: false,
        include: [{ model: Stop, as: 'stops', required: false }],
      },
      { model: BusType, as: 'bus_type', required: false },
    ],
  },
];

const formatScheduleRoute = (schedule) => {
  if (!schedule) return schedule;
  const item = typeof schedule.toJSON === 'function' ? schedule.toJSON() : schedule;
  if (item.main_route) {
    item.route = item.main_route;
    delete item.main_route;
  }
  return item;
};

const attachScheduleStops = async (schedule) => {
  if (!schedule) return schedule;

  const item = typeof schedule.toJSON === 'function' ? schedule.toJSON() : schedule;
  const routeId = item.route_id || item.main_route?.id || item.route?.id;
  const stops = routeId
    ? await getOrderedStopsForRoute(routeId, item.departure_time)
    : [];

  // Keep the legacy main_route shape and also expose a clear driver-facing schedule.
  if (item.main_route) item.main_route.stops = stops;
  if (item.route) item.route.stops = stops;
  item.stop_schedule = stops;
  return item;
};

const todayDate = () => new Date().toISOString().slice(0, 10);

const parseAssignmentDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const getEligibleDriver = async (driverId) => {
  const driver = await Driver.findByPk(driverId);
  if (!driver) return { error: [404, 'Driver not found'] };
  if (!driver.is_bus_driver) {
    return { error: [403, 'This account is not registered as a bus driver'] };
  }
  if (!driver.preferred_bus_type_id) return { error: [403, 'A preferred bus type is required'] };
  if (driver.status !== 'Approve') return { error: [403, 'Driver account must be approved'] };
  if (driver.complete_status !== 'Complete') return { error: [403, 'Complete driver documents before accepting assignments'] };
  return { driver };
};

const respondForEligibility = (res, result) => {
  if (!result.error) return false;
  res.status(result.error[0]).json({ status: result.error[0], success: false, message: result.error[1] });
  return true;
};

const formatDateStr = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
};

const scheduleCanRunOnDate = (schedule, date) => {
  const dateText = date.toISOString().slice(0, 10);
  const validFrom = formatDateStr(schedule.valid_from);
  const validUntil = formatDateStr(schedule.valid_until);
  const tripDate = formatDateStr(schedule.trip_date);

  if (validFrom && validFrom > dateText) return false;
  if (validUntil && validUntil < dateText) return false;
  if (tripDate && tripDate !== dateText) return false;

  if (!schedule.operating_days) return true;
  const operatingDays = String(schedule.operating_days || '').toLowerCase().split(/[,:]/).map((day) => day.trim());
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getUTCDay()];
  return operatingDays.includes(weekday);
};

// exports.getAvailableSchedules = async (req, res, next) => {
//   try {
//     const eligibility = await getEligibleDriver(req.driver.id);
//     if (respondForEligibility(res, eligibility)) return;

//     const requestedDate = req.body?.assignment_date || req.query?.assignment_date;
//     const date = requestedDate ? parseAssignmentDate(requestedDate) : null;
//     if (requestedDate && (!date || date < new Date(`${todayDate()}T00:00:00.000Z`))) {
//       return res.status(400).json({ status: 400, success: false, message: 'assignment_date must be a valid date today or later' });
//     }

//     const existingAssignments = await BusDriverAssignment.findAll({
//       attributes: ['schedule_id'],
//       where: {
//         ...(requestedDate ? { assignment_date: requestedDate } : { assignment_date: { [Op.gte]: todayDate() } }),
//         status: { [Op.ne]: 'cancelled' },
//       },
//     });
//     const assignedScheduleIds = [...new Set(existingAssignments.map((item) => String(item.schedule_id)))];
//     const requestedBusTypeId = req.body?.bus_type_id || req.query?.bus_type_id;

//     const where = {
//       status: { [Op.in]: ['Active', 'Scheduled'] },
//     };

//     if (requestedBusTypeId) {
//       where.bus_type_id = requestedBusTypeId;
//     }

//     if (assignedScheduleIds.length) where.id = { [Op.notIn]: assignedScheduleIds };

//     const schedules = await BusSchedule.findAll({
//       where,
//       include: [
//         {
//           model: Route,
//           as: 'main_route',
//           required: false,
//           include: [{ model: Stop, as: 'stops', required: false }],
//         },
//         { model: BusType, as: 'bus_type', required: false },
//       ],
//       order: [['departure_time', 'ASC']],
//     });

//     let available = date ? schedules.filter((schedule) => scheduleCanRunOnDate(schedule, date)) : schedules;

//     // Prioritize schedules matching driver's preferred_bus_type_id
//     if (eligibility.driver.preferred_bus_type_id) {
//       const preferredTypeId = String(eligibility.driver.preferred_bus_type_id);
//       available.sort((a, b) => {
//         const aMatch = String(a.bus_type_id) === preferredTypeId ? 0 : 1;
//         const bMatch = String(b.bus_type_id) === preferredTypeId ? 0 : 1;
//         return aMatch - bMatch;
//       });
//     }

//     const data = await Promise.all(available.map(async (schedule) => {
//       const item = formatScheduleRoute(schedule);
//       return attachScheduleStops(item);
//     }));

//     res.json({
//       status: 200,
//       success: true,
//       message: 'Available schedules retrieved successfully',
//       data,
//     });
//   } catch (err) {
//     next(err);
//   }
// };



const scheduleSqlLogger = (sql, timing) => {
  console.log('\n========== getAvailableSchedules | SQL ==========');
  console.log('[getAvailableSchedules SQL]', sql);

  if (timing !== undefined) {
    console.log('[getAvailableSchedules SQL TIME]', `${timing} ms`);
  }

  console.log('=================================================\n');
};

exports.getAvailableSchedules = async (req, res, next) => {
  try {
    console.log('\n========== getAvailableSchedules | START ==========');

    console.log(
      '[getAvailableSchedules] Driver ID:',
      req.driver?.id
    );

    console.log(
      '[getAvailableSchedules] Request body:',
      req.body
    );

    console.log(
      '[getAvailableSchedules] Request query:',
      req.query
    );

    const eligibility = await getEligibleDriver(req.driver.id);

    if (respondForEligibility(res, eligibility)) return;

    const requestedDate =
      req.body?.assignment_date || req.query?.assignment_date;

    const date = requestedDate
      ? parseAssignmentDate(requestedDate)
      : null;

    if (
      requestedDate &&
      (!date || date < new Date(`${todayDate()}T00:00:00.000Z`))
    ) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: 'assignment_date must be a valid date today or later',
      });
    }

    const isDriver =
      req.body?.is_driver === true ||
      req.body?.is_driver === 'true';

    const requestedBusTypeId =
      req.body?.bus_type_id || req.query?.bus_type_id;

    console.log(
      '[getAvailableSchedules] Mode:',
      isDriver ? 'DRIVER TRIPS' : 'AVAILABLE TRIPS'
    );

    console.log(
      '[getAvailableSchedules] Requested date:',
      requestedDate || 'Today and future'
    );

    console.log(
      '[getAvailableSchedules] Bus type:',
      requestedBusTypeId || 'All'
    );

    let trips = [];

    // =====================================================
    // DRIVER MODE: Fetch trips directly assigned to driver
    // =====================================================
    if (isDriver) {
      const tripWhere = {
        driver_id: req.driver.id,
        status: { [Op.in]: ['Active', 'Scheduled'] },
        ...(requestedDate
          ? { trip_date: requestedDate }
          : { trip_date: { [Op.gte]: todayDate() } }),
      };

      if (requestedBusTypeId) {
        tripWhere.bus_type_id = requestedBusTypeId;
      }

      console.log(
        '[getAvailableSchedules] Trip WHERE:',
        tripWhere
      );

      trips = await Trip.findAll({
        where: tripWhere,
        logging: scheduleSqlLogger,
        benchmark: true,
        include: [
          {
            model: Route,
            as: 'route',
            required: false,
            include: [
              {
                model: Stop,
                as: 'stops',
                required: false,
              },
            ],
          },
          {
            model: BusType,
            as: 'bus_type',
            required: false,
          },
        ],
        order: [['departure_time', 'ASC']],
      });

      console.log(
        '[getAvailableSchedules] Driver trips fetched:',
        trips.length
      );

      const data = await Promise.all(
        trips.map(async (trip) => {
          const item = formatScheduleRoute(trip);
          return attachScheduleStops(item);
        })
      );

      console.log(
        '[getAvailableSchedules] Final driver trip count:',
        data.length
      );

      console.log('========== getAvailableSchedules | END ==========\n');

      return res.json({
        status: 200,
        success: true,
        message: 'Driver trips retrieved successfully',
        data,
      });
    }

    // =====================================================
    // NORMAL MODE: Exclude trips assigned on the date
    // =====================================================
    const assignmentWhere = {
      ...(requestedDate
        ? { assignment_date: requestedDate }
        : { assignment_date: { [Op.gte]: todayDate() } }),
      status: { [Op.ne]: 'cancelled' },
    };

    const existingAssignments = await BusDriverAssignment.findAll({
      attributes: ['schedule_id'],
      where: assignmentWhere,
      logging: scheduleSqlLogger,
      benchmark: true,
    });

    console.log(
      '[getAvailableSchedules] Existing assignments:',
      existingAssignments.length
    );

    const assignedTripIds = [
      ...new Set(
        existingAssignments.map((assignment) =>
          String(assignment.schedule_id)
        )
      ),
    ];

    const tripWhere = {
      status: { [Op.in]: ['Active', 'Scheduled'] },
      ...(requestedDate
        ? { trip_date: requestedDate }
        : { trip_date: { [Op.gte]: todayDate() } }),
    };

    if (requestedBusTypeId) {
      tripWhere.bus_type_id = requestedBusTypeId;
    }

    if (assignedTripIds.length) {
      tripWhere.id = { [Op.notIn]: assignedTripIds };
    }

    console.log(
      '[getAvailableSchedules] Available trip WHERE:',
      tripWhere
    );

    trips = await Trip.findAll({
      where: tripWhere,
      logging: scheduleSqlLogger,
      benchmark: true,
      include: [
        {
          model: Route,
          as: 'route',
          required: false,
          include: [
            {
              model: Stop,
              as: 'stops',
              required: false,
            },
          ],
        },
        {
          model: BusType,
          as: 'bus_type',
          required: false,
        },
      ],
      order: [['departure_time', 'ASC']],
    });

    console.log(
      '[getAvailableSchedules] Available trips fetched:',
      trips.length
    );

    // Prioritize driver's preferred bus type
    if (eligibility.driver.preferred_bus_type_id) {
      const preferredTypeId = String(
        eligibility.driver.preferred_bus_type_id
      );

      trips.sort((a, b) => {
        const aMatch =
          String(a.bus_type_id) === preferredTypeId ? 0 : 1;

        const bMatch =
          String(b.bus_type_id) === preferredTypeId ? 0 : 1;

        return aMatch - bMatch;
      });
    }

    const data = await Promise.all(
      trips.map(async (trip) => {
        const item = formatScheduleRoute(trip);
        return attachScheduleStops(item);
      })
    );

    console.log(
      '[getAvailableSchedules] Final available trip count:',
      data.length
    );

    console.log('========== getAvailableSchedules | END ==========\n');

    return res.json({
      status: 200,
      success: true,
      message: 'Available trips retrieved successfully',
      data,
    });
  } catch (err) {
    console.error(
      '[getAvailableSchedules] ERROR:',
      err.stack || err
    );

    next(err);
  }
};

exports.acceptAssignment = async (req, res, next) => {
  try {
    const eligibility = await getEligibleDriver(req.driver.id);
    if (respondForEligibility(res, eligibility)) return;

    const scheduleId = Number(req.body?.schedule_id);
    const assignmentDate = req.body?.assignment_date;
    const date = parseAssignmentDate(assignmentDate);
    if (!Number.isInteger(scheduleId) || scheduleId < 1 || !date || assignmentDate < todayDate()) {
      return res.status(400).json({ status: 400, success: false, message: 'Valid schedule_id and assignment_date (today or later) are required' });
    }

    const schedule = await BusSchedule.findByPk(scheduleId);
    if (!schedule || !['Active', 'Scheduled'].includes(schedule.status)) {
      return res.status(404).json({ status: 404, success: false, message: 'Active or scheduled bus trip not found' });
    }
    if (!scheduleCanRunOnDate(schedule, date)) {
      return res.status(400).json({ status: 400, success: false, message: 'Schedule is not valid for the selected date' });
    }

    const transaction = await sequelize.transaction();
    try {
      const existing = await BusDriverAssignment.findOne({
        where: { schedule_id: scheduleId, assignment_date: assignmentDate },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing && existing.status !== 'cancelled') {
        await transaction.rollback();
        return res.status(409).json({ status: 409, success: false, message: 'Schedule already assigned to another driver for this date' });
      }

      const assignment = existing
        ? await existing.update({
          driver_id: req.driver.id,
          reporting_time: schedule.departure_time,
          status: 'assigned',
          start_odometer: null,
          end_odometer: null,
          notes: null,
        }, { transaction })
        : await BusDriverAssignment.create({
          schedule_id: scheduleId,
          driver_id: req.driver.id,
          assignment_date: assignmentDate,
          reporting_time: schedule.departure_time,
          status: 'assigned',
        }, { transaction });

      await transaction.commit();
      await assignment.reload({ include: assignmentIncludes });
      res.status(201).json({ status: 201, success: true, message: 'Assignment accepted successfully', data: assignment });
    } catch (err) {
      await transaction.rollback();
      if (err instanceof UniqueConstraintError) {
        return res.status(409).json({ status: 409, success: false, message: 'Schedule already assigned to another driver for this date' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

exports.getMyAssignments = async (req, res, next) => {
  try {
    const where = { driver_id: req.driver.id };
    if (req.query.status) where.status = req.query.status;
    if (req.query.upcoming === 'true') where.assignment_date = { [Op.gte]: todayDate() };

    const assignments = await BusDriverAssignment.findAll({
      where,
      include: assignmentIncludes,
      order: [['assignment_date', 'DESC'], ['reporting_time', 'ASC']],
    });
    const data = await Promise.all(assignments.map(async (assignment) => {
      const item = assignment.toJSON();
      item.distance_km = item.start_odometer !== null && item.end_odometer !== null
        ? Number((Number(item.end_odometer) - Number(item.start_odometer)).toFixed(2))
        : null;
      if (item.schedule) {
        item.schedule = await attachScheduleStops(item.schedule);
      }
      return item;
    }));
    res.json({ status: 200, success: true, message: 'Assignments retrieved successfully', data });
  } catch (err) {
    next(err);
  }
};

exports.startAssignment = async (req, res, next) => {
  try {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId < 1) {
      return res.status(400).json({ status: 400, success: false, message: 'A valid assignment_id is required' });
    }
    const rawStartOdometer = req.body?.start_odometer;
    const startOdometer = Number(rawStartOdometer);
    if (rawStartOdometer === null || rawStartOdometer === '' || !Number.isFinite(startOdometer) || startOdometer <= 0) {
      return res.status(400).json({ status: 400, success: false, message: 'A valid positive start_odometer is required' });
    }
    const assignment = await BusDriverAssignment.findOne({ where: { id: assignmentId, driver_id: req.driver.id } });
    if (!assignment) return res.status(404).json({ status: 404, success: false, message: 'Assignment not found' });
    if (assignment.status !== 'assigned') return res.status(409).json({ status: 409, success: false, message: 'Only assigned trips can be started' });

    await assignment.update({ status: 'started', start_odometer: startOdometer });
    res.json({ status: 200, success: true, message: 'Assignment started successfully', data: assignment });
  } catch (err) {
    next(err);
  }
};

exports.completeAssignment = async (req, res, next) => {
  try {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId < 1) {
      return res.status(400).json({ status: 400, success: false, message: 'A valid assignment_id is required' });
    }
    const rawEndOdometer = req.body?.end_odometer;
    const endOdometer = Number(rawEndOdometer);
    if (rawEndOdometer === null || rawEndOdometer === '' || !Number.isFinite(endOdometer) || endOdometer <= 0) {
      return res.status(400).json({ status: 400, success: false, message: 'A valid positive end_odometer is required' });
    }
    const assignment = await BusDriverAssignment.findOne({ where: { id: assignmentId, driver_id: req.driver.id } });
    if (!assignment) return res.status(404).json({ status: 404, success: false, message: 'Assignment not found' });
    if (assignment.status !== 'started') return res.status(409).json({ status: 409, success: false, message: 'Only started assignments can be completed' });
    if (endOdometer <= Number(assignment.start_odometer)) {
      return res.status(400).json({ status: 400, success: false, message: 'end_odometer must be greater than start_odometer' });
    }

    // Location-based completion check if schedule has route stops
    if (assignment.schedule_id) {
      const schedule = await BusSchedule.findByPk(assignment.schedule_id);
      if (schedule && schedule.route_id) {
        const stops = await getOrderedStopsForRoute(schedule.route_id, schedule.departure_time);
        const finalStop = stops && stops.length > 0 ? stops[stops.length - 1] : null;

        if (finalStop && finalStop.latitude != null && finalStop.longitude != null) {
          const detail = await DriverDetail.findOne({ where: { driver_id: req.driver.id } });
          const rawLat = req.body?.latitude != null ? req.body.latitude : detail?.latitude;
          const rawLng = req.body?.longitude != null ? req.body.longitude : detail?.longitude;
          const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;
          const driverLat = rawLat != null && rawLat !== '' ? Number(rawLat) : null;
          const driverLng = rawLng != null && rawLng !== '' ? Number(rawLng) : null;

          if (driverLat != null && driverLng != null && Number.isFinite(driverLat) && Number.isFinite(driverLng)) {
            const allowedRadius = await getCompletionRadiusMeters();
            const proximity = checkProximityToStop(driverLat, driverLng, finalStop.latitude, finalStop.longitude, allowedRadius, accuracy);
            if (!proximity.isWithin) {
              return res.status(400).json({
                status: 400,
                success: false,
                code: 'OUTSIDE_RADIUS',
                message: `You must reach within ${allowedRadius} meters of the final destination to complete this trip.`,
                data: {
                  distance_meters: proximity.rawDistanceMeters,
                  effective_distance_meters: proximity.effectiveDistanceMeters,
                  allowed_radius_meters: allowedRadius,
                  final_stop: {
                    id: finalStop.id,
                    stop_name: finalStop.stop_name,
                    latitude: Number(finalStop.latitude),
                    longitude: Number(finalStop.longitude),
                  },
                },
              });
            }
          }
        }
      }
    }

    await assignment.update({ status: 'completed', end_odometer: endOdometer, ...(req.body?.notes !== undefined ? { notes: req.body.notes } : {}) });
    res.json({ status: 200, success: true, message: 'Assignment completed successfully', data: assignment });
  } catch (err) {
    next(err);
  }
};

exports.cancelAssignment = async (req, res, next) => {
  try {
    const assignment = await BusDriverAssignment.findOne({ where: { id: req.params.id, driver_id: req.driver.id } });
    if (!assignment) return res.status(404).json({ status: 404, success: false, message: 'Assignment not found' });
    if (assignment.status !== 'assigned') return res.status(409).json({ status: 409, success: false, message: 'Only assigned trips can be cancelled' });

    await assignment.update({ status: 'cancelled' });
    res.json({ status: 200, success: true, message: 'Assignment cancelled successfully', data: assignment });
  } catch (err) {
    next(err);
  }
};

exports.startTrip = async (req, res, next) => {
  req.params.id = req.body?.assignment_id;
  return exports.startAssignment(req, res, next);
};

exports.completeTrip = async (req, res, next) => {
  req.params.id = req.body?.assignment_id;
  return exports.completeAssignment(req, res, next);
};
