'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { Booking, Trip, Driver, Vehicle, Passenger, CustomerUser, Payment, Refund, Route, Stop, AuditLog, AdminUser, Role, BusType } = require('../models');
const sequelize = require('../config/database');
const { hasRole } = require('../utils/roles');
const SeatReservationService = require('../services/seatReservationService');

const normalizeSeatIdentity = (seat) => {
  const numericSeat = seat.match(/^\d+$/);
  if (numericSeat) return `index:${Number(seat)}`;

  const rowFirst = seat.match(/^(\d+)([A-Z])$/);
  const letterFirst = seat.match(/^([A-Z])(\d+)$/);
  const row = rowFirst ? Number(rowFirst[1]) : letterFirst ? Number(letterFirst[2]) : null;
  const column = rowFirst ? rowFirst[2] : letterFirst ? letterFirst[1] : null;
  if (row && column) return `index:${(row - 1) * 4 + column.charCodeAt(0) - 64}`;
  return `label:${seat}`;
};

const getRevenuePeriod = (date, groupBy) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  if (groupBy === 'year') return String(year);
  if (groupBy === 'month') return `${year}-${month}`;
  if (groupBy === 'week') {
    const weekStart = new Date(year, date.getMonth(), date.getDate());
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
  }
  return `${year}-${month}-${day}`;
};

const addMoney = (current, amount) => Math.round((current + amount + Number.EPSILON) * 100) / 100;

// ── Dashboard Stats ────────────────────────────────────────
exports.stats = async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const isAdmin = hasRole(req.user, 'admin');
    const isOwner = hasRole(req.user, 'owner');

    const {
      from_date: reqFromDate,
      to_date: reqToDate,
      preset = 'all_time',
      date_field = 'travel_date',
      boarding_status: reqBoardingStatus,
    } = req.query;

    // Resolve date range based on preset or explicit dates
    let fromDate = reqFromDate || null;
    let toDate = reqToDate || null;

    if (preset && preset !== 'custom' && preset !== 'all_time') {
      const now = new Date();
      if (preset === 'today') {
        fromDate = today;
        toDate = today;
      } else if (preset === 'yesterday') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yStr = y.toISOString().split('T')[0];
        fromDate = yStr;
        toDate = yStr;
      } else if (preset === 'this_week') {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        fromDate = monday.toISOString().split('T')[0];
        toDate = today;
      } else if (preset === 'this_month') {
        const m = new Date();
        m.setDate(1);
        fromDate = m.toISOString().split('T')[0];
        toDate = today;
      } else if (preset === 'last_30_days') {
        const past = new Date();
        past.setDate(past.getDate() - 29);
        fromDate = past.toISOString().split('T')[0];
        toDate = today;
      }
    }

    const ownerId = isOwner ? req.user.id : (isAdmin && req.query.owner_id ? Number(req.query.owner_id) : null);
    const ownerVehicleWhere = ownerId ? { owner_id: ownerId } : {};
    const ownerDriverWhere = ownerId ? { owner_id: ownerId } : {};
    const ownedVehicleRows = ownerId ? await Vehicle.findAll({ attributes: ['id'], where: ownerVehicleWhere, raw: true }) : [];
    const ownedDriverRows = ownerId ? await Driver.findAll({ attributes: ['id'], where: ownerDriverWhere, raw: true }) : [];
    const ownedVehicleIds = ownedVehicleRows.map((v) => v.id);
    const ownedDriverIds = ownedDriverRows.map((d) => d.id);
    const ownerTripWhere = ownerId
      ? { [Op.or]: [{ vehicle_id: { [Op.in]: ownedVehicleIds } }, { driver_id: { [Op.in]: ownedDriverIds } }] }
      : {};
    const ownerTripIds = ownerId
      ? (await Trip.findAll({ attributes: ['id'], where: ownerTripWhere, raw: true })).map((trip) => trip.id)
      : [];
    const ownerBookingWhere = ownerId ? { trip_id: { [Op.in]: ownerTripIds } } : {};

    // Filtered date condition for Bookings, Trips, and Payments
    const filteredBookingWhere = { ...ownerBookingWhere };
    const filteredTripWhere = { ...ownerTripWhere };
    const filteredPaymentWhere = { status: 'captured' };

    if (fromDate && toDate) {
      if (date_field === 'created_at') {
        const start = new Date(`${fromDate}T00:00:00`);
        const end = new Date(`${toDate}T23:59:59.999`);
        filteredBookingWhere.created_at = { [Op.between]: [start, end] };
        filteredTripWhere.created_at = { [Op.between]: [start, end] };
        filteredPaymentWhere.created_at = { [Op.between]: [start, end] };
      } else {
        filteredBookingWhere.travel_date = { [Op.between]: [fromDate, toDate] };
        filteredTripWhere.trip_date = { [Op.between]: [fromDate, toDate] };
        filteredPaymentWhere.created_at = {
          [Op.between]: [new Date(`${fromDate}T00:00:00`), new Date(`${toDate}T23:59:59.999`)],
        };
      }
    }

    let ownerRevenueSummary = {};
    if (isOwner && ownerTripIds.length) {
      const eligibleBookings = await Booking.findAll({
        attributes: ['id', 'trip_id', 'travel_date', 'seat_numbers', 'total_seats', 'total_fare', 'created_at'],
        where: {
          ...filteredBookingWhere,
          booking_status: 'confirmed',
          payment_status: 'paid',
          boarding_status: 'boarded',
        },
        order: [['created_at', 'ASC'], ['id', 'ASC']],
      });
      const calculateDistinctRevenue = (rows) => {
        const groupedSeats = new Map();
        const revenueByGroup = new Map();
        for (const booking of rows) {
          const groupKey = `${booking.trip_id}:${booking.travel_date}`;
          if (!groupedSeats.has(groupKey)) groupedSeats.set(groupKey, new Set());
          const seats = groupedSeats.get(groupKey);
          const seatNumbers = SeatReservationService.parseSeatNumbers(booking.seat_numbers);
          const seatCount = seatNumbers.length || Math.max(1, Number(booking.total_seats) || 1);
          const fare = Math.max(0, Number(booking.total_fare) || 0) / seatCount;
          if (seatNumbers.length) {
            for (const seat of seatNumbers) {
              const identity = normalizeSeatIdentity(seat);
              if (!seats.has(identity)) seats.add(identity);
              else continue;
              revenueByGroup.set(groupKey, addMoney(revenueByGroup.get(groupKey) || 0, fare));
            }
          } else {
            for (let index = 0; index < seatCount; index += 1) {
              const identity = `booking:${booking.id}:${index}`;
              if (!seats.has(identity)) seats.add(identity);
              revenueByGroup.set(groupKey, addMoney(revenueByGroup.get(groupKey) || 0, fare));
            }
          }
        }
        const distinctSeats = [...groupedSeats.values()].reduce((total, seats) => total + seats.size, 0);
        const revenue = [...revenueByGroup.values()].reduce((total, amount) => addMoney(total, amount), 0);
        return { revenue, distinctSeats };
      };
      const allRevenue = calculateDistinctRevenue(eligibleBookings);
      const todayStart = new Date(today);
      const todayRevenue = calculateDistinctRevenue(eligibleBookings.filter((booking) => new Date(booking.created_at) >= todayStart));
      ownerRevenueSummary = {
        revenue: { total: allRevenue.revenue, today: todayRevenue.revenue, distinctSeats: allRevenue.distinctSeats },
      };
    }

    const [
      totalTrips, todayTrips, activeTrips,
      totalBookings, todayBookings, confirmedBookings, cancelledBookings, completedBookings,
      boardedBookings, notBoardedBookings, noShowBookings,
      totalDrivers, activeDrivers,
      totalVehicles, activeVehicles,
      totalPassengers,
      allTimeBookings,
    ] = await Promise.all([
      Trip.count({ where: filteredTripWhere }),
      Trip.count({ where: { ...ownerTripWhere, trip_date: today } }),
      Trip.count({ where: { ...ownerTripWhere, status: 'Active' } }),
      Booking.count({ where: filteredBookingWhere }),
      Booking.count({ where: { ...ownerBookingWhere, created_at: { [Op.gte]: new Date(today) } } }),
      Booking.count({ where: { ...filteredBookingWhere, booking_status: 'confirmed' } }),
      Booking.count({ where: { ...filteredBookingWhere, booking_status: 'cancelled' } }),
      Booking.count({ where: { ...filteredBookingWhere, booking_status: 'completed' } }),
      Booking.count({ where: { ...filteredBookingWhere, boarding_status: 'boarded' } }),
      Booking.count({ where: { ...filteredBookingWhere, boarding_status: 'not_boarded' } }),
      Booking.count({ where: { ...filteredBookingWhere, boarding_status: 'no_show' } }),
      Driver.count({ where: ownerDriverWhere }),
      Driver.count({ where: { ...ownerDriverWhere, status: 'Approve', block_status: 'Unblock' } }),
      Vehicle.count({ where: ownerVehicleWhere }),
      Vehicle.count({ where: { ...ownerVehicleWhere, status: 'Active' } }),
      isOwner ? Booking.count({ distinct: true, col: 'passenger_id', where: filteredBookingWhere }) : Passenger.count(),
      Booking.count({ where: ownerBookingWhere }),
    ]);

    const eligibleBoardingCount = confirmedBookings + completedBookings;
    const boardingRate = eligibleBoardingCount > 0
      ? Math.round((boardedBookings / eligibleBoardingCount) * 1000) / 10
      : 0;

    // Bookings by status
    const bookingsByStatus = await Booking.findAll({
      attributes: ['booking_status', [fn('COUNT', col('id')), 'count']],
      where: filteredBookingWhere,
      group: ['booking_status'],
      raw: true,
    });

    const vehicleStatusChart = await Vehicle.findAll({
      attributes: ['status', [fn('COUNT', col('id')), 'count']],
      where: ownerVehicleWhere,
      group: ['status'],
      raw: true,
    });

    const driverStatusChart = await Driver.findAll({
      attributes: ['status', [fn('COUNT', col('id')), 'count']],
      where: ownerDriverWhere,
      group: ['status'],
      raw: true,
    });

    const tripStatusChart = await Trip.findAll({
      attributes: ['status', [fn('COUNT', col('id')), 'count']],
      where: filteredTripWhere,
      group: ['status'],
      raw: true,
    });

    // Boarding status chart breakdown
    const boardingStatusChart = [
      { status: 'boarded', label: 'Boarded', count: boardedBookings, color: '#10b981' },
      { status: 'not_boarded', label: 'Pending Boarding', count: notBoardedBookings, color: '#f59e0b' },
      { status: 'no_show', label: 'No Show', count: noShowBookings, color: '#8b5cf6' },
      { status: 'cancelled', label: 'Cancelled', count: cancelledBookings, color: '#ef4444' },
    ];

    // Timeline trend data (daily bookings, boarded, cancellations, revenue)
    let trendStart = fromDate;
    let trendEnd = toDate;
    if (!trendStart || !trendEnd) {
      const p = new Date();
      p.setDate(p.getDate() - 13);
      trendStart = p.toISOString().split('T')[0];
      trendEnd = today;
    }

    const sDate = new Date(`${trendStart}T00:00:00`);
    const eDate = new Date(`${trendEnd}T23:59:59.999`);
    const dayMap = new Map();
    const cur = new Date(sDate);
    while (cur <= eDate) {
      const dStr = cur.toISOString().split('T')[0];
      const dayName = cur.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dayMap.set(dStr, {
        date: dStr,
        label: dayName,
        bookings: 0,
        boarded: 0,
        cancelled: 0,
        revenue: 0,
      });
      cur.setDate(cur.getDate() + 1);
    }

    const trendBookings = await Booking.findAll({
      attributes: ['id', 'travel_date', 'booking_status', 'boarding_status', 'final_amount', 'created_at'],
      where: {
        ...ownerBookingWhere,
        travel_date: { [Op.between]: [trendStart, trendEnd] },
      },
      raw: true,
    });

    for (const b of trendBookings) {
      const dStr = b.travel_date;
      if (dayMap.has(dStr)) {
        const entry = dayMap.get(dStr);
        entry.bookings += 1;
        if (b.boarding_status === 'boarded') entry.boarded += 1;
        if (b.booking_status === 'cancelled') entry.cancelled += 1;
        if (b.booking_status === 'confirmed' || b.booking_status === 'completed') {
          entry.revenue = addMoney(entry.revenue, Number(b.final_amount) || 0);
        }
      }
    }
    const timelineTrend = Array.from(dayMap.values());

    // Hourly commuter distribution (06:00 to 22:00)
    const hourlyTrips = await Trip.findAll({
      attributes: ['id', 'departure_time'],
      where: filteredTripWhere,
      include: [{
        model: Booking,
        as: 'bookings',
        attributes: ['id', 'boarding_status', 'booking_status'],
        where: { booking_status: { [Op.ne]: 'cancelled' } },
        required: false,
      }],
    });

    const hourBuckets = new Map();
    for (let h = 6; h <= 22; h += 1) {
      const hStr = String(h).padStart(2, '0') + ':00';
      const label = h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`;
      hourBuckets.set(h, { hour: hStr, label, bookings: 0, boarded: 0 });
    }

    for (const t of hourlyTrips) {
      if (!t.departure_time) continue;
      const h = parseInt(String(t.departure_time).split(':')[0], 10);
      if (hourBuckets.has(h)) {
        const bucket = hourBuckets.get(h);
        const bkgs = t.bookings || [];
        bucket.bookings += bkgs.length;
        bucket.boarded += bkgs.filter((b) => b.boarding_status === 'boarded').length;
      }
    }
    const hourlyDistribution = Array.from(hourBuckets.values());

    // Recent bookings
    const recentBookingWhere = isOwner
      ? { ...filteredBookingWhere, booking_status: { [Op.ne]: 'cancelled' } }
      : filteredBookingWhere;
    const recentBookings = await Booking.findAll({
      attributes: isAdmin
        ? ['id', 'passenger_name', 'booking_reference', 'booking_status', 'final_amount', 'created_at']
        : ['id', 'passenger_name', 'booking_reference', 'booking_status', 'created_at'],
      where: recentBookingWhere,
      limit: 10,
      order: [['created_at', 'DESC']],
      include: [
        { model: Trip, as: 'trip', attributes: ['id', 'schedule_code'] },
        { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile'] },
      ],
    });

    // Boarded Users list for dashboard (showing passengers, trip, stops, seats, boarding status)
    const boardedUserWhere = { ...filteredBookingWhere };
    if (reqBoardingStatus && reqBoardingStatus !== 'all') {
      boardedUserWhere.boarding_status = reqBoardingStatus;
    }

    const boardedUsers = await Booking.findAll({
      attributes: [
        'id', 'booking_reference', 'passenger_name', 'passenger_mobile', 'passenger_email',
        'travel_date', 'seat_numbers', 'total_seats', 'total_fare', 'final_amount',
        'payment_status', 'booking_status', 'boarding_status', 'boarded_at', 'boarding_pass_code',
        'created_at',
      ],
      where: boardedUserWhere,
      include: [
        {
          model: Trip,
          as: 'trip',
          attributes: ['id', 'schedule_code', 'trip_date', 'departure_time', 'status'],
          include: [
            { model: Route, as: 'route', attributes: ['id', 'route_name', 'origin_city', 'destination_city'] },
            { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model'] },
            { model: Driver, as: 'driver', attributes: ['id', 'name', 'mobile'] },
          ],
        },
        { model: Stop, as: 'origin_stop', attributes: ['id', 'stop_name'] },
        { model: Stop, as: 'destination_stop', attributes: ['id', 'stop_name'] },
      ],
      order: [
        [literal("CASE WHEN `Booking`.`boarding_status` = 'boarded' THEN 1 WHEN `Booking`.`boarding_status` = 'not_boarded' THEN 2 ELSE 3 END"), 'ASC'],
        ['travel_date', 'DESC'],
        ['created_at', 'DESC'],
      ],
      limit: 30,
    });

    let adminFinancialSummary = {};
    let revenueChart = [];
    let paymentMethodsChart = [];
    if (isAdmin) {
      const [
        totalRevenue,
        filteredRevenue,
        todayRevenue,
        pendingRefunds,
        pendingRefundAmount,
        completedRefundAmount,
      ] = await Promise.all([
        Payment.sum('amount', { where: { status: 'captured' } }),
        Payment.sum('amount', { where: filteredPaymentWhere }),
        Payment.sum('amount', { where: { status: 'captured', created_at: { [Op.gte]: new Date(today) } } }),
        Refund.count({ where: { status: 'pending' } }),
        Refund.sum('refund_amount', { where: { status: 'pending' } }),
        Refund.sum('refund_amount', { where: { status: 'completed' } }),
      ]);

      adminFinancialSummary = {
        revenue: {
          total: filteredRevenue != null ? filteredRevenue : (totalRevenue || 0),
          all_time: totalRevenue || 0,
          today: todayRevenue || 0,
        },
        refunds: { pending: pendingRefunds, pendingAmount: pendingRefundAmount || 0, completedAmount: completedRefundAmount || 0 },
      };

      revenueChart = await Payment.findAll({
        attributes: [
          [fn('DATE_FORMAT', col('created_at'), '%Y-%m'), 'month'],
          [fn('SUM', col('amount')), 'revenue'],
          [fn('COUNT', col('id')), 'transactions'],
        ],
        where: { status: 'captured', created_at: { [Op.gte]: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) } },
        group: [literal('month')],
        order: [[literal('month'), 'ASC']],
      });

      paymentMethodsChart = await Payment.findAll({
        attributes: [
          'payment_method',
          [fn('COUNT', col('id')), 'count'],
          [fn('SUM', col('amount')), 'total_amount'],
        ],
        where: filteredPaymentWhere,
        group: ['payment_method'],
        raw: true,
      });
    }

    // Top routes with boarding count & rate
    const topRoutes = await Booking.findAll({
      attributes: [
        'trip_id',
        [fn('COUNT', col('Booking.id')), 'booking_count'],
        [literal("SUM(CASE WHEN `Booking`.`boarding_status` = 'boarded' THEN 1 ELSE 0 END)"), 'boarded_count'],
      ],
      include: [{
        model: Trip,
        as: 'trip',
        attributes: ['id', 'schedule_code'],
        include: [{
          model: Route,
          as: 'route',
          attributes: ['id', 'route_name', 'origin_city', 'destination_city'],
        }],
      }],
      group: [
        'trip_id', 'trip.id', 'trip.schedule_code',
        'trip.route.id', 'trip.route.route_name', 'trip.route.origin_city', 'trip.route.destination_city',
      ],
      order: [[literal('booking_count'), 'DESC']],
      limit: 6,
      where: { ...filteredBookingWhere, booking_status: 'confirmed' },
    });

    res.json({
      success: true,
      data: {
        filter: {
          from_date: fromDate,
          to_date: toDate,
          preset,
          date_field,
          boarding_status: reqBoardingStatus || 'all',
        },
        summary: {
          trips: { total: totalTrips, today: todayTrips, active: activeTrips },
          bookings: {
            total: totalBookings,
            all_time: allTimeBookings,
            today: todayBookings,
            confirmed: confirmedBookings,
            cancelled: cancelledBookings,
            completed: completedBookings,
          },
          boarding: {
            boarded: boardedBookings,
            not_boarded: notBoardedBookings,
            no_show: noShowBookings,
            total_eligible: eligibleBoardingCount,
            boarding_rate: boardingRate,
          },
          drivers: { total: totalDrivers, active: activeDrivers },
          vehicles: { total: totalVehicles, active: activeVehicles },
          passengers: { total: totalPassengers },
          ...ownerRevenueSummary,
          ...adminFinancialSummary,
        },
        charts: {
          ...(isAdmin ? { revenue: revenueChart, paymentMethods: paymentMethodsChart } : {}),
          bookingsByStatus,
          boardingStatus: boardingStatusChart,
          timelineTrend,
          hourlyDistribution,
          vehicleStatus: vehicleStatusChart,
          driverStatus: driverStatusChart,
          tripStatus: tripStatusChart,
        },
        recentBookings,
        boardedUsers,
        topRoutes,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Boarded Passengers (Detailed & Paginated) ──────────────
exports.boardedPassengers = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      boarding_status,
      booking_status,
      from_date,
      to_date,
      trip_id,
      date_field = 'travel_date',
    } = req.query;

    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (p - 1) * l;

    const isOwner = hasRole(req.user, 'owner');
    let ownerTripWhere = {};
    if (isOwner) {
      const [vehicles, drivers] = await Promise.all([
        Vehicle.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }),
        Driver.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }),
      ]);
      const vehicleIds = vehicles.map((v) => v.id);
      const driverIds = drivers.map((d) => d.id);
      ownerTripWhere = vehicleIds.length || driverIds.length
        ? { [Op.or]: [
          ...(vehicleIds.length ? [{ vehicle_id: { [Op.in]: vehicleIds } }] : []),
          ...(driverIds.length ? [{ driver_id: { [Op.in]: driverIds } }] : []),
        ] }
        : { id: { [Op.in]: [] } };
    }
    const ownerTripIds = isOwner
      ? (await Trip.findAll({ attributes: ['id'], where: ownerTripWhere, raw: true })).map((t) => t.id)
      : null;

    const where = {};
    if (ownerTripIds) where.trip_id = { [Op.in]: ownerTripIds };
    if (trip_id) where.trip_id = trip_id;
    if (boarding_status && boarding_status !== 'all') where.boarding_status = boarding_status;
    if (booking_status && booking_status !== 'all') where.booking_status = booking_status;

    if (from_date && to_date) {
      if (date_field === 'created_at') {
        where.created_at = { [Op.between]: [new Date(`${from_date}T00:00:00`), new Date(`${to_date}T23:59:59.999`)] };
      } else {
        where.travel_date = { [Op.between]: [from_date, to_date] };
      }
    }

    if (search) {
      where[Op.or] = [
        { booking_reference: { [Op.like]: `%${search}%` } },
        { passenger_name: { [Op.like]: `%${search}%` } },
        { passenger_mobile: { [Op.like]: `%${search}%` } },
        { boarding_pass_code: { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows } = await Booking.findAndCountAll({
      where,
      include: [
        {
          model: Trip,
          as: 'trip',
          attributes: ['id', 'schedule_code', 'trip_date', 'departure_time', 'status'],
          include: [
            { model: Route, as: 'route', attributes: ['id', 'route_name', 'origin_city', 'destination_city'] },
            { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model'] },
            { model: Driver, as: 'driver', attributes: ['id', 'name', 'mobile'] },
          ],
        },
        { model: Stop, as: 'origin_stop', attributes: ['id', 'stop_name'] },
        { model: Stop, as: 'destination_stop', attributes: ['id', 'stop_name'] },
        { model: CustomerUser, as: 'passenger', attributes: ['id', 'name', 'mobile', 'email'] },
      ],
      offset,
      limit: l,
      order: [
        [literal("CASE WHEN `Booking`.`boarding_status` = 'boarded' THEN 1 WHEN `Booking`.`boarding_status` = 'not_boarded' THEN 2 ELSE 3 END"), 'ASC'],
        ['travel_date', 'DESC'],
        ['created_at', 'DESC'],
      ],
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page: p,
        limit: l,
        pages: Math.ceil(count / l),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Revenue Report ─────────────────────────────────────────
exports.revenueReport = async (req, res, next) => {
  try {
    const { from_date, to_date, bus_type_id, trip_status, route_id } = req.query;
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'monthly';
    const groupBy = ['day', 'week', 'month', 'year'].includes(req.query.group_by)
      ? req.query.group_by
      : period === 'weekly' ? 'week' : period === 'monthly' ? 'month' : 'day';
    const isOwner = hasRole(req.user, 'owner');
    const isAdmin = hasRole(req.user, 'admin');
    const selectedOwnerId = isAdmin && req.query.owner_id ? Number(req.query.owner_id) : null;
    if (req.query.owner_id && isAdmin && (!Number.isInteger(selectedOwnerId) || selectedOwnerId < 1)) {
      return res.status(400).json({ success: false, message: 'owner_id must be a positive integer' });
    }

    const targetOwnerId = isOwner ? Number(req.user.id) : (selectedOwnerId || null);
    const selectedBusTypeId = bus_type_id ? Number(bus_type_id) : null;
    const selectedTripStatus = trip_status && trip_status !== 'all' ? String(trip_status).trim() : null;
    const selectedRouteId = route_id ? Number(route_id) : null;

    const endDate = to_date ? new Date(`${to_date}T23:59:59.999`) : new Date();
    let startDate;
    if (from_date) {
      startDate = new Date(`${from_date}T00:00:00`);
    } else {
      startDate = new Date(endDate);
      if (period === 'daily') startDate.setDate(startDate.getDate() - 6);
      else if (period === 'weekly') startDate.setDate(startDate.getDate() - 27);
      else {
        startDate.setMonth(startDate.getMonth() - 5);
        startDate.setDate(1);
      }
    }
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
      return res.status(400).json({ success: false, message: 'A valid date range is required' });
    }
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // 1. Fetch reference options: Owners, Bus Types, Routes
    const [owners, allBusTypes, allRoutes] = await Promise.all([
      AdminUser.findAll({
        attributes: ['id', 'name'],
        include: [{ model: Role, as: 'role', attributes: [], where: { name: 'owner' }, required: true }],
        raw: true,
      }),
      BusType.findAll({
        attributes: ['id', 'name', 'code', 'seat_type', 'total_seats', 'has_ac'],
        order: [['name', 'ASC']],
      }),
      Route.findAll({
        attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'],
        order: [['route_name', 'ASC']],
      }),
    ]);

    const ownerNameById = new Map(owners.map((owner) => [Number(owner.id), owner.name]));
    const busTypeMap = new Map(allBusTypes.map((bt) => [Number(bt.id), bt]));

    // 2. Fetch all vehicles and drivers
    const [allVehicles, allDrivers] = await Promise.all([
      Vehicle.findAll({
        attributes: ['id', 'owner_id', 'driver_id', 'bus_type_id', 'registration_number', 'company_model', 'status', 'total_seats'],
        include: [
          { model: BusType, as: 'bus_type', attributes: ['id', 'name', 'code', 'seat_type', 'total_seats', 'has_ac'], required: false },
          { model: Driver, as: 'driver', attributes: ['id', 'name', 'mobile', 'status', 'online_status'], required: false },
        ],
      }),
      Driver.findAll({
        attributes: ['id', 'owner_id', 'name', 'mobile', 'status', 'online_status'],
      }),
    ]);

    // Map vehicle driver assignments: driver_id -> assigned vehicle
    const driverAssignedVehicleMap = new Map();
    for (const v of allVehicles) {
      if (v.driver_id) {
        driverAssignedVehicleMap.set(Number(v.driver_id), {
          id: v.id,
          registration_number: v.registration_number,
          company_model: v.company_model,
          bus_type_id: v.bus_type_id,
          bus_type_name: v.bus_type?.name || 'Standard Bus',
          total_seats: v.total_seats || v.bus_type?.total_seats || 0,
        });
      }
    }

    const driverById = new Map(allDrivers.map(d => [Number(d.id), d]));

    // 3. Resolve Owner Scope for Trips
    const targetVehicles = targetOwnerId ? allVehicles.filter(v => Number(v.owner_id) === targetOwnerId) : allVehicles;
    const targetDrivers = targetOwnerId ? allDrivers.filter(d => Number(d.owner_id) === targetOwnerId) : allDrivers;

    const targetVehicleIds = targetVehicles.map(v => v.id);
    const targetDriverIds = targetDrivers.map(d => d.id);

    // Trip filtering
    const tripWhere = {
      [Op.or]: [
        { trip_date: { [Op.between]: [startDateStr, endDateStr] } },
        { created_at: { [Op.between]: [startDate, endDate] } },
      ],
    };

    if (targetOwnerId) {
      if (targetVehicleIds.length || targetDriverIds.length) {
        tripWhere[Op.and] = [
          {
            [Op.or]: [
              ...(targetVehicleIds.length ? [{ vehicle_id: { [Op.in]: targetVehicleIds } }] : []),
              ...(targetDriverIds.length ? [{ driver_id: { [Op.in]: targetDriverIds } }] : []),
            ],
          },
        ];
      } else {
        tripWhere.id = { [Op.in]: [] };
      }
    }

    if (selectedTripStatus) {
      tripWhere.status = selectedTripStatus;
    }
    if (selectedRouteId) {
      tripWhere.route_id = selectedRouteId;
    }
    if (selectedBusTypeId) {
      const matchingVehicleIds = allVehicles.filter(v => Number(v.bus_type_id) === selectedBusTypeId).map(v => v.id);
      tripWhere[Op.or] = [
        { bus_type_id: selectedBusTypeId },
        ...(matchingVehicleIds.length ? [{ vehicle_id: { [Op.in]: matchingVehicleIds } }] : []),
      ];
    }

    const trips = await Trip.findAll({
      attributes: ['id', 'route_id', 'schedule_code', 'trip_date', 'departure_time', 'arrival_time', 'status', 'vehicle_id', 'driver_id', 'bus_type_id', 'created_at'],
      where: tripWhere,
      include: [
        { model: Route, as: 'route', attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'], required: false },
        {
          model: Vehicle,
          as: 'vehicle',
          attributes: ['id', 'owner_id', 'registration_number', 'company_model', 'status', 'bus_type_id', 'total_seats'],
          include: [{ model: BusType, as: 'bus_type', attributes: ['id', 'name', 'code', 'seat_type', 'total_seats', 'has_ac'], required: false }],
          required: false,
        },
        { model: Driver, as: 'driver', attributes: ['id', 'owner_id', 'name', 'mobile', 'status', 'online_status'], required: false },
        { model: BusType, as: 'bus_type', attributes: ['id', 'name', 'code', 'seat_type', 'total_seats', 'has_ac'], required: false },
      ],
      order: [['trip_date', 'DESC'], ['departure_time', 'DESC'], ['id', 'DESC']],
    });

    const tripIds = trips.map(t => Number(t.id));
    const tripById = new Map(trips.map(t => [Number(t.id), t]));

    // 4. Query bookings for these trips
    const bookingWhere = {
      booking_status: isOwner ? 'confirmed' : { [Op.in]: ['confirmed', 'completed'] },
      created_at: { [Op.between]: [startDate, endDate] },
    };
    if (isOwner) {
      bookingWhere.payment_status = 'paid';
      bookingWhere.boarding_status = 'boarded';
    }
    if (tripIds.length) {
      bookingWhere.trip_id = { [Op.in]: tripIds };
    } else {
      bookingWhere.trip_id = { [Op.in]: [] };
    }

    const bookings = tripIds.length ? await Booking.findAll({
      attributes: ['id', 'trip_id', 'travel_date', 'seat_numbers', 'total_seats', 'total_fare', 'discount_amount', 'final_amount', 'created_at', 'payment_status', 'boarding_status'],
      where: bookingWhere,
      order: [['created_at', 'ASC'], ['id', 'ASC']],
    }) : [];

    // 5. Aggregate bookings by trip & travel_date
    const tripSeatGroups = new Map();
    const bookingRevenueGroups = new Map();

    for (const booking of bookings) {
      const trip = tripById.get(Number(booking.trip_id));
      if (!trip) continue;

      const vehicleOwnerId = trip.vehicle?.owner_id;
      const driverOwnerId = trip.driver?.owner_id;
      const ownerId = isOwner
        ? Number(req.user.id)
        : Number(vehicleOwnerId || driverOwnerId || 0);

      const tripDateKey = `${Number(trip.id)}:${booking.travel_date || trip.trip_date}`;
      let group = tripSeatGroups.get(tripDateKey);
      if (!group) {
        group = {
          trip,
          ownerId: Number(ownerId),
          travelDate: booking.travel_date || trip.trip_date,
          seats: new Map(),
          bookings: new Set(),
        };
        tripSeatGroups.set(tripDateKey, group);
      }
      group.bookings.add(Number(booking.id));

      const bookedSeatNumbers = SeatReservationService.parseSeatNumbers(booking.seat_numbers);
      const bookedSeatCount = bookedSeatNumbers.length || Math.max(1, Number(booking.total_seats) || 1);
      const bookingGrossFare = Number(booking.total_fare) > 0
        ? Number(booking.total_fare)
        : Math.max(0, Number(booking.final_amount || 0) + Number(booking.discount_amount || 0));
      const bookingNetFare = Math.max(0, Number(booking.final_amount || 0));

      if (isAdmin && booking.payment_status === 'paid') {
        const revenueGroupKey = `${ownerId}:${tripDateKey}`;
        let bookingRevenueGroup = bookingRevenueGroups.get(revenueGroupKey);
        if (!bookingRevenueGroup) {
          bookingRevenueGroup = {
            owner_id: Number(ownerId),
            trip_id: Number(trip.id),
            schedule_code: trip.schedule_code,
            travel_date: booking.travel_date || trip.trip_date,
            route_name: trip.route?.route_name || `Route #${trip.route_id}`,
            bookings: 0,
            seats: 0,
            gross_revenue: 0,
            net_revenue: 0,
          };
          bookingRevenueGroups.set(revenueGroupKey, bookingRevenueGroup);
        }
        bookingRevenueGroup.bookings += 1;
        bookingRevenueGroup.seats += bookedSeatCount;
        bookingRevenueGroup.gross_revenue = addMoney(bookingRevenueGroup.gross_revenue, bookingGrossFare);
        bookingRevenueGroup.net_revenue = addMoney(bookingRevenueGroup.net_revenue, bookingNetFare);
      }

      const bookingDate = new Date(booking.created_at);
      const grossFarePerSeat = bookingGrossFare / bookedSeatCount;
      const netFarePerSeat = bookingNetFare / bookedSeatCount;

      if (bookedSeatNumbers.length) {
        for (const seat of bookedSeatNumbers) {
          const identity = normalizeSeatIdentity(seat);
          if (!group.seats.has(identity)) {
            group.seats.set(identity, {
              bookedAt: bookingDate,
              grossFare: grossFarePerSeat,
              netFare: netFarePerSeat,
            });
          }
        }
      } else {
        for (let index = 0; index < bookedSeatCount; index += 1) {
          group.seats.set(`booking:${booking.id}:${index}`, {
            bookedAt: bookingDate,
            grossFare: grossFarePerSeat,
            netFare: netFarePerSeat,
          });
        }
      }
    }

    // 6. Aggregate Metrics: Period trends, Owner breakdown, Route breakdown, Bus type breakdown, Driver breakdown
    const periodTotals = new Map();
    const periodOwnerTotals = new Map();
    const ownerTotals = new Map();
    const routeTotals = new Map();
    const busTypeTotals = new Map();
    const driverTripStats = new Map();
    const tripBreakdown = [];

    // Map each trip in trips array with its revenue & seats
    for (const trip of trips) {
      const tripDateKey = `${Number(trip.id)}:${trip.trip_date}`;
      const group = tripSeatGroups.get(tripDateKey);

      let tripGrossRevenue = 0;
      let tripNetRevenue = 0;
      let distinctSeats = 0;
      let bookingCount = 0;

      if (group) {
        for (const seat of group.seats.values()) {
          tripGrossRevenue = addMoney(tripGrossRevenue, seat.grossFare);
          tripNetRevenue = addMoney(tripNetRevenue, seat.netFare);
        }
        distinctSeats = group.seats.size;
        bookingCount = group.bookings.size;
      }

      const vehicleOwnerId = trip.vehicle?.owner_id;
      const driverOwnerId = trip.driver?.owner_id;
      const tripOwnerId = isOwner
        ? Number(req.user.id)
        : Number(vehicleOwnerId || driverOwnerId || 0);

      // Resolve Bus Type
      const resolvedBusType = trip.bus_type || trip.vehicle?.bus_type || null;
      const busTypeId = resolvedBusType?.id || null;
      const busTypeName = resolvedBusType?.name || 'Standard Bus';

      const tripEntry = {
        owner_id: tripOwnerId,
        owner_name: ownerNameById.get(tripOwnerId) || (tripOwnerId ? `Owner #${tripOwnerId}` : 'Unassigned'),
        trip_id: Number(trip.id),
        schedule_code: trip.schedule_code,
        travel_date: trip.trip_date,
        trip_date: trip.trip_date,
        departure_time: trip.departure_time,
        arrival_time: trip.arrival_time,
        status: trip.status || 'Scheduled',
        route_id: Number(trip.route_id),
        route_name: trip.route?.route_name || `Route #${trip.route_id}`,
        route_code: trip.route?.route_code || null,
        origin_city: trip.route?.origin_city || null,
        destination_city: trip.route?.destination_city || null,
        bus_type_id: busTypeId,
        bus_type_name: busTypeName,
        bus_type: resolvedBusType ? {
          id: resolvedBusType.id,
          name: resolvedBusType.name,
          code: resolvedBusType.code,
          seat_type: resolvedBusType.seat_type,
          total_seats: resolvedBusType.total_seats,
          has_ac: resolvedBusType.has_ac,
        } : null,
        vehicle: trip.vehicle ? {
          id: trip.vehicle.id,
          registration_number: trip.vehicle.registration_number,
          model: trip.vehicle.company_model,
          company_model: trip.vehicle.company_model,
          status: trip.vehicle.status,
          bus_type_name: busTypeName,
        } : null,
        driver: trip.driver ? {
          id: trip.driver.id,
          name: trip.driver.name,
          mobile: trip.driver.mobile,
          status: trip.driver.status,
          online_status: trip.driver.online_status,
        } : null,
        distinct_seats: distinctSeats,
        booking_count: bookingCount,
        gross_revenue: tripGrossRevenue,
        net_revenue: tripNetRevenue,
        revenue: tripGrossRevenue,
      };

      tripBreakdown.push(tripEntry);

      // Accumulate Driver stats
      if (trip.driver_id) {
        const dId = Number(trip.driver_id);
        let dStat = driverTripStats.get(dId);
        if (!dStat) {
          const dObj = driverById.get(dId) || trip.driver;
          dStat = {
            driver_id: dId,
            name: dObj?.name || `Driver #${dId}`,
            mobile: dObj?.mobile || '—',
            status: dObj?.status || 'Active',
            online_status: dObj?.online_status || 'Offline',
            total_trips: 0,
            completed_trips: 0,
            scheduled_trips: 0,
            active_trips: 0,
            cancelled_trips: 0,
            distinct_seats: 0,
            booking_count: 0,
            gross_revenue: 0,
            net_revenue: 0,
          };
          driverTripStats.set(dId, dStat);
        }
        dStat.total_trips += 1;
        if (trip.status === 'Completed') dStat.completed_trips += 1;
        else if (trip.status === 'Scheduled') dStat.scheduled_trips += 1;
        else if (trip.status === 'Active') dStat.active_trips += 1;
        else if (trip.status === 'Cancelled') dStat.cancelled_trips += 1;
        dStat.distinct_seats += distinctSeats;
        dStat.booking_count += bookingCount;
        dStat.gross_revenue = addMoney(dStat.gross_revenue, tripGrossRevenue);
        dStat.net_revenue = addMoney(dStat.net_revenue, tripNetRevenue);
      }

      // Accumulate Bus Type stats
      const btKey = busTypeId || 0;
      let btStat = busTypeTotals.get(btKey);
      if (!btStat) {
        btStat = {
          bus_type_id: busTypeId,
          name: busTypeName,
          code: resolvedBusType?.code || null,
          seat_type: resolvedBusType?.seat_type || 'seater',
          total_seats: resolvedBusType?.total_seats || 0,
          has_ac: Boolean(resolvedBusType?.has_ac),
          vehicles_count: 0,
          trips_count: 0,
          completed_trips: 0,
          scheduled_trips: 0,
          active_trips: 0,
          cancelled_trips: 0,
          distinct_seats: 0,
          bookings_count: 0,
          gross_revenue: 0,
          net_revenue: 0,
        };
        busTypeTotals.set(btKey, btStat);
      }
      btStat.trips_count += 1;
      if (trip.status === 'Completed') btStat.completed_trips += 1;
      else if (trip.status === 'Scheduled') btStat.scheduled_trips += 1;
      else if (trip.status === 'Active') btStat.active_trips += 1;
      else if (trip.status === 'Cancelled') btStat.cancelled_trips += 1;
      btStat.distinct_seats += distinctSeats;
      btStat.bookings_count += bookingCount;
      btStat.gross_revenue = addMoney(btStat.gross_revenue, tripGrossRevenue);
      btStat.net_revenue = addMoney(btStat.net_revenue, tripNetRevenue);

      // Accumulate Route stats
      const routeId = Number(trip.route_id);
      const routeKey = `${tripOwnerId}:${routeId}`;
      let routeTotal = routeTotals.get(routeKey);
      if (!routeTotal) {
        routeTotal = {
          owner_id: tripOwnerId,
          route_id: routeId,
          route_name: trip.route?.route_name || `Route #${routeId}`,
          fare_per_seat: 0,
          fare_total: 0,
          gross_revenue: 0,
          net_revenue: 0,
          revenue: 0,
          distinct_seats: 0,
          trips: 0,
        };
        routeTotals.set(routeKey, routeTotal);
      }
      routeTotal.trips += 1;
      routeTotal.distinct_seats += distinctSeats;
      routeTotal.gross_revenue = addMoney(routeTotal.gross_revenue, tripGrossRevenue);
      routeTotal.net_revenue = addMoney(routeTotal.net_revenue, tripNetRevenue);
      routeTotal.revenue = routeTotal.gross_revenue;
      routeTotal.fare_total = addMoney(routeTotal.fare_total, tripGrossRevenue);

      // Accumulate Owner stats
      let ownerTotal = ownerTotals.get(tripOwnerId);
      if (!ownerTotal) {
        ownerTotal = {
          owner_id: tripOwnerId,
          owner_name: ownerNameById.get(tripOwnerId) || (tripOwnerId ? `Owner #${tripOwnerId}` : 'Unassigned'),
          gross_revenue: 0,
          net_revenue: 0,
          revenue: 0,
          distinct_seats: 0,
          trips: 0,
          scheduled_trips: 0,
          completed_trips: 0,
          active_trips: 0,
          cancelled_trips: 0,
        };
        ownerTotals.set(tripOwnerId, ownerTotal);
      }
      ownerTotal.trips += 1;
      if (trip.status === 'Completed') ownerTotal.completed_trips += 1;
      else if (trip.status === 'Scheduled') ownerTotal.scheduled_trips += 1;
      else if (trip.status === 'Active') ownerTotal.active_trips += 1;
      else if (trip.status === 'Cancelled') ownerTotal.cancelled_trips += 1;
      ownerTotal.distinct_seats += distinctSeats;
      ownerTotal.gross_revenue = addMoney(ownerTotal.gross_revenue, tripGrossRevenue);
      ownerTotal.net_revenue = addMoney(ownerTotal.net_revenue, tripNetRevenue);
      ownerTotal.revenue = ownerTotal.gross_revenue;

      // Accumulate Period Trend from individual booked seats
      if (group) {
        for (const seat of group.seats.values()) {
          const periodKey = getRevenuePeriod(seat.bookedAt, groupBy);
          let periodTotal = periodTotals.get(periodKey);
          if (!periodTotal) {
            periodTotal = { period: periodKey, gross_revenue: 0, net_revenue: 0, revenue: 0, distinct_seats: 0 };
            periodTotals.set(periodKey, periodTotal);
          }
          periodTotal.gross_revenue = addMoney(periodTotal.gross_revenue, seat.grossFare);
          periodTotal.net_revenue = addMoney(periodTotal.net_revenue, seat.netFare);
          periodTotal.revenue = periodTotal.gross_revenue;
          periodTotal.distinct_seats += 1;

          const ownerPeriodKey = `${tripOwnerId}:${periodKey}`;
          let ownerPeriodTotal = periodOwnerTotals.get(ownerPeriodKey);
          if (!ownerPeriodTotal) {
            ownerPeriodTotal = { owner_id: tripOwnerId, period: periodKey, gross_revenue: 0, net_revenue: 0, revenue: 0, distinct_seats: 0 };
            periodOwnerTotals.set(ownerPeriodKey, ownerPeriodTotal);
          }
          ownerPeriodTotal.gross_revenue = addMoney(ownerPeriodTotal.gross_revenue, seat.grossFare);
          ownerPeriodTotal.net_revenue = addMoney(ownerPeriodTotal.net_revenue, seat.netFare);
          ownerPeriodTotal.revenue = ownerPeriodTotal.gross_revenue;
          ownerPeriodTotal.distinct_seats += 1;
        }
      }
    }

    // Bus Type vehicle counts
    for (const v of targetVehicles) {
      const btKey = v.bus_type_id || 0;
      let btStat = busTypeTotals.get(btKey);
      if (!btStat) {
        const btObj = busTypeMap.get(Number(btKey));
        btStat = {
          bus_type_id: btKey || null,
          name: btObj?.name || 'Standard Bus',
          code: btObj?.code || null,
          seat_type: btObj?.seat_type || 'seater',
          total_seats: btObj?.total_seats || 0,
          has_ac: Boolean(btObj?.has_ac),
          vehicles_count: 0,
          trips_count: 0,
          completed_trips: 0,
          scheduled_trips: 0,
          active_trips: 0,
          cancelled_trips: 0,
          distinct_seats: 0,
          bookings_count: 0,
          gross_revenue: 0,
          net_revenue: 0,
        };
        busTypeTotals.set(btKey, btStat);
      }
      btStat.vehicles_count += 1;
    }

    // Average fare per seat on routeTotals
    for (const routeTotal of routeTotals.values()) {
      routeTotal.fare_per_seat = routeTotal.distinct_seats
        ? Math.round((routeTotal.fare_total / routeTotal.distinct_seats + Number.EPSILON) * 100) / 100
        : 0;
      delete routeTotal.fare_total;
    }

    // Ensure all owners exist in ownerTotals
    for (const owner of owners) {
      const ownerId = Number(owner.id);
      if (!ownerTotals.has(ownerId)) {
        ownerTotals.set(ownerId, {
          owner_id: ownerId,
          owner_name: owner.name,
          gross_revenue: 0,
          net_revenue: 0,
          revenue: 0,
          distinct_seats: 0,
          trips: 0,
          scheduled_trips: 0,
          completed_trips: 0,
          active_trips: 0,
          cancelled_trips: 0,
        });
      }
    }

    // Enhance each owner in ownerTotals with vehicle, driver, and bus type stats
    for (const [oId, oTotal] of ownerTotals.entries()) {
      const ownerVehs = allVehicles.filter(v => Number(v.owner_id) === oId);
      const ownerDrivs = allDrivers.filter(d => Number(d.owner_id) === oId);
      const assignedCount = ownerDrivs.filter(d => driverAssignedVehicleMap.has(Number(d.id))).length;
      const ownerBusTypeNames = [...new Set(ownerVehs.map(v => v.bus_type?.name).filter(Boolean))];

      oTotal.vehicles_count = ownerVehs.length;
      oTotal.total_drivers = ownerDrivs.length;
      oTotal.assigned_drivers_count = assignedCount;
      oTotal.unassigned_drivers_count = ownerDrivs.length - assignedCount;
      oTotal.bus_types = ownerBusTypeNames;
    }

    const ownerBreakdown = [...ownerTotals.values()]
      .map((owner) => ({ ...owner, owner_name: ownerNameById.get(owner.owner_id) || `Owner #${owner.owner_id}` }))
      .sort((a, b) => b.revenue - a.revenue || b.trips - a.trips);

    const filteredOwners = selectedOwnerId
      ? ownerBreakdown.filter((owner) => owner.owner_id === selectedOwnerId)
      : ownerBreakdown;

    const routeBreakdown = [...routeTotals.values()]
      .filter((route) => !selectedOwnerId || route.owner_id === selectedOwnerId)
      .sort((a, b) => b.revenue - a.revenue || b.trips - a.trips);

    const report = [...periodTotals.values()].sort((a, b) => a.period.localeCompare(b.period));
    const grossRevenue = filteredOwners.reduce((sum, owner) => sum + owner.gross_revenue, 0);
    const netRevenue = filteredOwners.reduce((sum, owner) => sum + owner.net_revenue, 0);
    const total = grossRevenue;
    const distinctSeats = filteredOwners.reduce((sum, owner) => sum + owner.distinct_seats, 0);

    const filteredReport = selectedOwnerId
      ? [...periodOwnerTotals.values()]
        .filter((row) => row.owner_id === selectedOwnerId)
        .map(({ period, gross_revenue, net_revenue, revenue, distinct_seats }) => ({ period, gross_revenue, net_revenue, revenue, distinct_seats }))
        .sort((a, b) => a.period.localeCompare(b.period))
      : report;

    const filteredBookingRevenue = [...bookingRevenueGroups.values()]
      .filter((row) => !selectedOwnerId || row.owner_id === selectedOwnerId)
      .sort((a, b) => String(b.travel_date || '').localeCompare(String(a.travel_date || '')) || b.trip_id - a.trip_id);

    const bookingRevenueSummary = filteredBookingRevenue.reduce((totals, row) => ({
      bookings: totals.bookings + row.bookings,
      seats: totals.seats + row.seats,
      gross_revenue: addMoney(totals.gross_revenue, row.gross_revenue),
      net_revenue: addMoney(totals.net_revenue, row.net_revenue),
    }), { bookings: 0, seats: 0, gross_revenue: 0, net_revenue: 0 });

    // 7. Build Detailed Owner Analytics (when targetOwnerId is present)
    let selected_owner_analytics = null;
    if (targetOwnerId) {
      const ownerVehs = allVehicles.filter(v => Number(v.owner_id) === targetOwnerId);
      const ownerDrivs = allDrivers.filter(d => Number(d.owner_id) === targetOwnerId);

      const driversList = ownerDrivs.map(d => {
        const dId = Number(d.id);
        const assignedVeh = driverAssignedVehicleMap.get(dId) || null;
        const stats = driverTripStats.get(dId) || {
          total_trips: 0,
          completed_trips: 0,
          scheduled_trips: 0,
          active_trips: 0,
          cancelled_trips: 0,
          distinct_seats: 0,
          booking_count: 0,
          gross_revenue: 0,
          net_revenue: 0,
        };
        return {
          id: dId,
          driver_id: dId,
          name: d.name,
          mobile: d.mobile,
          status: d.status,
          online_status: d.online_status,
          is_assigned: Boolean(assignedVeh),
          assigned_vehicle: assignedVeh,
          ...stats,
        };
      }).sort((a, b) => (b.is_assigned ? 1 : 0) - (a.is_assigned ? 1 : 0) || b.total_trips - a.total_trips);

      const assignedDriversCount = driversList.filter(d => d.is_assigned).length;
      const unassignedDriversCount = driversList.length - assignedDriversCount;
      const assignmentRate = driversList.length
        ? Math.round((assignedDriversCount / driversList.length) * 100)
        : 0;

      const busTypeList = [...busTypeTotals.values()].sort((a, b) => b.vehicles_count - a.vehicles_count || b.trips_count - a.trips_count);

      const ownerTrips = trips.filter(t => {
        const vOwner = t.vehicle?.owner_id;
        const dOwner = t.driver?.owner_id;
        return Number(vOwner) === targetOwnerId || Number(dOwner) === targetOwnerId;
      });

      const scheduledTrips = ownerTrips.filter(t => t.status === 'Scheduled').length;
      const activeTrips = ownerTrips.filter(t => t.status === 'Active').length;
      const completedTrips = ownerTrips.filter(t => t.status === 'Completed').length;
      const cancelledTrips = ownerTrips.filter(t => t.status === 'Cancelled').length;
      const delayedTrips = ownerTrips.filter(t => t.status === 'Delayed').length;

      const ownerDistinctSeats = ownerTrips.reduce((sum, t) => sum + (tripSeatGroups.get(`${t.id}:${t.trip_date}`)?.seats?.size || 0), 0);
      const ownerBookingsCount = ownerTrips.reduce((sum, t) => sum + (tripSeatGroups.get(`${t.id}:${t.trip_date}`)?.bookings?.size || 0), 0);

      selected_owner_analytics = {
        owner_id: targetOwnerId,
        owner_name: ownerNameById.get(targetOwnerId) || `Owner #${targetOwnerId}`,
        driver_summary: {
          total_drivers: driversList.length,
          assigned_drivers_count: assignedDriversCount,
          unassigned_drivers_count: unassignedDriversCount,
          assignment_rate_percentage: assignmentRate,
          drivers: driversList,
        },
        bus_type_summary: {
          total_bus_types: busTypeList.length,
          bus_types: busTypeList,
        },
        trip_summary: {
          total_trips: ownerTrips.length,
          scheduled_trips: scheduledTrips,
          active_trips: activeTrips,
          completed_trips: completedTrips,
          cancelled_trips: cancelledTrips,
          delayed_trips: delayedTrips,
          total_distinct_seats: ownerDistinctSeats,
          total_bookings: ownerBookingsCount,
          gross_revenue: ownerTotals.get(targetOwnerId)?.gross_revenue || 0,
          net_revenue: ownerTotals.get(targetOwnerId)?.net_revenue || 0,
        },
        vehicle_summary: {
          total_vehicles: ownerVehs.length,
          active_vehicles: ownerVehs.filter(v => v.status === 'Active').length,
          under_maintenance: ownerVehs.filter(v => v.status === 'Under Maintenance').length,
          vehicles_with_driver: ownerVehs.filter(v => v.driver_id != null).length,
          vehicles_without_driver: ownerVehs.filter(v => v.driver_id == null).length,
          vehicles: ownerVehs.map(v => ({
            id: v.id,
            registration_number: v.registration_number,
            company_model: v.company_model,
            bus_type_name: v.bus_type?.name || 'Standard Bus',
            total_seats: v.total_seats || v.bus_type?.total_seats || 0,
            status: v.status,
            assigned_driver_name: v.driver?.name || null,
          })),
        },
      };
    }

    res.json({
      success: true,
      data: {
        report: filteredReport,
        total,
        gross_revenue: grossRevenue,
        net_revenue: netRevenue,
        distinct_seats: distinctSeats,
        owner_breakdown: filteredOwners,
        owner_options: ownerBreakdown.map(({ owner_id, owner_name }) => ({ owner_id, owner_name })),
        bus_type_options: allBusTypes.map(b => ({ value: String(b.id), label: `${b.name} (${b.code || b.seat_type})` })),
        route_options: allRoutes.map(r => ({ value: String(r.id), label: r.route_name || `${r.origin_city} → ${r.destination_city}` })),
        status_options: [
          { value: 'Scheduled', label: 'Scheduled' },
          { value: 'Active', label: 'Active' },
          { value: 'Completed', label: 'Completed' },
          { value: 'Cancelled', label: 'Cancelled' },
        ],
        bus_type_breakdown: [...busTypeTotals.values()].sort((a, b) => b.trips_count - a.trips_count || b.vehicles_count - a.vehicles_count),
        route_breakdown: routeBreakdown,
        trip_breakdown: tripBreakdown
          .filter((trip) => !targetOwnerId || trip.owner_id === targetOwnerId)
          .sort((a, b) => String(b.travel_date || '').localeCompare(String(a.travel_date || '')) || b.trip_id - a.trip_id),
        selected_owner_analytics,
        booking_revenue_breakdown: isAdmin ? filteredBookingRevenue : [],
        booking_revenue_totals: isAdmin ? bookingRevenueSummary : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Audit Logs ─────────────────────────────────────────────
exports.auditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, module, action, user_id, from_date, to_date } = req.query;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));
    const where = {};
    if (module) where.module = module;
    if (action) where.action = action;
    if (user_id) where.user_id = user_id;
    if (from_date && to_date) where.created_at = { [Op.between]: [new Date(from_date), new Date(to_date + ' 23:59:59')] };

    const { count, rows } = await AuditLog.findAndCountAll({ where, offset: (p - 1) * l, limit: l, order: [['created_at', 'DESC']] });
    res.json({ success: true, data: rows, pagination: { total: count, page: p, limit: l, pages: Math.ceil(count / l) } });
  } catch (err) {
    next(err);
  }
};
