'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { Booking, Trip, Driver, Vehicle, Passenger, CustomerUser, Payment, Refund, Route, Stop, AuditLog, AdminUser, Role } = require('../models');
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

    const ownerVehicleWhere = isOwner ? { owner_id: req.user.id } : {};
    const ownerDriverWhere = isOwner ? { owner_id: req.user.id } : {};
    const ownedVehicleRows = isOwner ? await Vehicle.findAll({ attributes: ['id'], where: ownerVehicleWhere, raw: true }) : [];
    const ownedDriverRows = isOwner ? await Driver.findAll({ attributes: ['id'], where: ownerDriverWhere, raw: true }) : [];
    const ownedVehicleIds = ownedVehicleRows.map((v) => v.id);
    const ownedDriverIds = ownedDriverRows.map((d) => d.id);
    const ownerTripWhere = isOwner
      ? { [Op.or]: [{ vehicle_id: { [Op.in]: ownedVehicleIds } }, { driver_id: { [Op.in]: ownedDriverIds } }] }
      : {};
    const ownerTripIds = isOwner
      ? (await Trip.findAll({ attributes: ['id'], where: ownerTripWhere, raw: true })).map((trip) => trip.id)
      : [];
    const ownerBookingWhere = isOwner ? { trip_id: { [Op.in]: ownerTripIds } } : {};

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
    const { from_date, to_date } = req.query;
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

    let ownerTripIds = null;
    if (isOwner) {
      const [vehicles, drivers] = await Promise.all([
        Vehicle.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }),
        Driver.findAll({ attributes: ['id'], where: { owner_id: req.user.id }, raw: true }),
      ]);
      const vehicleIds = vehicles.map((vehicle) => vehicle.id);
      const driverIds = drivers.map((driver) => driver.id);
      const ownerTripWhere = vehicleIds.length || driverIds.length
        ? { [Op.or]: [
          ...(vehicleIds.length ? [{ vehicle_id: { [Op.in]: vehicleIds } }] : []),
          ...(driverIds.length ? [{ driver_id: { [Op.in]: driverIds } }] : []),
        ] }
        : { id: { [Op.in]: [] } };
      ownerTripIds = (await Trip.findAll({ attributes: ['id'], where: ownerTripWhere, raw: true })).map((trip) => trip.id);
    }

    const bookingWhere = {
      booking_status: isOwner ? 'confirmed' : { [Op.in]: ['confirmed', 'completed'] },
      created_at: { [Op.between]: [startDate, endDate] },
    };
    if (isOwner) {
      bookingWhere.payment_status = 'paid';
      bookingWhere.boarding_status = 'boarded';
    }
    if (ownerTripIds) bookingWhere.trip_id = { [Op.in]: ownerTripIds };
    const bookings = await Booking.findAll({
      attributes: ['id', 'trip_id', 'travel_date', 'seat_numbers', 'total_seats', 'total_fare', 'discount_amount', 'final_amount', 'created_at', 'payment_status', 'boarding_status'],
      where: bookingWhere,
      order: [['created_at', 'ASC'], ['id', 'ASC']],
    });

    const tripIds = [...new Set(bookings.map((booking) => Number(booking.trip_id)))];
    const trips = tripIds.length ? await Trip.findAll({
      attributes: ['id', 'route_id', 'schedule_code', 'trip_date', 'departure_time', 'status', 'vehicle_id', 'driver_id'],
      where: { id: { [Op.in]: tripIds } },
      include: [
        { model: Route, as: 'route', attributes: ['id', 'route_name', 'route_code', 'origin_city', 'destination_city'], required: false },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'owner_id', 'registration_number', 'company_model', 'status'], required: false },
        { model: Driver, as: 'driver', attributes: ['id', 'owner_id', 'name', 'mobile', 'status'], required: false },
      ],
    }) : [];
    const tripById = new Map(trips.map((trip) => [Number(trip.id), trip]));
    const tripSeatGroups = new Map();
    const bookingRevenueGroups = new Map();
    for (const booking of bookings) {
      const trip = tripById.get(Number(booking.trip_id));
      if (!trip) continue;
      const vehicleOwnerId = trip.vehicle?.owner_id;
      const driverOwnerId = trip.driver?.owner_id;
      const ownerMatches = Number(vehicleOwnerId) === Number(req.user.id) || Number(driverOwnerId) === Number(req.user.id);
      const ownerId = isOwner ? Number(req.user.id) : Number(vehicleOwnerId || driverOwnerId || 0);
      if (isOwner && !ownerMatches) continue;

      const tripDateKey = `${Number(trip.id)}:${booking.travel_date}`;
      let group = tripSeatGroups.get(tripDateKey);
      if (!group) {
        group = { trip, ownerId: Number(ownerId), travelDate: booking.travel_date, seats: new Map(), bookings: new Set() };
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
            travel_date: booking.travel_date,
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
      const seatNumbers = bookedSeatNumbers;
      const bookingSeatCount = bookedSeatCount;
      const historicFare = bookingGrossFare;
      const grossFarePerSeat = historicFare / bookingSeatCount;
      const netFarePerSeat = Math.max(0, Number(booking.final_amount || 0)) / bookingSeatCount;
      if (seatNumbers.length) {
        for (const seat of seatNumbers) {
          const identity = normalizeSeatIdentity(seat);
          if (!group.seats.has(identity)) group.seats.set(identity, {
            bookedAt: bookingDate,
            grossFare: grossFarePerSeat,
            netFare: netFarePerSeat,
          });
        }
      } else {
        const fallbackSeatCount = Math.max(1, Number(booking.total_seats) || 1);
        for (let index = 0; index < fallbackSeatCount; index += 1) {
          group.seats.set(`booking:${booking.id}:${index}`, {
            bookedAt: bookingDate,
            grossFare: grossFarePerSeat,
            netFare: netFarePerSeat,
          });
        }
      }
    }

    const periodTotals = new Map();
    const periodOwnerTotals = new Map();
    const ownerTotals = new Map();
    const routeTotals = new Map();
    const tripBreakdown = [];
    for (const group of tripSeatGroups.values()) {
      const routeId = Number(group.trip.route_id);
      let tripGrossRevenue = 0;
      let tripNetRevenue = 0;
      for (const seat of group.seats.values()) {
        tripGrossRevenue = addMoney(tripGrossRevenue, seat.grossFare);
        tripNetRevenue = addMoney(tripNetRevenue, seat.netFare);
      }
      tripBreakdown.push({
        owner_id: group.ownerId,
        trip_id: Number(group.trip.id),
        schedule_code: group.trip.schedule_code,
        travel_date: group.travelDate,
        trip_date: group.trip.trip_date,
        departure_time: group.trip.departure_time,
        status: group.trip.status,
        route_id: routeId,
        route_name: group.trip.route?.route_name || `Route #${routeId}`,
        route_code: group.trip.route?.route_code || null,
        origin_city: group.trip.route?.origin_city || null,
        destination_city: group.trip.route?.destination_city || null,
        vehicle: group.trip.vehicle ? {
          id: group.trip.vehicle.id,
          registration_number: group.trip.vehicle.registration_number,
          model: group.trip.vehicle.company_model,
          status: group.trip.vehicle.status,
        } : null,
        driver: group.trip.driver ? {
          id: group.trip.driver.id,
          name: group.trip.driver.name,
          mobile: group.trip.driver.mobile,
          status: group.trip.driver.status,
        } : null,
        distinct_seats: group.seats.size,
        booking_count: group.bookings.size,
        gross_revenue: tripGrossRevenue,
        net_revenue: tripNetRevenue,
        revenue: tripGrossRevenue,
      });
      let ownerTotal = ownerTotals.get(group.ownerId);
      if (!ownerTotal) {
        ownerTotal = { owner_id: group.ownerId, owner_name: group.trip.vehicle?.owner?.name || group.trip.driver?.owner?.name || null, gross_revenue: 0, net_revenue: 0, revenue: 0, distinct_seats: 0, trips: 0 };
        ownerTotals.set(group.ownerId, ownerTotal);
      }
      ownerTotal.trips += 1;
      ownerTotal.distinct_seats += group.seats.size;

      const routeKey = `${group.ownerId}:${routeId}`;
      let routeTotal = routeTotals.get(routeKey);
      if (!routeTotal) {
        routeTotal = {
          owner_id: group.ownerId,
          route_id: routeId,
          route_name: group.trip.route?.route_name || `Route #${routeId}`,
          fare_per_seat: 0,
          fare_total: 0,
          net_revenue: 0,
          revenue: 0,
          distinct_seats: 0,
          trips: 0,
        };
        routeTotals.set(routeKey, routeTotal);
      }
      routeTotal.distinct_seats += group.seats.size;
      routeTotal.trips += 1;

      for (const seat of group.seats.values()) {
        ownerTotal.gross_revenue = addMoney(ownerTotal.gross_revenue, seat.grossFare);
        ownerTotal.net_revenue = addMoney(ownerTotal.net_revenue, seat.netFare);
        ownerTotal.revenue = ownerTotal.gross_revenue;
        routeTotal.revenue = addMoney(routeTotal.revenue, seat.grossFare);
        routeTotal.net_revenue = addMoney(routeTotal.net_revenue, seat.netFare);
        routeTotal.fare_total = addMoney(routeTotal.fare_total, seat.grossFare);

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

        const ownerPeriodKey = `${group.ownerId}:${periodKey}`;
        let ownerPeriodTotal = periodOwnerTotals.get(ownerPeriodKey);
        if (!ownerPeriodTotal) {
          ownerPeriodTotal = { owner_id: group.ownerId, period: periodKey, gross_revenue: 0, net_revenue: 0, revenue: 0, distinct_seats: 0 };
          periodOwnerTotals.set(ownerPeriodKey, ownerPeriodTotal);
        }
        ownerPeriodTotal.gross_revenue = addMoney(ownerPeriodTotal.gross_revenue, seat.grossFare);
        ownerPeriodTotal.net_revenue = addMoney(ownerPeriodTotal.net_revenue, seat.netFare);
        ownerPeriodTotal.revenue = ownerPeriodTotal.gross_revenue;
        ownerPeriodTotal.distinct_seats += 1;
      }
    }

    for (const routeTotal of routeTotals.values()) {
      routeTotal.fare_per_seat = routeTotal.distinct_seats
        ? Math.round((routeTotal.fare_total / routeTotal.distinct_seats + Number.EPSILON) * 100) / 100
        : 0;
      routeTotal.revenue = routeTotal.fare_total;
      delete routeTotal.fare_total;
    }

    const owners = isAdmin ? await AdminUser.findAll({
      attributes: ['id', 'name'],
      include: [{ model: Role, as: 'role', attributes: [], where: { name: 'owner' }, required: true }],
      raw: true,
    }) : [];
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
        });
      }
    }
    const ownerNames = new Map(owners.map((owner) => [Number(owner.id), owner.name]));
    const ownerBreakdown = [...ownerTotals.values()]
      .map((owner) => ({ ...owner, owner_name: ownerNames.get(owner.owner_id) || `Owner #${owner.owner_id}` }))
      .sort((a, b) => b.revenue - a.revenue);
    const filteredOwners = selectedOwnerId
      ? ownerBreakdown.filter((owner) => owner.owner_id === selectedOwnerId)
      : ownerBreakdown;
    const routeBreakdown = [...routeTotals.values()]
      .filter((route) => !selectedOwnerId || route.owner_id === selectedOwnerId)
      .sort((a, b) => b.revenue - a.revenue);
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

    res.json({ success: true, data: {
      report: filteredReport,
      total,
      gross_revenue: grossRevenue,
      net_revenue: netRevenue,
      distinct_seats: distinctSeats,
      owner_breakdown: filteredOwners,
      owner_options: ownerBreakdown.map(({ owner_id, owner_name }) => ({ owner_id, owner_name })),
      route_breakdown: routeBreakdown,
      trip_breakdown: tripBreakdown
        .filter((trip) => !selectedOwnerId || trip.owner_id === selectedOwnerId)
        .sort((a, b) => String(b.travel_date || '').localeCompare(String(a.travel_date || '')) || b.trip_id - a.trip_id),
      booking_revenue_breakdown: isAdmin ? filteredBookingRevenue : [],
      booking_revenue_totals: isAdmin ? bookingRevenueSummary : null,
    } });
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
