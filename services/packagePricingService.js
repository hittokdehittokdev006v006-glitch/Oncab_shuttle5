'use strict';

const { Op } = require('sequelize');
const { RidePackage, RateChart, Route } = require('../models');
const { resolveFare } = require('../utils/fareCalculator');

/**
 * Service handling Ride Pack package retrieval, validation, and server-side pricing calculations.
 * Ensures package prices are strictly validated on the backend and client-submitted prices are never trusted.
 */
class PackagePricingService {
  /**
   * List available active Ride Pack packages
   * @param {Object} options
   * @param {number} [options.routeId] - Filter packages by route (or global packages where route_id is null)
   * @param {string} [options.status='Active']
   */
  static async listPackages({ routeId = null, status = 'Active', transaction } = {}) {
    const where = {};
    if (status && status.toLowerCase() !== 'all') {
      where.status = status;
    }

    if (routeId) {
      where[Op.or] = [
        { route_id: null },
        { route_id: Number(routeId) },
      ];
    }

    const packages = await RidePackage.findAll({
      where,
      order: [
        ['is_popular', 'DESC'],
        ['rides_count', 'ASC'],
        ['total_price', 'ASC'],
      ],
      transaction,
    });

    return packages.map((pkg) => {
      const data = pkg.toJSON();
      const perRide = Number(data.price_per_ride);
      const total = Number(data.total_price);
      const orig = data.original_price != null ? Number(data.original_price) : null;
      const savings = orig && orig > total ? orig - total : 0;
      const discountPct = orig && orig > total
        ? Math.round((savings / orig) * 100)
        : Number(data.discount_percentage || 0);

      return {
        ...data,
        price_per_ride: perRide,
        total_price: total,
        original_price: orig,
        savings_amount: savings,
        discount_percentage: discountPct,
        formatted_price: `₹${total}`,
        formatted_per_ride: `₹${perRide}/ride`,
        features: Array.isArray(data.features) ? data.features : (typeof data.features === 'string' ? JSON.parse(data.features || '[]') : []),
      };
    });
  }

  /**
   * Fetch single package by ID or package_code
   */
  static async getPackageByIdOrCode(idOrCode, { transaction } = {}) {
    if (!idOrCode) return null;

    let pkg = null;
    if (Number.isInteger(Number(idOrCode)) && Number(idOrCode) > 0) {
      pkg = await RidePackage.findByPk(Number(idOrCode), { transaction });
    }

    if (!pkg && typeof idOrCode === 'string') {
      pkg = await RidePackage.findOne({
        where: { package_code: idOrCode.trim() },
        transaction,
      });
    }

    return pkg;
  }

  /**
   * Calculate and validate package fare for shuttle booking.
   * Ensures package exists, is Active, route matches (if route-scoped), and calculates tamper-proof prices.
   *
   * @param {Object} params
   * @param {number|string} [params.packageId] - Package ID or Code
   * @param {number} [params.routeId] - Route ID of the shuttle
   * @param {number} [params.seatCount=1] - Number of passenger seats
   * @param {string} [params.travelDate] - Travel date (YYYY-MM-DD)
   * @param {number} [params.baseFare=0] - Single-ride stop pair fare
   * @param {Object} [params.transaction] - Sequelize transaction
   */
  static async calculateAndValidatePackageFare({
    packageId = null,
    packageCode = null,
    routeId = null,
    seatCount = 1,
    travelDate = null,
    baseFare = 0,
    transaction,
  }) {
    const candidateId = packageId || packageCode;
    if (!candidateId) {
      return {
        isValid: false,
        error: 'package_id or package_code is required for package booking',
        code: 'PACKAGE_ID_REQUIRED',
      };
    }

    const pkg = await this.getPackageByIdOrCode(candidateId, { transaction });
    if (!pkg) {
      return {
        isValid: false,
        error: 'The requested Ride Pack package does not exist',
        code: 'PACKAGE_NOT_FOUND',
      };
    }

    if ((pkg.status || '').toLowerCase() !== 'active') {
      return {
        isValid: false,
        error: `Package "${pkg.name}" is no longer active or available`,
        code: 'PACKAGE_INACTIVE',
      };
    }

    // If package is bound to a specific route, ensure route matches
    if (pkg.route_id && routeId && Number(pkg.route_id) !== Number(routeId)) {
      return {
        isValid: false,
        error: `Package "${pkg.name}" is not applicable to the selected route`,
        code: 'PACKAGE_ROUTE_MISMATCH',
      };
    }

    const seats = Math.max(1, parseInt(seatCount || 1, 10));
    // Maximum passenger limit check (default packages are designed for commuter passes up to 4 passengers)
    if (seats > 4) {
      return {
        isValid: false,
        error: 'Ride Pack packages support up to a maximum of 4 passengers per booking',
        code: 'PASSENGER_LIMIT_EXCEEDED',
      };
    }

    const pricePerRide = Number(pkg.price_per_ride);
    const packageFixedPrice = Number(pkg.total_price);
    const ridesCount = Number(pkg.rides_count);
    const validityDays = Number(pkg.validity_days);

    // Compute original standard fare comparison
    const singleFare = Number(baseFare) || 0;
    const computedOriginal = singleFare > 0 ? singleFare * ridesCount : null;
    const originalFare = pkg.original_price != null
      ? Number(pkg.original_price)
      : (computedOriginal || Math.round(packageFixedPrice * 1.3));

    const savingsAmount = Math.max(0, originalFare - packageFixedPrice);
    const savingsPercent = originalFare > 0
      ? Math.round((savingsAmount / originalFare) * 100)
      : Number(pkg.discount_percentage || 0);

    const priceSnapshot = {
      package_id: pkg.id,
      package_code: pkg.package_code,
      package_name: pkg.name,
      package_type: pkg.package_type,
      rides_count: ridesCount,
      validity_days: validityDays,
      price_per_ride: pricePerRide,
      package_price: packageFixedPrice,
      original_price: originalFare,
      savings_amount: savingsAmount,
      savings_percentage: savingsPercent,
      final_booking_amount: packageFixedPrice,
      currency: 'INR',
      features: Array.isArray(pkg.features) ? pkg.features : (typeof pkg.features === 'string' ? JSON.parse(pkg.features || '[]') : []),
    };

    return {
      isValid: true,
      package: pkg,
      priceSnapshot,
      finalBookingAmount: packageFixedPrice,
      pricePerRide,
      ridesCount,
      validityDays,
      packageName: pkg.name,
      packageId: pkg.id,
    };
  }

  /**
   * Calculate single ride fare using existing rate chart logic
   */
  static async calculateSingleRideFare({
    routeId,
    originStopId,
    destinationStopId,
    fallbackFare = 0,
    seatCount = 1,
    transaction,
  }) {
    const numSeats = Math.max(1, parseInt(seatCount || 1, 10));
    const fareRes = await resolveFare({
      routeId,
      originStopId,
      destinationStopId,
      fallbackFare,
      transaction,
    });

    const unitFare = Number(fareRes.fare || 0);
    const totalFare = unitFare * numSeats;

    return {
      unitFare,
      numSeats,
      totalFare,
      fareSource: fareRes.source || 'rate_chart',
    };
  }
}

module.exports = PackagePricingService;
