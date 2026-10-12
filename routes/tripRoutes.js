'use strict';

const express = require('express');
const router = express.Router();
const tripController = require('../controllers/tripController');
const { authenticate, requirePermission } = require('../middleware/auth');
const { hasRole } = require('../utils/roles');

const requireOwnerBookingAccess = (req, res, next) => {
	if (!hasRole(req.user, 'owner')
		|| (req.userPermissions || []).some((permission) => ['bookings.read', 'bookings.manage'].includes(permission))) {
		return next();
	}
	return res.status(403).json({ success: false, message: 'Booking access is required to view trip details or request assignment changes' });
};

router.use(authenticate);
router.get('/', requirePermission('trips.read'), tripController.list);
router.get('/:id', requirePermission('trips.read'), requireOwnerBookingAccess, tripController.show);
router.post('/', requirePermission('trips.manage'), tripController.create);
router.put('/:id', requirePermission('trips.manage'), requireOwnerBookingAccess, tripController.update);
router.delete('/:id', requirePermission('trips.manage'), tripController.destroy);
router.patch('/:id/status', requirePermission('trips.manage'), tripController.updateStatus);
router.patch('/:id/assign-driver', requirePermission('trips.manage'), requireOwnerBookingAccess, tripController.assignDriver);
router.patch('/:id/assign-vehicle', requirePermission('trips.manage'), requireOwnerBookingAccess, tripController.assignVehicle);
router.patch('/:id/assign-route', requirePermission('trips.manage'), requireOwnerBookingAccess, tripController.assignRoute);
router.post('/generate-future', requirePermission('trips.manage'), tripController.generateFutureTrips);
module.exports = router;
