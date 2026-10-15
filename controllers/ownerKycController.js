'use strict';

const { Op } = require('sequelize');
const { OwnerKyc, AdminUser, CustomerUser, Vehicle, Role } = require('../models');
const { logAction } = require('../middleware/auditLog');
const { hasRole } = require('../utils/roles');

// ── Validation Helpers ─────────────────────────────────────
const validateAadhaar = (aadhaar) => {
  const cleaned = String(aadhaar || '').replace(/\D/g, '');
  return cleaned.length === 12 ? cleaned : null;
};

const validatePan = (pan) => {
  const cleaned = String(pan || '').trim().toUpperCase();
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  return panRegex.test(cleaned) ? cleaned : null;
};

const validateIfsc = (ifsc) => {
  const cleaned = String(ifsc || '').trim().toUpperCase();
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  return ifscRegex.test(cleaned) ? cleaned : null;
};

const validateAccountNumber = (acc) => {
  const cleaned = String(acc || '').trim().replace(/\s/g, '');
  const accRegex = /^\d{9,18}$/;
  return accRegex.test(cleaned) ? cleaned : null;
};

const validateUpi = (upi) => {
  if (!upi || !String(upi).trim()) return null;
  const cleaned = String(upi).trim();
  const upiRegex = /^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/;
  return upiRegex.test(cleaned) ? cleaned : false;
};

// ── 1. Get Owner Profile & Vehicles ────────────────────────
exports.getProfile = async (req, res, next) => {
  try {
    const ownerId = Number(req.user.id);

    // 1. Fetch Owner from AdminUser
    const ownerUser = await AdminUser.findByPk(ownerId, {
      attributes: ['id', 'name', 'email', 'phone', 'is_active'],
      include: [{ model: Role, as: 'role', attributes: ['name', 'display_name'] }],
    });

    if (!ownerUser) {
      return res.status(404).json({ success: false, message: 'Owner user not found' });
    }

    const ownerMobile = ownerUser.phone || '';
    const ownerEmail = ownerUser.email || '';

    // 2. Fetch corresponding customer user profile from 'users' table if exists
    let customerUser = null;
    try {
      const orConditions = [];
      if (ownerEmail) orConditions.push({ email: ownerEmail });
      if (ownerMobile) orConditions.push({ mobile: ownerMobile });
      if (orConditions.length) {
        customerUser = await CustomerUser.findOne({
          where: { [Op.or]: orConditions },
          attributes: ['id', 'name', 'email', 'mobile', 'aadhar', 'pan', 'address'],
        });
      }
    } catch (err) {
      console.warn('[ownerKycController.getProfile] Note: CustomerUser query skipped:', err.message);
    }

    // 3. Fetch Vehicles owned by this owner
    const vehicles = await Vehicle.findAll({
      where: { owner_id: ownerId },
      attributes: ['id', 'registration_number', 'company_model', 'status', 'total_seats'],
      order: [['id', 'ASC']],
    });

    // 4. Fetch existing KYC submission if any
    const existingKyc = await OwnerKyc.findOne({
      where: { owner_id: ownerId },
      order: [['id', 'DESC']],
    });

    const resolvedMobile = ownerMobile || customerUser?.mobile || '';
    const resolvedName = ownerUser.name || customerUser?.name || '';
    const resolvedEmail = ownerEmail || customerUser?.email || '';

    res.json({
      success: true,
      data: {
        owner: {
          id: ownerUser.id,
          name: resolvedName,
          email: resolvedEmail,
          mobile: resolvedMobile,
          phone: resolvedMobile,
          role: ownerUser.role?.name || 'owner',
        },
        vehicles: vehicles.map((v) => ({
          id: v.id,
          registration_number: v.registration_number,
          company_model: v.company_model || 'Standard Bus',
          status: v.status,
          total_seats: v.total_seats,
        })),
        existing_kyc: existingKyc || null,
        user_table_data: customerUser ? {
          aadhar: customerUser.aadhar || null,
          pan: customerUser.pan || null,
          address: customerUser.address || null,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── 2. Submit KYC & Bank Details ───────────────────────────
exports.submitKyc = async (req, res, next) => {
  try {
    const ownerId = Number(req.user.id);
    const {
      vehicle_id,
      aadhaar_number,
      pan_number,
      bank_name,
      account_holder_name,
      account_number,
      confirm_account_number,
      ifsc_code,
      upi_id,
    } = req.body || {};

    const errors = {};

    // Validate Aadhaar
    const cleanAadhaar = validateAadhaar(aadhaar_number);
    if (!cleanAadhaar) {
      errors.aadhaar_number = 'Aadhaar number must be exactly 12 digits';
    }

    // Validate PAN
    const cleanPan = validatePan(pan_number);
    if (!cleanPan) {
      errors.pan_number = 'PAN number must be 10 characters (e.g. ABCDE1234F)';
    }

    // Validate Bank Name
    const cleanBankName = String(bank_name || '').trim();
    if (!cleanBankName || cleanBankName.length < 2) {
      errors.bank_name = 'Bank name is required';
    }

    // Validate Account Holder Name
    const cleanHolderName = String(account_holder_name || req.user.name || '').trim();
    if (!cleanHolderName || cleanHolderName.length < 2) {
      errors.account_holder_name = 'Account holder name is required';
    }

    // Validate Account Number
    const cleanAccNum = validateAccountNumber(account_number);
    if (!cleanAccNum) {
      errors.account_number = 'Bank account number must be between 9 and 18 digits';
    }

    // Confirm Account Number match check
    if (confirm_account_number !== undefined && confirm_account_number !== null) {
      const cleanConfirm = String(confirm_account_number).trim().replace(/\s/g, '');
      if (cleanConfirm !== cleanAccNum) {
        errors.confirm_account_number = 'Account numbers do not match';
      }
    }

    // Validate IFSC
    const cleanIfsc = validateIfsc(ifsc_code);
    if (!cleanIfsc) {
      errors.ifsc_code = 'Valid 11-character IFSC code is required (e.g. SBIN0001234)';
    }

    // Validate UPI ID (optional)
    let cleanUpi = null;
    if (upi_id && String(upi_id).trim()) {
      const upiValidation = validateUpi(upi_id);
      if (upiValidation === false) {
        errors.upi_id = 'Invalid UPI ID format (e.g. username@bank)';
      } else {
        cleanUpi = String(upi_id).trim();
      }
    }

    // Vehicle validation if selected
    let selectedVehicleId = null;
    let selectedVehicleNumber = null;
    if (vehicle_id) {
      const veh = await Vehicle.findOne({
        where: { id: Number(vehicle_id), owner_id: ownerId },
      });
      if (veh) {
        selectedVehicleId = veh.id;
        selectedVehicleNumber = veh.registration_number;
      }
    } else {
      // If owner has exactly 1 vehicle, auto-assign
      const ownerVehicles = await Vehicle.findAll({ where: { owner_id: ownerId } });
      if (ownerVehicles.length === 1) {
        selectedVehicleId = ownerVehicles[0].id;
        selectedVehicleNumber = ownerVehicles[0].registration_number;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed. Please correct the highlighted errors.',
        errors,
      });
    }

    const ownerName = req.user.name || cleanHolderName;
    const ownerEmail = req.user.email || '';
    const ownerMobile = req.user.phone || '';

    // Check if existing KYC record exists
    let kycRecord = await OwnerKyc.findOne({
      where: { owner_id: ownerId },
      order: [['id', 'DESC']],
    });

    const isUpdate = Boolean(kycRecord);

    const kycPayload = {
      owner_id: ownerId,
      owner_name: ownerName,
      owner_email: ownerEmail,
      owner_mobile: ownerMobile,
      vehicle_id: selectedVehicleId,
      vehicle_number: selectedVehicleNumber,
      aadhaar_number: cleanAadhaar,
      pan_number: cleanPan,
      bank_name: cleanBankName,
      account_holder_name: cleanHolderName,
      account_number: cleanAccNum,
      ifsc_code: cleanIfsc,
      upi_id: cleanUpi,
      status: 'pending', // Re-evaluate whenever updated
      admin_note: null,
      verified_by: null,
      verified_at: null,
    };

    if (isUpdate) {
      await kycRecord.update(kycPayload);
    } else {
      kycRecord = await OwnerKyc.create(kycPayload);
    }

    // Sync Aadhaar and PAN back to 'users' table if matching profile exists
    try {
      const orConditions = [];
      if (ownerEmail) orConditions.push({ email: ownerEmail });
      if (ownerMobile) orConditions.push({ mobile: ownerMobile });
      if (orConditions.length) {
        await CustomerUser.update(
          { aadhar: cleanAadhaar, pan: cleanPan },
          { where: { [Op.or]: orConditions } }
        );
      }
    } catch (userSyncErr) {
      console.warn('[ownerKycController.submitKyc] User sync notice:', userSyncErr.message);
    }

    // Log action to audit logs
    await logAction({
      userId: req.user.id,
      userType: req.user.role?.name || 'owner',
      userName: req.user.name,
      action: isUpdate ? 'update' : 'create',
      module: 'owner_kyc',
      entityType: 'OwnerKyc',
      entityId: kycRecord.id,
      newValues: {
        pan: cleanPan,
        bank_name: cleanBankName,
        account_last4: cleanAccNum.slice(-4),
        ifsc_code: cleanIfsc,
        vehicle_number: selectedVehicleNumber,
      },
      ipAddress: req.ip,
      description: `Owner ${ownerName} submitted KYC and bank details for verification`,
    });

    res.json({
      success: true,
      message: 'KYC & Bank details saved and submitted for verification successfully!',
      data: kycRecord,
    });
  } catch (err) {
    next(err);
  }
};

// ── 3. Get Logged-in Owner's Current KYC ───────────────────
exports.getMine = async (req, res, next) => {
  try {
    const ownerId = Number(req.user.id);
    const kyc = await OwnerKyc.findOne({
      where: { owner_id: ownerId },
      order: [['id', 'DESC']],
      include: [{ model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model'] }],
    });

    res.json({
      success: true,
      data: kyc,
    });
  } catch (err) {
    next(err);
  }
};

// ── 4. Admin: List All Owner KYCs ──────────────────────────
exports.listAll = async (req, res, next) => {
  try {
    if (!hasRole(req.user, 'admin')) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { status, search, page = 1, limit = 25 } = req.query;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (p - 1) * l;

    const where = {};
    if (status && ['pending', 'verified', 'rejected'].includes(status)) {
      where.status = status;
    }

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { owner_name: { [Op.like]: term } },
        { owner_email: { [Op.like]: term } },
        { owner_mobile: { [Op.like]: term } },
        { pan_number: { [Op.like]: term } },
        { vehicle_number: { [Op.like]: term } },
        { bank_name: { [Op.like]: term } },
      ];
    }

    const { count, rows } = await OwnerKyc.findAndCountAll({
      where,
      limit: l,
      offset,
      order: [['id', 'DESC']],
      include: [
        { model: AdminUser, as: 'owner', attributes: ['id', 'name', 'email', 'phone'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'registration_number', 'company_model'] },
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

// ── 5. Admin: Update KYC Status (Verify / Reject) ──────────
exports.updateStatus = async (req, res, next) => {
  try {
    if (!hasRole(req.user, 'admin')) {
      return res.status(403).json({ success: false, message: 'Only admins can review KYC submissions' });
    }

    const { id } = req.params;
    const { status, admin_note } = req.body || {};

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be verified or rejected' });
    }

    const kyc = await OwnerKyc.findByPk(id);
    if (!kyc) {
      return res.status(404).json({ success: false, message: 'Owner KYC record not found' });
    }

    await kyc.update({
      status,
      admin_note: admin_note || null,
      verified_by: req.user.id,
      verified_at: new Date(),
    });

    await logAction({
      userId: req.user.id,
      userType: req.user.role?.name || 'admin',
      userName: req.user.name,
      action: status === 'verified' ? 'approve' : 'reject',
      module: 'owner_kyc',
      entityType: 'OwnerKyc',
      entityId: kyc.id,
      newValues: { status, admin_note },
      ipAddress: req.ip,
      description: `Admin ${req.user.name} marked Owner KYC #${kyc.id} (${kyc.owner_name}) as ${status}`,
    });

    res.json({
      success: true,
      message: `KYC submission marked as ${status} successfully`,
      data: kyc,
    });
  } catch (err) {
    next(err);
  }
};
