'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const passengerController = require('../controllers/passengerController');
const passController = require('../controllers/passController');
const couponController = require('../controllers/couponController');
const notificationController = require('../controllers/notificationController');
const settingController = require('../controllers/settingController');
const paymentController = require('../controllers/paymentController');
const shuttleController = require('../controllers/shuttleController');
const packagePurchaseController = require('../controllers/packagePurchaseController');

router.use(authenticate);

// Passengers
router.get('/passengers', requirePermission('passengers.read'), passengerController.list);
router.get('/passengers/:id', requirePermission('passengers.read'), passengerController.show);
router.post('/passengers', requirePermission('passengers.create'), passengerController.create);
router.put('/passengers/:id', requirePermission('passengers.update'), passengerController.update);
router.delete('/passengers/:id', requirePermission('passengers.delete'), passengerController.destroy);
router.patch('/passengers/:id/toggle-block', requirePermission('passengers.update'), passengerController.toggleBlock);

// Passes
router.get('/passes/expiring', requirePermission('passes.read'), passController.expiringSoon);
router.get('/passes', requirePermission('passes.read'), passController.list);
router.get('/passes/:id', requirePermission('passes.read'), passController.show);
router.post('/passes', requirePermission('passes.manage'), passController.create);
router.put('/passes/:id', requirePermission('passes.manage'), passController.update);
router.delete('/passes/:id', requirePermission('passes.manage'), passController.destroy);

// Ride Packages (City Flow -> Ride Pack)
router.get('/packages', requirePermission('packages.read'), shuttleController.getPackages);
router.get('/packages/:id', requirePermission('packages.read'), shuttleController.getPackageDetails);
router.post('/packages', requirePermission('packages.manage'), shuttleController.createPackage);
router.put('/packages/:id', requirePermission('packages.manage'), shuttleController.updatePackage);
router.patch('/packages/:id/toggle-status', requirePermission('packages.manage'), shuttleController.togglePackageStatus);
router.delete('/packages/:id', requirePermission('packages.manage'), shuttleController.deletePackage);

// Prepaid Ride Package purchases and transaction ledger
router.get('/package-purchases', requirePermission('packages.read'), packagePurchaseController.listAdmin);
router.get('/package-purchases/:purchaseId', requirePermission('packages.read'), packagePurchaseController.showAdmin);

// Coupons
router.post('/coupons/validate', requirePermission('coupons.read'), couponController.validate);
router.get('/coupons', requirePermission('coupons.read'), couponController.list);
router.get('/coupons/:id/usages', requirePermission('coupons.read'), couponController.usages);
router.get('/coupons/:id', requirePermission('coupons.read'), couponController.show);
router.post('/coupons', requirePermission('coupons.manage'), couponController.create);
router.put('/coupons/:id', requirePermission('coupons.manage'), couponController.update);
router.delete('/coupons/:id/usages/:usageId', requirePermission('coupons.manage'), couponController.deleteUsage);
router.delete('/coupons/:id', requirePermission('coupons.manage'), couponController.destroy);

// Notifications
router.get('/notifications', requirePermission('notifications.read'), notificationController.list);
router.post('/notifications', requirePermission('notifications.manage'), notificationController.send);
router.patch('/notifications/read-all', requirePermission('notifications.manage'), notificationController.markAllRead);
router.patch('/notifications/:id/read', requirePermission('notifications.manage'), notificationController.markRead);
router.delete('/notifications/:id', requirePermission('notifications.manage'), notificationController.destroy);

// System Settings
router.get('/settings', requirePermission('settings.manage'), settingController.list);
router.get('/settings/:key', requirePermission('settings.manage'), settingController.get);
router.post('/settings', requirePermission('settings.manage'), settingController.update);
router.put('/settings/bulk', requirePermission('settings.manage'), settingController.bulkUpdate);

// Payments
router.get('/payments', requirePermission('payments.read'), paymentController.list);
router.get('/payments/:id', requirePermission('payments.read'), paymentController.show);

module.exports = router;
