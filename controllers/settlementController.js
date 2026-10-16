'use strict';

const { Op } = require('sequelize');
const { OwnerSettlement, AdminUser, Vehicle, OwnerKyc, SystemSetting, Trip, Driver, BusType } = require('../models');
const { logAction } = require('../middleware/auditLog');
const { hasRole } = require('../utils/roles');

// Helper to fetch current configured TDS percentage
const getTdsPercentage = async () => {
  try {
    const setting = await SystemSetting.findOne({ where: { key: 'owner_settlement_tds_percentage' } });
    if (setting && setting.value !== null && setting.value !== undefined && setting.value !== '') {
      const val = parseFloat(setting.value);
      return Number.isFinite(val) && val >= 0 ? val : 2.00;
    }
    return 2.00;
  } catch {
    return 2.00;
  }
};

// Helper to fetch current configured bus type trip rates
const getTripRatesByBusType = async () => {
  try {
    const setting = await SystemSetting.findOne({ where: { key: 'owner_trip_rates_by_bus_type' } });
    if (setting && setting.value !== null && setting.value !== undefined && setting.value !== '') {
      if (typeof setting.value === 'object' && setting.value !== null) return setting.value;
      const parsed = JSON.parse(setting.value);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    }
  } catch {}
  return { bus: 3000, traveller: 1900 };
};

// Helper to resolve trip rate based on bus type name and configured rates
const resolveTripRate = (busTypeName, tripRates = {}) => {
  const rates = { bus: 3000, traveller: 1900, ...tripRates };
  if (!busTypeName) return Number(rates.bus) || 3000;
  const norm = String(busTypeName).toLowerCase().trim();
  for (const [k, rate] of Object.entries(rates)) {
    const keyLower = String(k).toLowerCase().trim();
    if (norm.includes(keyLower) || keyLower.includes(norm)) {
      const val = parseFloat(rate);
      return Number.isFinite(val) ? val : 3000;
    }
  }
  return Number(rates.bus) || 3000;
};

// ── 1. List Settlements ─────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const isAdmin = hasRole(req.user, 'admin');
    const { status, search, page = 1, limit = 50, startDate, endDate } = req.query;

    const where = {};

    // Non-admin owners can strictly view only their own settlements
    if (!isAdmin) {
      where.owner_id = req.user.id;
    }

    if (status && status !== 'all') {
      where.status = status;
    }

    if (startDate && endDate) {
      where.created_at = {
        [Op.between]: [new Date(`${startDate} 00:00:00`), new Date(`${endDate} 23:59:59`)],
      };
    } else if (startDate) {
      where.created_at = { [Op.gte]: new Date(`${startDate} 00:00:00`) };
    } else if (endDate) {
      where.created_at = { [Op.lte]: new Date(`${endDate} 23:59:59`) };
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      where[Op.or] = [
        { settlement_code: { [Op.like]: q } },
        { owner_name: { [Op.like]: q } },
        { vehicle_number: { [Op.like]: q } },
        { account_number: { [Op.like]: q } },
        { bank_name: { [Op.like]: q } },
        { ifsc_code: { [Op.like]: q } },
        { utr_number: { [Op.like]: q } },
      ];
    }

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const { rows: settlements, count: totalCount } = await OwnerSettlement.findAndCountAll({
      where,
      include: [
        { model: AdminUser, as: 'processor', attributes: ['id', 'name', 'email'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model'] },
      ],
      order: [['id', 'DESC']],
      offset,
      limit: pageLimit,
    });

    // Compute comprehensive statistics
    const statsWhere = !isAdmin ? { owner_id: req.user.id } : {};
    const allRecords = await OwnerSettlement.findAll({
      where: statsWhere,
      attributes: ['status', 'requested_amount', 'tds_amount', 'net_payable_amount'],
    });

    let totalRequested = 0;
    let totalTds = 0;
    let totalNetPayable = 0;
    let pendingCount = 0;
    let pendingAmount = 0;
    let approvedCount = 0;
    let approvedAmount = 0;
    let rejectedCount = 0;
    let rejectedAmount = 0;

    allRecords.forEach((r) => {
      const reqAmt = parseFloat(r.requested_amount) || 0;
      const tdsAmt = parseFloat(r.tds_amount) || 0;
      const netAmt = parseFloat(r.net_payable_amount) || 0;

      totalRequested += reqAmt;
      totalTds += tdsAmt;
      totalNetPayable += netAmt;

      if (r.status === 'pending') {
        pendingCount += 1;
        pendingAmount += netAmt;
      } else if (r.status === 'approved') {
        approvedCount += 1;
        approvedAmount += netAmt;
      } else if (r.status === 'rejected') {
        rejectedCount += 1;
        rejectedAmount += netAmt;
      }
    });

    const currentTds = await getTdsPercentage();

    res.json({
      success: true,
      data: settlements,
      pagination: {
        page: parseInt(page, 10),
        limit: pageLimit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageLimit),
      },
      stats: {
        total_requested: Number(totalRequested.toFixed(2)),
        total_tds: Number(totalTds.toFixed(2)),
        total_net_payable: Number(totalNetPayable.toFixed(2)),
        pending_count: pendingCount,
        pending_amount: Number(pendingAmount.toFixed(2)),
        approved_count: approvedCount,
        approved_amount: Number(approvedAmount.toFixed(2)),
        rejected_count: rejectedCount,
        rejected_amount: Number(rejectedAmount.toFixed(2)),
      },
      current_tds_percentage: currentTds,
    });
  } catch (err) {
    next(err);
  }
};

// ── 2. Get Owner Settlement Config & Context ────────────────
exports.getConfig = async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const tdsPercentage = await getTdsPercentage();
    const tripRates = await getTripRatesByBusType();

    // Fetch latest KYC record for owner
    const kyc = await OwnerKyc.findOne({
      where: { owner_id: ownerId },
      order: [['id', 'DESC']],
    });

    // Fetch vehicles assigned to owner
    const vehicles = await Vehicle.findAll({
      where: { owner_id: ownerId },
      include: [{ model: BusType, as: 'bus_type', attributes: ['id', 'name', 'code'] }],
      attributes: ['id', 'registration_number', 'company_model', 'status', 'bus_type_id'],
      order: [['id', 'ASC']],
    });

    res.json({
      success: true,
      data: {
        tds_percentage: tdsPercentage,
        trip_rates: tripRates,
        kyc: kyc ? {
          account_number: kyc.account_number,
          bank_name: kyc.bank_name,
          ifsc_code: kyc.ifsc_code,
          account_holder_name: kyc.account_holder_name || kyc.owner_name,
          upi_id: kyc.upi_id,
          status: kyc.status,
        } : null,
        vehicles: vehicles.map((v) => ({
          id: v.id,
          registration_number: v.registration_number,
          company_model: v.company_model || 'Bus',
          bus_type_name: v.bus_type?.name || 'Bus',
          status: v.status,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 2b. Get Configured Trip Rates by Bus Type ────────────────
exports.getTripRates = async (req, res, next) => {
  try {
    const tripRates = await getTripRatesByBusType();
    const tdsPercentage = await getTdsPercentage();
    res.json({ success: true, data: { trip_rates: tripRates, tds_percentage: tdsPercentage } });
  } catch (err) {
    next(err);
  }
};

// ── 2c. Get Previous Week Trips and Settlement Summary ──────
exports.getPreviousWeekSummary = async (req, res, next) => {
  try {
    const isAdmin = hasRole(req.user, 'admin');
    const targetOwnerId = isAdmin && req.query.owner_id ? Number(req.query.owner_id) : req.user.id;

    // Determine previous calendar week (Monday to Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
    const daysToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;

    const prevSunday = new Date(now);
    prevSunday.setDate(now.getDate() - daysToLastSunday);
    prevSunday.setHours(23, 59, 59, 999);

    const prevMonday = new Date(prevSunday);
    prevMonday.setDate(prevSunday.getDate() - 6);
    prevMonday.setHours(0, 0, 0, 0);

    const startDateStr = prevMonday.toISOString().split('T')[0];
    const endDateStr = prevSunday.toISOString().split('T')[0];

    const dateOptions = { day: '2-digit', month: 'short', year: 'numeric' };
    const formattedPeriod = `${prevMonday.toLocaleDateString('en-IN', dateOptions)} – ${prevSunday.toLocaleDateString('en-IN', dateOptions)}`;

    const tripRates = await getTripRatesByBusType();
    const tdsPercentage = await getTdsPercentage();

    // Fetch owner's vehicles, drivers, and KYC
    const [vehicles, drivers, kyc] = await Promise.all([
      Vehicle.findAll({
        where: { owner_id: targetOwnerId },
        include: [{ model: BusType, as: 'bus_type', attributes: ['id', 'name', 'code', 'total_seats'] }],
      }),
      Driver.findAll({
        where: { owner_id: targetOwnerId },
        attributes: ['id', 'name'],
      }),
      OwnerKyc.findOne({
        where: { owner_id: targetOwnerId },
        order: [['id', 'DESC']],
      }),
    ]);

    const vehicleIds = vehicles.map((v) => v.id);
    const driverIds = drivers.map((d) => d.id);

    let completedTrips = [];
    if (vehicleIds.length || driverIds.length) {
      completedTrips = await Trip.findAll({
        where: {
          trip_date: { [Op.between]: [startDateStr, endDateStr] },
          status: 'Completed',
          [Op.or]: [
            ...(vehicleIds.length ? [{ vehicle_id: { [Op.in]: vehicleIds } }] : []),
            ...(driverIds.length ? [{ driver_id: { [Op.in]: driverIds } }] : []),
          ],
        },
        include: [
          {
            model: Vehicle,
            as: 'vehicle',
            attributes: ['id', 'registration_number', 'company_model', 'bus_type_id'],
            include: [{ model: BusType, as: 'bus_type', attributes: ['id', 'name', 'code'] }],
          },
          { model: BusType, as: 'bus_type', attributes: ['id', 'name', 'code'] },
          { model: Driver, as: 'driver', attributes: ['id', 'name'] },
        ],
        order: [['trip_date', 'ASC'], ['departure_time', 'ASC']],
      });
    }

    const busTypeBreakdown = {};
    let totalEarnedAmount = 0;

    const tripsWithAmounts = completedTrips.map((trip) => {
      const busTypeName = trip.bus_type?.name || trip.vehicle?.bus_type?.name || 'Bus';
      const rate = resolveTripRate(busTypeName, tripRates);
      totalEarnedAmount += rate;

      const groupKey = busTypeName.toLowerCase().includes('traveller') ? 'traveller' : 'bus';
      if (!busTypeBreakdown[groupKey]) {
        busTypeBreakdown[groupKey] = {
          key: groupKey,
          label: groupKey === 'traveller' ? 'Traveller' : 'Bus',
          count: 0,
          rate_per_trip: rate,
          total_amount: 0,
        };
      }
      busTypeBreakdown[groupKey].count += 1;
      busTypeBreakdown[groupKey].total_amount += rate;

      return {
        id: trip.id,
        schedule_code: trip.schedule_code,
        trip_date: trip.trip_date,
        departure_time: trip.departure_time,
        vehicle_id: trip.vehicle_id,
        vehicle_number: trip.vehicle?.registration_number || '—',
        bus_type_name: busTypeName,
        driver_name: trip.driver?.name || '—',
        trip_rate: rate,
        amount: rate,
      };
    });

    const tdsAmount = Number(((totalEarnedAmount * tdsPercentage) / 100).toFixed(2));
    const netPayableAmount = Number((totalEarnedAmount - tdsAmount).toFixed(2));

    // Check if settlement request for this previous week already exists
    const periodTag = `Week (${startDateStr} to ${endDateStr})`;
    const existingSettlement = await OwnerSettlement.findOne({
      where: {
        owner_id: targetOwnerId,
        owner_notes: { [Op.like]: `%${startDateStr} to ${endDateStr}%` },
      },
      order: [['id', 'DESC']],
    });

    const canRequest = completedTrips.length > 0 && (!existingSettlement || existingSettlement.status === 'rejected');

    res.json({
      success: true,
      data: {
        period: {
          start_date: startDateStr,
          end_date: endDateStr,
          formatted: formattedPeriod,
          tag: periodTag,
        },
        rates: tripRates,
        tds_percentage: tdsPercentage,
        total_completed_trips: completedTrips.length,
        bus_type_breakdown: Object.values(busTypeBreakdown),
        total_earned_amount: totalEarnedAmount,
        tds_amount: tdsAmount,
        net_payable_amount: netPayableAmount,
        trips: tripsWithAmounts,
        existing_settlement: existingSettlement,
        can_request: canRequest,
        kyc: kyc ? {
          account_number: kyc.account_number,
          bank_name: kyc.bank_name,
          ifsc_code: kyc.ifsc_code,
          account_holder_name: kyc.account_holder_name || kyc.owner_name,
          upi_id: kyc.upi_id,
          status: kyc.status,
        } : null,
        default_vehicle: vehicles[0] ? {
          id: vehicles[0].id,
          vehicle_number: vehicles[0].registration_number,
          model: vehicles[0].company_model,
        } : null,
        vehicles: vehicles.map((v) => ({
          id: v.id,
          vehicle_number: v.registration_number,
          model: v.company_model || 'Bus',
          bus_type_name: v.bus_type?.name || 'Bus',
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 3. Create Settlement Request ────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const {
      vehicle_id,
      vehicle_number,
      requested_amount,
      account_number,
      bank_name,
      ifsc_code,
      account_holder_name,
      upi_id,
      owner_notes,
    } = req.body;

    // Validate requested amount
    const parsedAmount = parseFloat(requested_amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Requested amount must be a valid positive number' });
    }

    // Resolve vehicle
    let resolvedVehicleNumber = (vehicle_number || '').trim().toUpperCase();
    let resolvedVehicleId = vehicle_id ? Number(vehicle_id) : null;

    if (resolvedVehicleId && !resolvedVehicleNumber) {
      const v = await Vehicle.findByPk(resolvedVehicleId);
      if (v) resolvedVehicleNumber = v.registration_number;
    }

    if (!resolvedVehicleNumber) {
      return res.status(400).json({ success: false, message: 'Vehicle number or selection is required' });
    }

    // Resolve bank details (from request body or fallback to OwnerKyc)
    let resolvedAccount = (account_number || '').trim();
    let resolvedBank = (bank_name || '').trim();
    let resolvedIfsc = (ifsc_code || '').trim().toUpperCase();
    let resolvedHolder = (account_holder_name || '').trim() || req.user.name;
    let resolvedUpi = (upi_id || '').trim();

    if (!resolvedAccount || !resolvedBank || !resolvedIfsc) {
      const kyc = await OwnerKyc.findOne({ where: { owner_id: ownerId }, order: [['id', 'DESC']] });
      if (kyc) {
        resolvedAccount = resolvedAccount || kyc.account_number;
        resolvedBank = resolvedBank || kyc.bank_name;
        resolvedIfsc = resolvedIfsc || kyc.ifsc_code;
        resolvedHolder = resolvedHolder || kyc.account_holder_name || kyc.owner_name;
        resolvedUpi = resolvedUpi || kyc.upi_id;
      }
    }

    if (!resolvedAccount || !resolvedBank || !resolvedIfsc) {
      return res.status(400).json({
        success: false,
        message: 'Bank account number, bank name, and IFSC code are required. Please submit your bank details in Owner KYC or fill them in the form.',
      });
    }

    // Retrieve current TDS percentage from Admin Settings
    const tdsPercentage = await getTdsPercentage();

    // Calculate TDS and Net Payable Amount
    const tdsAmount = Number(((parsedAmount * tdsPercentage) / 100).toFixed(2));
    const netPayableAmount = Number((parsedAmount - tdsAmount).toFixed(2));

    // Generate unique settlement code
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const settlementCode = `STL-${dateStr}-${randomSuffix}`;

    const settlement = await OwnerSettlement.create({
      settlement_code: settlementCode,
      owner_id: ownerId,
      owner_name: req.user.name || 'Owner',
      owner_mobile: req.user.phone || null,
      owner_email: req.user.email || null,
      vehicle_id: resolvedVehicleId,
      vehicle_number: resolvedVehicleNumber,
      requested_amount: parsedAmount,
      tds_percentage: tdsPercentage,
      tds_amount: tdsAmount,
      net_payable_amount: netPayableAmount,
      account_number: resolvedAccount,
      bank_name: resolvedBank,
      ifsc_code: resolvedIfsc,
      account_holder_name: resolvedHolder,
      upi_id: resolvedUpi || null,
      owner_notes: owner_notes || null,
      status: 'pending',
    });

    await logAction({
      userId: req.user.id,
      userType: req.user.role?.name || 'owner',
      userName: req.user.name,
      action: 'create',
      module: 'settlements',
      entityType: 'OwnerSettlement',
      entityId: settlement.id,
      newValues: {
        settlement_code: settlementCode,
        requested_amount: parsedAmount,
        tds_percentage: tdsPercentage,
        net_payable_amount: netPayableAmount,
        vehicle_number: resolvedVehicleNumber,
      },
      ipAddress: req.ip,
      description: `Owner requested settlement of ₹${parsedAmount} (Net payable: ₹${netPayableAmount} after ${tdsPercentage}% TDS)`,
    });

    res.status(201).json({
      success: true,
      message: 'Settlement request submitted successfully',
      data: settlement,
    });
  } catch (err) {
    next(err);
  }
};

// ── 4. Get Settlement By ID ────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const isAdmin = hasRole(req.user, 'admin');
    const settlement = await OwnerSettlement.findByPk(req.params.id, {
      include: [
        { model: AdminUser, as: 'owner', attributes: ['id', 'name', 'email', 'phone'] },
        { model: AdminUser, as: 'processor', attributes: ['id', 'name', 'email'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model'] },
      ],
    });

    if (!settlement) {
      return res.status(404).json({ success: false, message: 'Settlement request not found' });
    }

    if (!isAdmin && settlement.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied to this settlement request' });
    }

    res.json({ success: true, data: settlement });
  } catch (err) {
    next(err);
  }
};

// ── 5. Update Status (Approve / Reject) ──────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    if (!hasRole(req.user, 'admin')) {
      return res.status(403).json({ success: false, message: 'Only administrators can approve or reject settlement requests' });
    }

    const { status, utr_number, admin_note } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be 'approved', 'rejected', or 'pending'" });
    }

    const settlement = await OwnerSettlement.findByPk(req.params.id);
    if (!settlement) {
      return res.status(404).json({ success: false, message: 'Settlement request not found' });
    }

    const previousStatus = settlement.status;

    await settlement.update({
      status,
      utr_number: utr_number !== undefined ? (utr_number || null) : settlement.utr_number,
      admin_note: admin_note !== undefined ? (admin_note || null) : settlement.admin_note,
      processed_by: req.user.id,
      processed_at: new Date(),
    });

    await logAction({
      userId: req.user.id,
      userType: req.user.role?.name || 'admin',
      userName: req.user.name,
      action: 'update',
      module: 'settlements',
      entityType: 'OwnerSettlement',
      entityId: settlement.id,
      oldValues: { status: previousStatus },
      newValues: { status, utr_number: settlement.utr_number, admin_note: settlement.admin_note },
      ipAddress: req.ip,
      description: `Admin changed settlement status to ${status.toUpperCase()} (UTR: ${settlement.utr_number || 'N/A'})`,
    });

    res.json({
      success: true,
      message: `Settlement request ${status} successfully`,
      data: settlement,
    });
  } catch (err) {
    next(err);
  }
};

// ── 6. Delete Settlement Request (Permanent Removal) ─────────
exports.delete = async (req, res, next) => {
  try {
    if (!hasRole(req.user, 'admin')) {
      return res.status(403).json({ success: false, message: 'Only administrators can delete settlement requests' });
    }

    const settlement = await OwnerSettlement.findByPk(req.params.id);
    if (!settlement) {
      return res.status(404).json({ success: false, message: 'Settlement request not found' });
    }

    const code = settlement.settlement_code;
    const ownerName = settlement.owner_name;
    const netAmount = settlement.net_payable_amount;

    // Permanently remove the record from the database so it disappears from both panels
    await settlement.destroy();

    await logAction({
      userId: req.user.id,
      userType: req.user.role?.name || 'admin',
      userName: req.user.name,
      action: 'delete',
      module: 'settlements',
      entityType: 'OwnerSettlement',
      entityId: req.params.id,
      oldValues: { settlement_code: code, owner_name: ownerName, net_payable_amount: netAmount },
      ipAddress: req.ip,
      description: `Admin permanently deleted settlement request ${code} for ${ownerName}`,
    });

    res.json({
      success: true,
      message: `Settlement request ${code} permanently deleted from both owner and admin panels`,
    });
  } catch (err) {
    next(err);
  }
};
