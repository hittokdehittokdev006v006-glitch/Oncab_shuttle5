'use strict';

const { Op } = require('sequelize');
const { sequelize, Driver, DriverDetail, Vehicle, OwnerApprovalRequest, AdminUser } = require('../models');
const { logAction } = require('../middleware/auditLog');
const { hasRole } = require('../utils/roles');
const {
    saveBase64File,
    deleteFile,
    deleteFolder,
    getImageUrl,
} = require('../utils/fileUpload');

const buildPagination = (page, limit) => {
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit) || 15));
    return { offset: (p - 1) * l, limit: l, page: p };
};

const isOwnerRole = (req) => hasRole(req.user, 'owner');

const forceOwnerScope = (req, where = {}) => {
    if (!isOwnerRole(req)) return where;
    return { ...where, owner_id: req.user.id };
};

// ── List Drivers ───────────────────────────────────────────
exports.list = async (req, res, next) => {
    try {
        const { page, limit, search, status, online_status, block_status, owner_id, is_bus_driver, complete_status } = req.query;
        const { offset, limit: lim, page: p } = buildPagination(page, limit);
        const where = {};

        if (search) {
            where[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { mobile: { [Op.like]: `%${search}%` } },
                { driver_user_id: { [Op.like]: `%${search}%` } },
            ];
        }
        if (status) where.status = status;
        if (online_status) where.online_status = online_status;
        if (block_status) where.block_status = block_status;
        if (owner_id && !isOwnerRole(req)) where.owner_id = owner_id;
        if (is_bus_driver !== undefined && is_bus_driver !== '') {
            where.is_bus_driver = is_bus_driver === 'true' || is_bus_driver === true || is_bus_driver === '1';
        }
        if (complete_status) where.complete_status = complete_status;

        const ownerScopedWhere = forceOwnerScope(req, where);

        const { count, rows } = await Driver.findAndCountAll({
            where: ownerScopedWhere,
            include: [
                { model: DriverDetail, as: 'details' },
                {
                    model: AdminUser,
                    as: 'owner',
                    attributes: ['id', 'name', 'email', 'phone'],
                    required: false,
                },
                {
                    model: Vehicle,
                    as: 'vehicles',
                    ...(isOwnerRole(req) ? { where: { owner_id: req.user.id }, required: false } : {}),
                },
            ],
            offset,
            limit: lim,
            order: [['created_at', 'DESC']],
        });

        const data = rows.map((driver) => {
            const item = driver.toJSON();
            if (item.details) {
                for (const field of [
                    'aadhar_img',
                    'aadhar_back_img',
                    'driving_licence_img',
                    'driving_licence_back_img',
                    'driver_authorized_letter_img',
                    'smart_card_img',
                    'smart_card_back_img',
                ]) {
                    item.details[field] = getImageUrl(item.details[field]);
                }
            }
            return item;
        });

        res.json({
            success: true,
            data,
            pagination: { total: count, page: p, limit: lim, pages: Math.ceil(count / lim) },
        });
    } catch (err) {
        next(err);
    }
};

// ── Get Driver ─────────────────────────────────────────────
exports.show = async (req, res, next) => {
    try {
        const driver = await Driver.findByPk(req.params.id, {
            include: [
                { model: DriverDetail, as: 'details' },
                {
                    model: Vehicle,
                    as: 'vehicles',
                    ...(isOwnerRole(req) ? { where: { owner_id: req.user.id }, required: false } : {}),
                },
            ],
        });
        if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
        if (isOwnerRole(req) && Number(driver.owner_id) !== Number(req.user.id)) {
            return res.status(403).json({ success: false, message: 'You can only view your own drivers' });
        }

        const data = driver.toJSON();
        if (data.details) {
            for (const field of [
                'aadhar_img',
                'aadhar_back_img',
                'driving_licence_img',
                'driving_licence_back_img',
                'driver_authorized_letter_img',
                'smart_card_img',
                'smart_card_back_img',
            ]) {
                data.details[field] = getImageUrl(data.details[field]);
            }
        }
        res.json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

// ── Create Driver ──────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
        const { name, email, mobile, aadhar, pan, sex, address, status, aadhar_img, pan_img, details, is_bus_driver, preferred_bus_type_id, owner_id } = req.body;
        const isBusDriver = is_bus_driver === true || is_bus_driver === 1 || is_bus_driver === '1' || is_bus_driver === 'true';
        const normalizedSex = sex === '' ? null : sex;
        const preferredBusTypeId = preferred_bus_type_id ? Number(preferred_bus_type_id) : null;
        if (!name || !String(name).trim()) {
            return res.status(400).json({ success: false, message: 'Driver name is required' });
        }
        if (normalizedSex != null && !['Male', 'Female', 'Other'].includes(normalizedSex)) {
            return res.status(400).json({ success: false, message: 'sex must be Male, Female, Other, or empty' });
        }
        if (isBusDriver && (!Number.isInteger(preferredBusTypeId) || preferredBusTypeId < 1)) {
            return res.status(400).json({ success: false, message: 'A valid preferred bus type is required for bus drivers' });
        }
        const ownerId = isOwnerRole(req) ? req.user.id : owner_id || null;
        if (isOwnerRole(req) && Number(ownerId) !== Number(req.user.id)) {
            return res.status(403).json({ success: false, message: 'Owner assignment is restricted to your own fleet' });
        }
        if (isOwnerRole(req)) {
            const payload = {
                ...req.body,
                owner_id: req.user.id,
                status: 'Pending',
            };
            delete payload.block_status;
            delete payload.online_status;
            delete payload.complete_status;
            const request = await OwnerApprovalRequest.create({
                owner_id: req.user.id,
                request_type: 'driver_create',
                payload: JSON.stringify(payload),
            });
            return res.status(202).json({ success: true, message: 'Driver request sent to admin for approval', data: request });
        }
        const createOptions = req.approvalTransaction ? { transaction: req.approvalTransaction } : {};
        const driver = await Driver.create({
            name: String(name).trim(),
      email,
      mobile,
            owner_id: ownerId,
                        vehicle_type_id: isBusDriver ? 6 : undefined,
                        is_bus_driver: isBusDriver,
                        preferred_bus_type_id: isBusDriver ? preferredBusTypeId : null,
      aadhar,
      pan,
            sex: normalizedSex,
      address,
      status: status || 'Pending',
      created_by: req.user?.name,
        }, createOptions);

    const driverFolder = `drivers/${driver.id}`;

     const savedAadharImg = saveBase64File(
        aadhar_img || details?.aadhar_img,
        driverFolder,
        'aadhar'
    );


    const savedPanImg = saveBase64File(
        pan_img || details?.pan_img,
        driverFolder,
        'pan'
    );

    const driverDetailsData = {
        ...(details || {}),

        driver_id: driver.id,

        aadhar:
            aadhar ||
            details?.aadhar,

        aadhar_img:
            savedAadharImg,

        smart_card_number:
            pan ||
            details?.smart_card_number,

        smart_card_img:
            savedPanImg,
    };
    await DriverDetail.create(driverDetailsData, createOptions);

    await logAction({ userId: req.user?.id, userType: req.user?.role?.name, userName: req.user?.name, action: 'create', module: 'drivers', entityType: 'Driver', entityId: driver.id, newValues: { name, mobile }, ipAddress: req.ip, description: `Created driver ${name}` });
    const created = await Driver.findByPk(driver.id, {
        include: [{ model: DriverDetail, as: 'details' }],
        ...createOptions,
    });
    res.status(201).json({ success: true, message: 'Driver created', data: created });
  } catch (err) {
    next(err);
  }
};

// ── Update Driver ──────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
        const driver = await Driver.findByPk(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }
        if (isOwnerRole(req) && Number(driver.owner_id) !== Number(req.user.id)) {
            return res.status(403).json({ success: false, message: 'You can only edit your own drivers' });
        }
        if (isOwnerRole(req)) {
            const payload = { ...req.body, owner_id: req.user.id };
            for (const field of ['status', 'block_status', 'online_status', 'complete_status', 'created_by']) delete payload[field];
            const request = await OwnerApprovalRequest.create({
                owner_id: req.user.id,
                request_type: 'driver_update',
                target_id: driver.id,
                payload: JSON.stringify(payload),
            });
            return res.status(202).json({ success: true, message: 'Driver update sent to admin for approval', data: request });
        }
        if (req.body.is_bus_driver && !req.body.preferred_bus_type_id) {
            return res.status(400).json({ success: false, message: 'Preferred bus type is required for bus drivers' });
        }

        const {
            name,
            email,
            mobile,
            aadhar,
            pan,
            sex,
            address,
            status,
            block_status,
            online_status,
            aadhar_img,
            pan_img,
        } = req.body;
        const details = req.body.details || {};
        const existingDetail = await DriverDetail.findOne({ where: { driver_id: driver.id } });
        const driverFolder = `drivers/${driver.id}`;
        const oldAadharImg = existingDetail?.aadhar_img || null;
        const oldPanImg = existingDetail?.smart_card_img || null;
        const submittedAadharImg = aadhar_img ?? details.aadhar_img;
        const submittedPanImg = pan_img ?? details.smart_card_img ?? details.pan_img;
        const uploadedFiles = [];

        try {
            const newAadharImg = typeof submittedAadharImg === 'string' && submittedAadharImg.startsWith('data:')
                ? saveBase64File(submittedAadharImg, driverFolder, 'aadhar')
                : null;
            if (newAadharImg) uploadedFiles.push(newAadharImg);

            const newPanImg = typeof submittedPanImg === 'string' && submittedPanImg.startsWith('data:')
                ? saveBase64File(submittedPanImg, driverFolder, 'pan')
                : null;
            if (newPanImg) uploadedFiles.push(newPanImg);

            const driverPayload = {};
            if (isOwnerRole(req)) {
                driverPayload.owner_id = req.user.id;
            } else if (req.body.owner_id !== undefined) {
                driverPayload.owner_id = req.body.owner_id || null;
            }
            for (const field of ['name', 'email', 'mobile', 'aadhar', 'pan', 'sex', 'address', 'status', 'block_status', 'online_status', 'is_bus_driver', 'preferred_bus_type_id']) {
                if (req.body[field] !== undefined) driverPayload[field] = req.body[field];
            }
            if (driverPayload.is_bus_driver) {
                driverPayload.vehicle_type_id = 6;
            } else if (driverPayload.is_bus_driver === false || driverPayload.is_bus_driver === 0) {
                driverPayload.preferred_bus_type_id = null;
                if (Number(driver.vehicle_type_id) === 6) driverPayload.vehicle_type_id = null;
            }

            const detailPayload = {};
            for (const [field, value] of Object.entries(details)) {
                if (!['aadhar_img', 'smart_card_img', 'pan_img'].includes(field)) detailPayload[field] = value;
            }
            if (aadhar !== undefined) detailPayload.aadhar = aadhar || null;
            if (pan !== undefined) detailPayload.smart_card_number = pan || null;
            if (newAadharImg) detailPayload.aadhar_img = newAadharImg;
            if (newPanImg) detailPayload.smart_card_img = newPanImg;

            const transaction = await sequelize.transaction();
            try {
                await driver.update(driverPayload, { transaction });
                if (existingDetail) {
                    await existingDetail.update(detailPayload, { transaction });
                } else {
                    await DriverDetail.create({ ...detailPayload, driver_id: driver.id }, { transaction });
                }
                await transaction.commit();
            } catch (err) {
                await transaction.rollback();
                throw err;
            }

            if (newAadharImg && oldAadharImg && oldAadharImg !== newAadharImg) deleteFile(oldAadharImg);
            if (newPanImg && oldPanImg && oldPanImg !== newPanImg) deleteFile(oldPanImg);
            return res.json({ success: true, message: 'Driver updated successfully' });
        } catch (err) {
            uploadedFiles.forEach(deleteFile);
            throw err;
        }
    } catch (err) {
    next(err);
  }
};

// ── Delete Driver ──────────────────────────────────────────
exports.destroy = async (req, res, next) => {
  try {
        if (isOwnerRole(req)) return res.status(403).json({ success: false, message: 'Driver removal requires admin approval' });
    const driver = await Driver.findByPk(req.params.id);
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
    deleteFolder(
            `drivers/${driver.id}`
        );
    await driver.destroy();
    res.json({ success: true, message: 'Driver deleted' });
  } catch (err) {
    next(err);
  }
};

// ── Update Status ──────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
        if (isOwnerRole(req)) return res.status(403).json({ success: false, message: 'Only admins can update driver status' });
    const driver = await Driver.findByPk(req.params.id);
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
    const { status, block_status, online_status, complete_status } = req.body;
    await driver.update({ status, block_status, online_status, complete_status });
    res.json({ success: true, message: 'Driver status updated', data: driver });
  } catch (err) {
    next(err);
  }
};

