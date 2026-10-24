'use strict';

const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const sequelize = require('../config/database');
const {
  Booking,
  ShuttleBooking,
  RidePackage,
  PassengerPackagePurchase,
  Trip,
  BusSchedule,
  Route,
  Stop,
  RouteStop,
  Vehicle,
  BusType,
  CustomerUser,
  Passenger,
  Payment,
  Refund,
  WalletTransaction,
  Coupon,
  CouponUsage,
} = require('../models');
const PackagePricingService = require('../services/packagePricingService');
const BusRouteSearchService = require('../services/busRouteSearchService');
const SeatReservationService = require('../services/seatReservationService');
const { resolveFare } = require('../utils/fareCalculator');
const { calculateCouponDiscount } = require('../utils/coupon');
const { reserveRides, releaseBookingReservation } = require('../services/packagePurchaseService');

/**
 * Controller for Shuttle Booking and Ride Pack package management.
 */
class ShuttleController {
  /**
   * 1. GET /packages - List available Ride Pack packages
   */
  static async getPackages(req, res, next) {
    try {
      const routeId = req.query?.route_id || req.body?.route_id || null;
      const status = req.query?.status || (req.user ? 'all' : 'Active');
      const conditions = ['`deleted_at` IS NULL'];
      const replacements = {};

      if (status.toLowerCase() !== 'all') {
        conditions.push('`status` = :status');
        replacements.status = status;
      }

      if (routeId) {
        conditions.push('(`route_id` IS NULL OR `route_id` = :routeId)');
        replacements.routeId = Number(routeId);
      }

      const [rows] = await sequelize.query(`
        SELECT *
        FROM \`ride_packages\`
        WHERE ${conditions.join(' AND ')}
        ORDER BY \`is_popular\` DESC, \`rides_count\` ASC, \`total_price\` ASC
      `, { replacements });

      const packages = rows.map((row) => {
        const total = Number(row.total_price);
        const perRide = Number(row.price_per_ride);
        const original = row.original_price != null ? Number(row.original_price) : null;
        const savings = original != null && original > total ? original - total : 0;
        const features = Array.isArray(row.features)
          ? row.features
          : (typeof row.features === 'string' ? JSON.parse(row.features || '[]') : []);

        return {
          ...row,
          price_per_ride: perRide,
          total_price: total,
          original_price: original,
          savings_amount: savings,
          discount_percentage: original != null && original > total
            ? Math.round((savings / original) * 100)
            : Number(row.discount_percentage || 0),
          formatted_price: `₹${total}`,
          formatted_per_ride: `₹${perRide}/ride`,
          features,
        };
      });

      return res.status(200).json({
        status: 200,
        success: true,
        message: 'Ride Pack packages retrieved successfully',
        data: packages,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2. GET /packages/:id - Get package details
   */
  static async getPackageDetails(req, res, next) {
    try {
      const { id } = req.params;
      const pkg = await PackagePricingService.getPackageByIdOrCode(id);

      if (!pkg) {
        return res.status(404).json({
          status: 404,
          success: false,
          message: 'Package not found',
        });
      }

      const data = pkg.toJSON();
      const perRide = Number(data.price_per_ride);
      const total = Number(data.total_price);
      const orig = data.original_price != null ? Number(data.original_price) : null;
      const savings = orig && orig > total ? orig - total : 0;
      const discountPct = orig && orig > total
        ? Math.round((savings / orig) * 100)
        : Number(data.discount_percentage || 0);

      return res.status(200).json({
        status: 200,
        success: true,
        message: 'Package details retrieved successfully',
        data: {
          ...data,
          price_per_ride: perRide,
          total_price: total,
          original_price: orig,
          savings_amount: savings,
          discount_percentage: discountPct,
          features: Array.isArray(data.features) ? data.features : (typeof data.features === 'string' ? JSON.parse(data.features || '[]') : []),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 3. POST /packages - Create Ride Pack package (Admin)
   */
  static async createPackage(req, res, next) {
    try {
      const body = req.body || {};
      const {
        name,
        package_code,
        package_type = 'fixed_bundle',
        rides_count,
        validity_days,
        price_per_ride,
        total_price,
        original_price,
        discount_percentage,
        route_id,
        description,
        features,
        badge_text,
        is_popular,
        status = 'Active',
      } = body;

      if (!name || !price_per_ride || !total_price) {
        return res.status(400).json({
          status: 400,
          success: false,
          message: 'name, price_per_ride, and total_price are required',
        });
      }

      const generatedCode = package_code || `RP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 100)}`;

      const newPackage = await RidePackage.create({
        name,
        package_code: generatedCode,
        package_type,
        rides_count: parseInt(rides_count || 10, 10),
        validity_days: parseInt(validity_days || 30, 10),
        price_per_ride: parseFloat(price_per_ride),
        total_price: parseFloat(total_price),
        original_price: original_price ? parseFloat(original_price) : null,
        discount_percentage: discount_percentage ? parseFloat(discount_percentage) : 0,
        route_id: route_id ? Number(route_id) : null,
        description: description || null,
        features: features || [],
        badge_text: badge_text || null,
        is_popular: Boolean(is_popular),
        status,
      });

      return res.status(201).json({
        status: 201,
        success: true,
        message: 'Ride Pack package created successfully',
        data: newPackage,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 4. PUT /packages/:id - Update Ride Pack package (Admin)
   */
  static async updatePackage(req, res, next) {
    try {
      const { id } = req.params;
      const pkg = await RidePackage.findByPk(id);

      if (!pkg) {
        return res.status(404).json({
          status: 404,
          success: false,
          message: 'Package not found',
        });
      }

      const body = req.body || {};
      const updateData = { ...body };
      if (body.price_per_ride !== undefined) updateData.price_per_ride = parseFloat(body.price_per_ride);
      if (body.total_price !== undefined) updateData.total_price = parseFloat(body.total_price);
      if (body.original_price !== undefined) updateData.original_price = body.original_price ? parseFloat(body.original_price) : null;
      if (body.rides_count !== undefined) updateData.rides_count = parseInt(body.rides_count, 10);
      if (body.validity_days !== undefined) updateData.validity_days = parseInt(body.validity_days, 10);
      if (body.route_id !== undefined) updateData.route_id = body.route_id ? Number(body.route_id) : null;
      if (body.is_popular !== undefined) updateData.is_popular = Boolean(body.is_popular);

      await pkg.update(updateData);

      return res.status(200).json({
        status: 200,
        success: true,
        message: 'Package updated successfully',
        data: pkg,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 5. DELETE /packages/:id - Delete Ride Pack package (Admin)
   */
  static async deletePackage(req, res, next) {
    try {
      const { id } = req.params;
      const pkg = await RidePackage.findByPk(id);

      if (!pkg) {
        return res.status(404).json({
          status: 404,
          success: false,
          message: 'Package not found',
        });
      }

      await pkg.destroy();

      return res.status(200).json({
        status: 200,
        success: true,
        message: 'Package deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 5b. PATCH /packages/:id/toggle-status - Toggle package Active/Inactive (Admin)
   */
  static async togglePackageStatus(req, res, next) {
    try {
      const { id } = req.params;
      const pkg = await RidePackage.findByPk(id);

      if (!pkg) {
        return res.status(404).json({
          status: 404,
          success: false,
          message: 'Package not found',
        });
      }

      const nextStatus = (pkg.status || '').toLowerCase() === 'active' ? 'Inactive' : 'Active';
      await pkg.update({ status: nextStatus });

      return res.status(200).json({
        status: 200,
        success: true,
        message: `Package status changed to ${nextStatus}`,
        data: pkg,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 6. POST /search - Shuttle Route Search (Cityflo location-first + Packages)
   */
  static async searchShuttles(req, res, next) {
    try {
      const rawPickupObj = req.body?.pickup ?? req.query?.pickup;
      const rawDropoffObj = req.body?.dropoff ?? req.query?.dropoff;

      const pLatRaw = (typeof rawPickupObj === 'object' && rawPickupObj !== null ? (rawPickupObj.latitude ?? rawPickupObj.lat) : undefined)
        ?? req.body?.pickup_latitude ?? req.query?.pickup_latitude ?? req.body?.pickup_lat ?? req.query?.pickup_lat;

      const pLngRaw = (typeof rawPickupObj === 'object' && rawPickupObj !== null ? (rawPickupObj.longitude ?? rawPickupObj.lng) : undefined)
        ?? req.body?.pickup_longitude ?? req.query?.pickup_longitude ?? req.body?.pickup_lng ?? req.query?.pickup_lng;

      const dLatRaw = (typeof rawDropoffObj === 'object' && rawDropoffObj !== null ? (rawDropoffObj.latitude ?? rawDropoffObj.lat) : undefined)
        ?? req.body?.dropoff_latitude ?? req.query?.dropoff_latitude ?? req.body?.dropoff_lat ?? req.query?.dropoff_lat;

      const dLngRaw = (typeof rawDropoffObj === 'object' && rawDropoffObj !== null ? (rawDropoffObj.longitude ?? rawDropoffObj.lng) : undefined)
        ?? req.body?.dropoff_longitude ?? req.query?.dropoff_longitude ?? req.body?.dropoff_lng ?? req.query?.dropoff_lng;

      let pLat = pLatRaw !== undefined && pLatRaw !== null && pLatRaw !== '' ? parseFloat(pLatRaw) : NaN;
      let pLng = pLngRaw !== undefined && pLngRaw !== null && pLngRaw !== '' ? parseFloat(pLngRaw) : NaN;
      let dLat = dLatRaw !== undefined && dLatRaw !== null && dLatRaw !== '' ? parseFloat(dLatRaw) : NaN;
      let dLng = dLngRaw !== undefined && dLngRaw !== null && dLngRaw !== '' ? parseFloat(dLngRaw) : NaN;

      let rawPickupName = req.body?.pickup_name || req.query?.pickup_name || req.body?.pickup_location || req.query?.pickup_location;
      if (!rawPickupName && typeof rawPickupObj === 'string') rawPickupName = rawPickupObj;
      if (!rawPickupName && typeof rawPickupObj === 'object' && rawPickupObj !== null && typeof rawPickupObj.name === 'string') rawPickupName = rawPickupObj.name;

      let rawDropoffName = req.body?.dropoff_name || req.query?.dropoff_name || req.body?.dropoff_location || req.query?.dropoff_location;
      if (!rawDropoffName && typeof rawDropoffObj === 'string') rawDropoffName = rawDropoffObj;
      if (!rawDropoffName && typeof rawDropoffObj === 'object' && rawDropoffObj !== null && typeof rawDropoffObj.name === 'string') rawDropoffName = rawDropoffObj.name;

      const pStopId = req.body?.pickup?.stop_id || req.query?.pickup?.stop_id || req.body?.pickup_stop_id || req.query?.pickup_stop_id || null;
      const dStopId = req.body?.dropoff?.stop_id || req.query?.dropoff?.stop_id || req.body?.drop_stop_id || req.query?.drop_stop_id || null;

      // Coordinate fallbacks for Kolkata / general testing if text query provided without GPS
      if (isNaN(pLat) && typeof rawPickupName === 'string') {
        const lower = rawPickupName.toLowerCase();
        if (lower.includes('garia')) { pLat = 22.4600; pLng = 88.3800; }
        else if (lower.includes('bidhan') || lower.includes('salt lake')) { pLat = 22.5700; pLng = 88.4000; }
        else if (lower.includes('howrah')) { pLat = 22.5850; pLng = 88.3420; }
        else if (lower.includes('sector 5')) { pLat = 22.5735; pLng = 88.4331; }
      }
      if (isNaN(dLat) && typeof rawDropoffName === 'string') {
        const lower = rawDropoffName.toLowerCase();
        if (lower.includes('bidhan') || lower.includes('salt lake')) { dLat = 22.5700; dLng = 88.4000; }
        else if (lower.includes('garia')) { dLat = 22.4600; dLng = 88.3800; }
        else if (lower.includes('sector 5')) { dLat = 22.5735; dLng = 88.4331; }
      }

      const travelDate = req.body?.date || req.query?.date || req.body?.travel_date || req.query?.travel_date || new Date().toISOString().split('T')[0];
      const rawPassengers = req.body?.passengers ?? req.query?.passengers;
      const passengers = parseInt(rawPassengers !== undefined ? rawPassengers : 1, 10);
      const busTypeId = req.body?.bus_type_id || req.query?.bus_type_id || null;

      const pickupInput = {
        stop_id: pStopId,
        name: rawPickupName || 'Pickup Location',
        latitude: !isNaN(pLat) ? pLat : null,
        longitude: !isNaN(pLng) ? pLng : null,
      };

      const dropoffInput = {
        stop_id: dStopId,
        name: rawDropoffName || 'Dropoff Location',
        latitude: !isNaN(dLat) ? dLat : null,
        longitude: !isNaN(dLng) ? dLng : null,
      };

      const [searchResult, availablePackages] = await Promise.all([
        BusRouteSearchService.search({
          pickupInput,
          dropoffInput,
          travelDateInput: travelDate,
          passengersInput: passengers,
          busTypeId,
        }),
        PackagePricingService.listPackages(),
      ]);

      return res.status(200).json({
        ...searchResult,
        available_packages: availablePackages,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 7. POST /book - Create Shuttle Booking with Single Ride OR Ride Pack Package
   */
  static async bookShuttle(req, res, next) {
    const t = await sequelize.transaction();
    let packageIdempotencyKey = null;
    try {
      const body = req.body || {};
      const {
        schedule_id,
        trip_id,
        pickup_stop_id,
        drop_stop_id,
        origin_stop_id,
        destination_stop_id,
        passengers = 1,
        total_seats,
        passenger_name,
        passenger_mobile,
        passenger_email,
        travel_date,
        payment_method = 'cash',
        use_wallet = false,
        package_id = null,
        package_code = null,
        package_purchase_id,
        seat_numbers,
        coupon_id,
        coupon_code,
        special_requests,
      } = body;

      const actualPickupStopId = pickup_stop_id || origin_stop_id;
      const actualDropStopId = drop_stop_id || destination_stop_id;
      const seatCount = Number(total_seats || passengers || 1);
      const resolvedPassengerName = req.passenger?.name || passenger_name;
      const resolvedPassengerMobile = req.passenger?.mobile || passenger_mobile;
      const resolvedPassengerEmail = req.passenger?.email || passenger_email;

      if (!schedule_id && !trip_id) {
        await t.rollback();
        return res.status(400).json({
          status: 400,
          success: false,
          message: 'schedule_id or trip_id is required',
        });
      }

      if (!actualPickupStopId || !actualDropStopId) {
        await t.rollback();
        return res.status(400).json({
          status: 400,
          success: false,
          message: 'pickup_stop_id and drop_stop_id are required',
        });
      }

      if (!resolvedPassengerName || !resolvedPassengerMobile) {
        await t.rollback();
        return res.status(400).json({
          status: 400,
          success: false,
          message: 'passenger_name and passenger_mobile are required',
        });
      }
      if (package_purchase_id) {
        if (!req.passenger) {
          await t.rollback();
          return res.status(401).json({ status: 401, success: false, message: 'Passenger authentication is required to use a package purchase' });
        }
        packageIdempotencyKey = String(body.idempotency_key || req.headers['idempotency-key'] || '').trim();
        if (!packageIdempotencyKey || packageIdempotencyKey.length > 100) {
          await t.rollback();
          return res.status(400).json({
            status: 400,
            success: false,
            message: 'A unique idempotency_key of at most 100 characters is required for package bookings',
          });
        }
        const existingBooking = await Booking.findOne({
          where: { passenger_id: req.passenger.id, idempotency_key: packageIdempotencyKey },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (existingBooking) {
          if (Number(existingBooking.package_purchase_id) !== Number(package_purchase_id)) {
            await t.rollback();
            return res.status(409).json({ status: 409, success: false, message: 'idempotency_key has already been used for another booking' });
          }
          await t.commit();
          return res.status(200).json({
            status: 200,
            success: true,
            message: 'Existing package booking returned for this idempotency_key',
            booking: existingBooking,
            data: existingBooking,
          });
        }
      }

      const travelDateStr = travel_date ? String(travel_date).slice(0, 10) : new Date().toISOString().slice(0, 10);

      // ── Step A: Find Trip or BusSchedule ──────────────────────────────
      let trip = null;
      let schedule = null;
      let routeId = null;
      let vehicleId = null;
      let busTypeId = null;
      let capacity = 30;
      let bookedSeats = 0;
      let departureTime = '08:00:00';
      let arrivalTime = '09:00:00';
      let routeName = 'Shuttle Route';
      let baseFare = 99;

      const candidateId = schedule_id || trip_id;
      if (trip_id) {
        trip = await Trip.findByPk(trip_id, {
          include: [
            { model: Route, as: 'route', required: false },
            { model: Vehicle, as: 'vehicle', required: false },
            { model: BusType, as: 'bus_type', required: false },
          ],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
      }

      if (!trip && candidateId) {
        // Try looking up BusSchedule
        schedule = await BusSchedule.findByPk(candidateId, {
          include: [
            { model: Route, as: 'route', required: false },
            { model: Vehicle, as: 'vehicle', required: false },
            { model: BusType, as: 'bus_type', required: false },
          ],
          transaction: t,
        });

        if (schedule) {
          trip = schedule;
          routeId = schedule.route_id;
          vehicleId = schedule.vehicle_id || schedule.car_id;
          busTypeId = schedule.bus_type_id;
          capacity = schedule.seat_capacity || schedule.bus_type?.total_seats || schedule.vehicle?.total_seats || 30;
          bookedSeats = schedule.booked_seats || 0;
          departureTime = schedule.departure_time || '08:00:00';
          arrivalTime = schedule.arrival_time || '09:00:00';
          routeName = schedule.route?.route_name || schedule.bus_number || 'Express Shuttle';
          baseFare = Number(schedule.base_fare || 99);
        }
      }

      if (trip) {
        routeId = trip.route_id;
        vehicleId = trip.vehicle_id;
        busTypeId = trip.bus_type_id;
        capacity = trip.vehicle?.total_seats || trip.bus_type?.total_seats || capacity || 30;
        bookedSeats = trip.booked_seats || 0;
        departureTime = trip.departure_time || departureTime;
        arrivalTime = trip.arrival_time || arrivalTime;
        if (trip.route?.route_name) routeName = trip.route.route_name;
        if (trip.base_fare) baseFare = Number(trip.base_fare);
      }

      if (!trip && !schedule) {
        await t.rollback();
        return res.status(404).json({
          status: 404,
          success: false,
          message: 'Shuttle schedule or trip was not found',
        });
      }

      // ── Step B: Validate Stops & Stop Names ────────────────────────────
      const [pickupStop, dropStop] = await Promise.all([
        Stop.findByPk(actualPickupStopId, { transaction: t }),
        Stop.findByPk(actualDropStopId, { transaction: t }),
      ]);

      const pickupStopName = pickupStop?.stop_name || pickupStop?.name || `Stop #${actualPickupStopId}`;
      const dropStopName = dropStop?.stop_name || dropStop?.name || `Stop #${actualDropStopId}`;

      // Sequence check: drop stop sequence must be after pickup stop sequence
      if (pickupStop && dropStop && pickupStop.stop_sequence != null && dropStop.stop_sequence != null) {
        if (Number(dropStop.stop_sequence) <= Number(pickupStop.stop_sequence)) {
          await t.rollback();
          return res.status(400).json({
            status: 400,
            success: false,
            message: 'Invalid stop sequence: dropoff stop must come after pickup stop along the route',
          });
        }
      }

      // ── Step C: Validate Seat Capacity & Seat Conflicts ───────────────
      const requestedSeats = SeatReservationService.parseSeatNumbers(seat_numbers || body.seat_number || body.seats);
      const totalSeatsToBook = Math.max(seatCount, requestedSeats.length > 0 ? requestedSeats.length : 1);
      if (!Number.isInteger(totalSeatsToBook) || totalSeatsToBook < 1) {
        await t.rollback();
        return res.status(400).json({ status: 400, success: false, message: 'total_seats must be a positive whole number' });
      }

      if (trip) {
        if (requestedSeats.length > 0) {
          const conflictRes = await SeatReservationService.checkSeatConflict({
            tripId: trip.id,
            travelDate: travelDateStr,
            requestedSeats,
            transaction: t,
          });

          if (conflictRes.hasConflict) {
            await t.rollback();
            return res.status(409).json({
              status: 409,
              success: false,
              message: `Seat ${conflictRes.conflictingSeat} is already booked`,
              code: 'SEAT_ALREADY_BOOKED',
            });
          }
        }

        const available = capacity - bookedSeats;
        if (available < totalSeatsToBook) {
          await t.rollback();
          return res.status(409).json({
            status: 409,
            success: false,
            message: `Only ${Math.max(0, available)} seats available for this shuttle departure`,
            code: 'INSUFFICIENT_SEATS',
            data: { available_seats: Math.max(0, available), requested_seats: totalSeatsToBook },
          });
        }
      }

      // ── Step D: Pricing Calculation (Package vs Single Ride) ──────────
      let isPackageBooking = false;
      let packageSnapshot = null;
      let totalFare = 0;
      let discountAmount = 0;
      let finalAmount = 0;
      let appliedPackage = null;
      let appliedCoupon = null;
      let packagePurchase = null;

      const requestedPackageId = package_id || package_code || body.selected_package_id;

      if (package_purchase_id) {
        if (!req.passenger) {
          await t.rollback();
          return res.status(401).json({ status: 401, success: false, message: 'Passenger authentication is required to use a package purchase' });
        }
        if (requestedPackageId) {
          await t.rollback();
          return res.status(400).json({ status: 400, success: false, message: 'Use package_purchase_id without package_id or package_code' });
        }
        packagePurchase = await PassengerPackagePurchase.findOne({
          where: { id: package_purchase_id, passenger_id: req.passenger.id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!packagePurchase) {
          await t.rollback();
          return res.status(404).json({ status: 404, success: false, message: 'Passenger package purchase was not found' });
        }
        if (packagePurchase.payment_status !== 'paid' || packagePurchase.status !== 'active') {
          await t.rollback();
          return res.status(409).json({ status: 409, success: false, message: 'Passenger package purchase is not active' });
        }
        if (!packagePurchase.expires_at || new Date(packagePurchase.expires_at) <= new Date()) {
          await packagePurchase.update({ status: 'expired' }, { transaction: t });
          await t.commit();
          return res.status(409).json({ status: 409, success: false, message: 'Passenger package purchase has expired' });
        }
        if (packagePurchase.route_id && Number(packagePurchase.route_id) !== Number(routeId)) {
          await t.rollback();
          return res.status(400).json({ status: 400, success: false, message: 'Passenger package purchase is not valid for this route' });
        }
        const availableRides = Number(packagePurchase.total_rides)
          - Number(packagePurchase.used_rides)
          - Number(packagePurchase.reserved_rides);
        if (availableRides < totalSeatsToBook) {
          await t.rollback();
          return res.status(409).json({
            status: 409,
            success: false,
            message: 'Passenger package purchase does not have enough rides available',
            data: { available_rides: availableRides, requested_rides: totalSeatsToBook },
          });
        }
        isPackageBooking = true;
        packageSnapshot = {
          package_id: packagePurchase.package_id,
          package_code: packagePurchase.package_code,
          package_name: packagePurchase.package_name,
          rides_count: Number(packagePurchase.total_rides),
          validity_days: Number(packagePurchase.validity_days),
          price_per_ride: Number(packagePurchase.price_per_ride),
          package_price: Number(packagePurchase.amount_paid),
          final_booking_amount: 0,
        };
      } else if (requestedPackageId) {
        // ── Package Pricing Flow ──
        const packageValidation = await PackagePricingService.calculateAndValidatePackageFare({
          packageId: requestedPackageId,
          packageCode: requestedPackageId,
          routeId,
          seatCount: totalSeatsToBook,
          travelDate: travelDateStr,
          baseFare,
          transaction: t,
        });

        if (!packageValidation.isValid) {
          await t.rollback();
          return res.status(400).json({
            status: 400,
            success: false,
            message: packageValidation.error,
            code: packageValidation.code || 'PACKAGE_INVALID',
          });
        }

        isPackageBooking = true;
        appliedPackage = packageValidation.package;
        packageSnapshot = packageValidation.priceSnapshot;
        totalFare = packageSnapshot.original_price || packageSnapshot.package_price;
        discountAmount = packageSnapshot.savings_amount || 0;
        finalAmount = packageSnapshot.final_booking_amount;
      } else {
        // ── Single Ride Fare Flow ──
        const singleFareRes = await PackagePricingService.calculateSingleRideFare({
          routeId,
          originStopId: actualPickupStopId,
          destinationStopId: actualDropStopId,
          fallbackFare: baseFare,
          seatCount: totalSeatsToBook,
          transaction: t,
        });

        totalFare = singleFareRes.totalFare;

        if (coupon_id || coupon_code) {
          const couponRes = await calculateCouponDiscount({
            couponId: coupon_id,
            couponCode: coupon_code,
            amount: totalFare,
            seatCount: totalSeatsToBook,
            transaction: t,
            lock: true,
          });

          if (couponRes && !couponRes.error) {
            appliedCoupon = couponRes.coupon;
            discountAmount = couponRes.discount;
            await appliedCoupon.increment('used_count', { by: 1, transaction: t });
          }
        }

        finalAmount = Math.max(0, totalFare - discountAmount);
      }

      // ── Step E: Resolve or Create Passenger User ───────────────────────
      let passengerUser = await CustomerUser.findOne({
        where: req.passenger
          ? { id: req.passenger.id }
          : { mobile: String(resolvedPassengerMobile).trim() },
        transaction: t,
        lock: req.passenger ? t.LOCK.UPDATE : undefined,
      });

      if (!passengerUser) {
        if (req.passenger) {
          await t.rollback();
          return res.status(404).json({ status: 404, success: false, message: 'Authenticated passenger account was not found' });
        }
        passengerUser = await CustomerUser.create({
          name: resolvedPassengerName.trim(),
          mobile: String(resolvedPassengerMobile).trim(),
          email: resolvedPassengerEmail ? resolvedPassengerEmail.trim() : null,
          status: 'Active',
          wallet_balance: 0.00,
        }, { transaction: t });
      }

      // ── Step F: Wallet Payment Handling ───────────────────────────────
      const walletPaymentRequested = !packagePurchase
        && (use_wallet === true || String(use_wallet).toLowerCase() === 'true' || payment_method === 'wallet');
      let walletBalanceAfter = null;

      if (walletPaymentRequested && finalAmount > 0) {
        const currentBalance = Number(passengerUser.wallet_balance || 0);
        if (currentBalance < finalAmount) {
          await t.rollback();
          return res.status(409).json({
            status: 409,
            success: false,
            message: 'Insufficient wallet balance for shuttle booking',
            data: { required_amount: finalAmount, wallet_balance: currentBalance },
          });
        }
        walletBalanceAfter = Math.round((currentBalance - finalAmount) * 100) / 100;
        await passengerUser.update({ wallet_balance: walletBalanceAfter }, { transaction: t });
      }

      // ── Step G: Generate Boarding Pass, Token, and Identifiers ─────────
      const bookingRef = `SH-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const bookingIdCode = `BK-SH-${Date.now()}`;
      const boardingPassCode = `BP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const boardingPin = Math.floor(1000 + Math.random() * 9000).toString();
      const qrToken = uuidv4();
      const isPaid = Boolean(packagePurchase) || walletPaymentRequested || finalAmount <= 0;

      // ── Step H: Create Core Booking Record ─────────────────────────────
      const bookingRecord = await Booking.create({
        booking_reference: bookingRef,
        trip_id: trip ? trip.id : 1,
        passenger_id: passengerUser.id,
        passenger_name: resolvedPassengerName.trim(),
        passenger_mobile: String(resolvedPassengerMobile).trim(),
        passenger_email: resolvedPassengerEmail ? resolvedPassengerEmail.trim() : null,
        origin_stop_id: actualPickupStopId,
        destination_stop_id: actualDropStopId,
        pickup_stop_name: pickupStopName,
        drop_stop_name: dropStopName,
        departure_time: departureTime,
        arrival_time: arrivalTime,
        travel_date: travelDateStr,
        seat_numbers: requestedSeats.length > 0 ? requestedSeats : [1],
        total_seats: totalSeatsToBook,
        total_fare: totalFare,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        package_id: isPackageBooking ? (packagePurchase?.package_id || appliedPackage.id) : null,
        package_name: isPackageBooking ? (packagePurchase?.package_name || appliedPackage.name) : null,
        package_price_snapshot: isPackageBooking ? packageSnapshot.package_price : null,
        package_rides_count: isPackageBooking ? packageSnapshot.rides_count : null,
        package_price_per_ride: isPackageBooking ? packageSnapshot.price_per_ride : null,
        is_package_booking: isPackageBooking,
        package_purchase_id: packagePurchase?.id || null,
        idempotency_key: packagePurchase ? packageIdempotencyKey : null,
        payment_status: isPaid ? 'paid' : 'pending',
        payment_method: packagePurchase ? 'ride_package' : (walletPaymentRequested ? 'wallet' : payment_method),
        booking_status: 'confirmed',
        boarding_pass_code: boardingPassCode,
        boarding_pin: boardingPin,
        qr_token: qrToken,
        special_requests: special_requests || null,
        status: 'Active',
      }, { transaction: t });

      if (packagePurchase) {
        await reserveRides({
          purchase: packagePurchase,
          booking: bookingRecord,
          ridesCount: totalSeatsToBook,
          transaction: t,
        });
      }

      // ── Step I: Create ShuttleBooking Record ───────────────────────────
      let shuttleBookingRecord = null;
      try {
        shuttleBookingRecord = await ShuttleBooking.create({
          booking_id: bookingIdCode,
          user_id: passengerUser.id,
          passenger_name: resolvedPassengerName.trim(),
          passenger_mobile: String(resolvedPassengerMobile).trim(),
          schedule_id: schedule ? schedule.id : (candidateId || 1),
          route_id: routeId || 1,
          pickup_stop_id: actualPickupStopId,
          drop_stop_id: actualDropStopId,
          pickup_stop_name: pickupStopName,
          drop_stop_name: dropStopName,
          travel_date: travelDateStr,
          pickup_time: departureTime,
          drop_time: arrivalTime,
          fare: isPackageBooking ? packageSnapshot.price_per_ride : (totalFare / totalSeatsToBook),
          seat_count: totalSeatsToBook,
          total_amount: finalAmount,
          package_id: isPackageBooking ? (packagePurchase?.package_id || appliedPackage.id) : null,
          package_name: isPackageBooking ? (packagePurchase?.package_name || appliedPackage.name) : null,
          package_price_snapshot: isPackageBooking ? packageSnapshot.package_price : null,
          package_rides_count: isPackageBooking ? packageSnapshot.rides_count : null,
          package_price_per_ride: isPackageBooking ? packageSnapshot.price_per_ride : null,
          is_package_booking: isPackageBooking,
          status: 'confirmed',
          payment_status: isPaid ? 'paid' : 'pending',
          payment_method: packagePurchase ? 'ride_package' : (walletPaymentRequested ? 'wallet' : payment_method),
          qr_code: qrToken,
        }, { transaction: t });
      } catch (sbErr) {
        console.warn('Note: ShuttleBooking table record insertion skipped or table not available:', sbErr.message);
      }

      // ── Step J: Increment Trip / Schedule Booked Seats ─────────────────
      if (trip) {
        await trip.increment('booked_seats', { by: totalSeatsToBook, transaction: t });
      }
      if (schedule) {
        try {
          await schedule.increment('booked_seats', { by: totalSeatsToBook, transaction: t });
        } catch (_) {}
      }

      // ── Step K: Wallet Transaction Record ──────────────────────────────
      if (walletPaymentRequested && finalAmount > 0) {
        await WalletTransaction.create({
          passenger_id: passengerUser.id,
          type: 'debit',
          amount: finalAmount,
          balance_after: walletBalanceAfter,
          source: 'booking',
          reference_type: 'booking',
          reference_id: String(bookingRecord.id),
          description: isPackageBooking
            ? `Payment for Ride Pack "${appliedPackage.name}" (${bookingRef})`
            : `Shuttle payment for booking ${bookingRef}`,
        }, { transaction: t });

        await Payment.create({
          booking_id: bookingRecord.id,
          passenger_id: passengerUser.id,
          amount: finalAmount,
          payment_method: 'wallet',
          status: 'captured',
          transaction_id: `WT-${Date.now()}`,
        }, { transaction: t });
      }

      await t.commit();

      const bookingResponse = {
        id: bookingRecord.id,
        booking_id: shuttleBookingRecord?.booking_id || bookingRef,
        booking_reference: bookingRef,
        route_name: routeName,
        pickup_stop: pickupStopName,
        pickup_stop_name: pickupStopName,
        pickup_stop_id: actualPickupStopId,
        pickup_time: departureTime,
        drop_stop: dropStopName,
        drop_stop_name: dropStopName,
        drop_stop_id: actualDropStopId,
        drop_time: arrivalTime,
        travel_date: travelDateStr,
        passenger_name: passenger_name.trim(),
        passenger_mobile: String(passenger_mobile).trim(),
        seat_count: totalSeatsToBook,
        seat_numbers: requestedSeats.length > 0 ? requestedSeats : [1],
        total_fare: totalFare,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        payment_method: walletPaymentRequested ? 'wallet' : payment_method,
        payment_status: isPaid ? 'paid' : 'pending',
        booking_status: 'confirmed',
        boarding_pass_code: boardingPassCode,
        boarding_pin: boardingPin,
        qr_code: qrToken,
        is_package_booking: isPackageBooking,
        package_id: isPackageBooking ? packageSnapshot.package_id : null,
        package_name: isPackageBooking ? packageSnapshot.package_name : null,
        package_rides_count: isPackageBooking ? packageSnapshot.rides_count : null,
        package_price_per_ride: isPackageBooking ? packageSnapshot.price_per_ride : null,
        package: isPackageBooking ? packageSnapshot : null,
      };

      return res.status(200).json({
        status: 200,
        success: true,
        message: isPackageBooking
          ? `Booking confirmed with Ride Pack "${packageSnapshot.package_name}"! ${packageSnapshot.rides_count} rides activated.`
          : 'Shuttle booking confirmed successfully!',
        booking: bookingResponse,
        data: bookingResponse,
      });
    } catch (err) {
      if (!t.finished) await t.rollback();
      if (packageIdempotencyKey && err.name === 'SequelizeUniqueConstraintError') {
        try {
          const existingBooking = await Booking.findOne({
            where: { passenger_id: req.passenger?.id, idempotency_key: packageIdempotencyKey },
          });
          if (existingBooking) {
            return res.status(200).json({
              status: 200,
              success: true,
              message: 'Existing package booking returned for this idempotency_key',
              booking: existingBooking,
              data: existingBooking,
            });
          }
        } catch (lookupError) {
          return next(lookupError);
        }
      }
      next(err);
    }
  }

  /**
   * 8. POST /cancel-booking - Cancel Shuttle Booking & Restitute Seats
   */
  static async cancelBooking(req, res, next) {
    const t = await sequelize.transaction();
    try {
      const body = req.body || {};
      const { booking_id, booking_reference, id, cancellation_reason } = body;
      const lookupVal = booking_id || booking_reference || id || req.params?.id;

      if (!lookupVal) {
        await t.rollback();
        return res.status(400).json({
          status: 400,
          success: false,
          message: 'booking_id, booking_reference, or id is required for cancellation',
        });
      }

      let booking = null;
      if (Number.isInteger(Number(lookupVal)) && Number(lookupVal) > 0) {
        booking = await Booking.findByPk(Number(lookupVal), { transaction: t, lock: t.LOCK.UPDATE });
      }
      if (!booking) {
        booking = await Booking.findOne({
          where: {
            [Op.or]: [
              { booking_reference: String(lookupVal).trim() },
              { id: Number(lookupVal) || 0 },
            ],
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
      }

      if (!booking) {
        await t.rollback();
        return res.status(404).json({
          status: 404,
          success: false,
          message: 'Booking not found',
        });
      }

      if (booking.booking_status === 'cancelled') {
        await t.rollback();
        return res.status(409).json({
          status: 409,
          success: false,
          message: 'This booking has already been cancelled',
        });
      }

      if (booking.booking_status === 'completed') {
        await t.rollback();
        return res.status(409).json({
          status: 409,
          success: false,
          message: 'Completed bookings cannot be cancelled',
        });
      }

      if (booking.package_purchase_id
        && (!req.passenger || Number(req.passenger.id) !== Number(booking.passenger_id))) {
        await t.rollback();
        return res.status(403).json({ status: 403, success: false, message: 'Passenger authentication is required to cancel a package booking' });
      }

      // Restitute seats on Trip
      const seatsToRelease = booking.total_seats || 1;
      if (booking.trip_id) {
        const trip = await Trip.findByPk(booking.trip_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (trip && trip.booked_seats > 0) {
          await trip.decrement('booked_seats', {
            by: Math.min(trip.booked_seats, seatsToRelease),
            transaction: t,
          });
        }
      }

      // Update Booking status
      await booking.update({
        booking_status: 'cancelled',
        status: 'Cancelled',
        cancellation_reason: cancellation_reason || 'Cancelled by passenger',
        cancelled_at: new Date(),
      }, { transaction: t });
      await releaseBookingReservation({ bookingId: booking.id, transaction: t });

      // If ShuttleBooking exists, update it too
      try {
        await ShuttleBooking.update({
          status: 'cancelled',
        }, {
          where: {
            [Op.or]: [
              { booking_id: booking.booking_reference },
              { booking_id: String(lookupVal) },
            ],
          },
          transaction: t,
        });
      } catch (_) {}

      // Handle refund creation if payment was made
      let refund = null;
      if (booking.payment_status === 'paid' && Number(booking.final_amount) > 0) {
        refund = await Refund.create({
          booking_id: booking.id,
          passenger_id: booking.passenger_id,
          refund_reference: `REF-${Date.now()}`,
          refund_amount: booking.final_amount,
          refund_reason: cancellation_reason || 'Shuttle ride cancellation',
          status: 'pending',
        }, { transaction: t });
      }

      await t.commit();

      return res.status(200).json({
        status: 200,
        success: true,
        message: 'Shuttle booking cancelled successfully. Reserved seats released.',
        data: {
          booking_id: booking.id,
          booking_reference: booking.booking_reference,
          booking_status: 'cancelled',
          status: 'Cancelled',
          seats_released: seatsToRelease,
          refund_initiated: Boolean(refund),
          refund_reference: refund?.refund_reference || null,
        },
      });
    } catch (err) {
      if (!t.finished) await t.rollback();
      next(err);
    }
  }
}

module.exports = ShuttleController;
