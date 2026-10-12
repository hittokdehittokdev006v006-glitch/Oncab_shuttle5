'use strict';

const sequelize = require('../config/database');

// Import all models
const Role = require('./Role');
const Permission = require('./Permission');
const AdminUser = require('./AdminUser');
const CustomerUser = require('./CustomerUser');
const Driver = require('./Driver');
const DriverDetail = require('./DriverDetail');
const Vehicle = require('./Vehicle');
const VehicleDocument = require('./VehicleDocument');
const BusType = require('./BusType');
const BusRoute = require('./BusRoute');
const BusStop = require('./BusStop');
const BusSchedule = require('./BusSchedule');
const BusDriverAssignment = require('./BusDriverAssignment');
const Route = require('./Route');
const Stop = require('./Stop');
const RouteStop = require('./RouteStop');
const Trip = require('./Trip');
const Passenger = require('./Passenger');
const Booking = require('./Booking');
const Payment = require('./Payment');
const Refund = require('./Refund');
const Pass = require('./Pass');
const Coupon = require('./Coupon');
const CouponUsage = require('./CouponUsage');
const Notification = require('./Notification');
const AuditLog = require('./AuditLog');
const SystemSetting = require('./SystemSetting');
const RateChart = require('./RateChart');
const WalletTransaction = require('./WalletTransaction');
const OwnerApprovalRequest = require('./OwnerApprovalRequest');

// ─── Role & Permission Associations ─────────────────────
Role.belongsToMany(Permission, {
  through: 'role_permissions',
  foreignKey: 'role_id',
  otherKey: 'permission_id',
  as: 'permissions',
});
Permission.belongsToMany(Role, {
  through: 'role_permissions',
  foreignKey: 'permission_id',
  otherKey: 'role_id',
  as: 'roles',
});

// ─── AdminUser Associations ──────────────────────────────
AdminUser.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });
Role.hasMany(AdminUser, { foreignKey: 'role_id', as: 'admin_users' });
AdminUser.hasMany(Vehicle, { foreignKey: 'owner_id', as: 'owned_vehicles' });
Vehicle.belongsTo(AdminUser, { foreignKey: 'owner_id', as: 'owner' });
AdminUser.hasMany(Driver, { foreignKey: 'owner_id', as: 'owned_drivers' });
Driver.belongsTo(AdminUser, { foreignKey: 'owner_id', as: 'owner' });
AdminUser.hasMany(OwnerApprovalRequest, { foreignKey: 'owner_id', as: 'owner_approval_requests' });
OwnerApprovalRequest.belongsTo(AdminUser, { foreignKey: 'owner_id', as: 'owner' });

// ─── Driver Associations ─────────────────────────────────
Driver.hasOne(DriverDetail, { foreignKey: 'driver_id', as: 'details', onDelete: 'CASCADE' });
DriverDetail.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });

Driver.hasMany(Vehicle, { foreignKey: 'driver_id', as: 'vehicles' });
Vehicle.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });

// ─── Vehicle Associations ────────────────────────────────
Vehicle.belongsTo(BusType, { foreignKey: 'bus_type_id', as: 'bus_type' });
BusType.hasMany(Vehicle, { foreignKey: 'bus_type_id', as: 'vehicles' });

// ─── Bus Schedule & Driver Assignment ────────────────────
BusRoute.hasMany(BusStop, { foreignKey: 'route_id', as: 'stops' });
BusStop.belongsTo(BusRoute, { foreignKey: 'route_id', as: 'route' });
BusRoute.hasMany(BusSchedule, { foreignKey: 'route_id', as: 'schedules' });
BusSchedule.belongsTo(BusRoute, { foreignKey: 'route_id', as: 'bus_route' });
Route.hasMany(BusSchedule, { foreignKey: 'route_id', as: 'schedules' });
BusSchedule.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });
BusSchedule.belongsTo(Route, { foreignKey: 'route_id', as: 'main_route' });
BusType.hasMany(BusSchedule, { foreignKey: 'bus_type_id', as: 'bus_schedules' });
BusSchedule.belongsTo(BusType, { foreignKey: 'bus_type_id', as: 'bus_type' });
BusSchedule.hasMany(BusDriverAssignment, { foreignKey: 'schedule_id', as: 'driverAssignments' });
BusDriverAssignment.belongsTo(BusSchedule, { foreignKey: 'schedule_id', as: 'schedule' });
Driver.hasMany(BusDriverAssignment, { foreignKey: 'driver_id', as: 'busAssignments' });
BusDriverAssignment.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });
BusSchedule.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
Vehicle.hasMany(BusSchedule, { foreignKey: 'vehicle_id', as: 'bus_schedules' });

Vehicle.hasMany(VehicleDocument, { foreignKey: 'vehicle_id', as: 'documents', onDelete: 'CASCADE' });
VehicleDocument.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });

// ─── Route & Stop Associations ───────────────────────────
Route.hasMany(Stop, { foreignKey: 'route_id', as: 'stops', onDelete: 'CASCADE' });
Stop.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });

Route.belongsToMany(Stop, { through: RouteStop, foreignKey: 'route_id', otherKey: 'stop_id', as: 'physical_stops' });
Stop.belongsToMany(Route, { through: RouteStop, foreignKey: 'stop_id', otherKey: 'route_id', as: 'routes' });

Route.hasMany(RouteStop, { foreignKey: 'route_id', as: 'route_stops', onDelete: 'CASCADE' });
RouteStop.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });

Stop.hasMany(RouteStop, { foreignKey: 'stop_id', as: 'route_stops', onDelete: 'CASCADE' });
RouteStop.belongsTo(Stop, { foreignKey: 'stop_id', as: 'stop' });

Route.hasMany(RateChart, { foreignKey: 'route_id', as: 'rate_charts', onDelete: 'CASCADE' });
RateChart.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });
RateChart.belongsTo(Stop, { foreignKey: 'origin_stop_id', as: 'origin_stop' });
RateChart.belongsTo(Stop, { foreignKey: 'destination_stop_id', as: 'destination_stop' });

// ─── Trip Associations ───────────────────────────────────
Trip.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });
Route.hasMany(Trip, { foreignKey: 'route_id', as: 'trips' });

Trip.belongsTo(BusType, { foreignKey: 'bus_type_id', as: 'bus_type' });
BusType.hasMany(Trip, { foreignKey: 'bus_type_id', as: 'trips' });

Trip.belongsTo(Driver, { foreignKey: 'driver_id', as: 'driver' });
Driver.hasMany(Trip, { foreignKey: 'driver_id', as: 'trips' });

Trip.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
Vehicle.hasMany(Trip, { foreignKey: 'vehicle_id', as: 'trips' });

// ─── Booking Associations ────────────────────────────────
Booking.belongsTo(Trip, { foreignKey: 'trip_id', as: 'trip' });
Trip.hasMany(Booking, { foreignKey: 'trip_id', as: 'bookings' });

Booking.belongsTo(CustomerUser, { foreignKey: 'passenger_id', as: 'passenger' });
CustomerUser.hasMany(Booking, { foreignKey: 'passenger_id', as: 'bookings' });
CustomerUser.hasMany(WalletTransaction, { foreignKey: 'passenger_id', as: 'wallet_transactions' });
WalletTransaction.belongsTo(CustomerUser, { foreignKey: 'passenger_id', as: 'passenger' });

Booking.belongsTo(Stop, { foreignKey: 'origin_stop_id', as: 'origin_stop' });
Booking.belongsTo(Stop, { foreignKey: 'destination_stop_id', as: 'destination_stop' });

Booking.belongsTo(Coupon, { foreignKey: 'coupon_id', as: 'coupon' });
Coupon.hasMany(Booking, { foreignKey: 'coupon_id', as: 'bookings' });
Coupon.hasMany(CouponUsage, { foreignKey: 'coupon_id', as: 'redemptions' });
CouponUsage.belongsTo(Coupon, { foreignKey: 'coupon_id', as: 'coupon' });
CouponUsage.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
Booking.hasOne(CouponUsage, { foreignKey: 'booking_id', as: 'coupon_usage' });
CouponUsage.belongsTo(CustomerUser, { foreignKey: 'passenger_id', as: 'passenger' });
CustomerUser.hasMany(CouponUsage, { foreignKey: 'passenger_id', as: 'coupon_usages' });

// ─── Payment Associations ────────────────────────────────
Payment.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
Booking.hasMany(Payment, { foreignKey: 'booking_id', as: 'payments' });

Payment.belongsTo(CustomerUser, { foreignKey: 'passenger_id', as: 'passenger' });
CustomerUser.hasMany(Payment, { foreignKey: 'passenger_id', as: 'payments' });

// ─── Refund Associations ─────────────────────────────────
Refund.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
Booking.hasMany(Refund, { foreignKey: 'booking_id', as: 'refunds' });

Refund.belongsTo(Payment, { foreignKey: 'payment_id', as: 'payment' });
Payment.hasMany(Refund, { foreignKey: 'payment_id', as: 'refunds' });

Refund.belongsTo(CustomerUser, { foreignKey: 'passenger_id', as: 'passenger' });
CustomerUser.hasMany(Refund, { foreignKey: 'passenger_id', as: 'refunds' });

// ─── Pass Associations ───────────────────────────────────
Pass.belongsTo(Passenger, { foreignKey: 'passenger_id', as: 'passenger' });
Passenger.hasMany(Pass, { foreignKey: 'passenger_id', as: 'passes' });

Pass.belongsTo(Route, { foreignKey: 'route_id', as: 'route' });
Route.hasMany(Pass, { foreignKey: 'route_id', as: 'passes' });

module.exports = {
  sequelize,
  Role,
  Permission,
  AdminUser,
  CustomerUser,
  Driver,
  DriverDetail,
  Vehicle,
  VehicleDocument,
  BusType,
  BusRoute,
  BusStop,
  BusSchedule,
  BusDriverAssignment,
  Route,
  Stop,
  RouteStop,
  Trip,
  Passenger,
  Booking,
  Payment,
  Refund,
  Pass,
  Coupon,
  CouponUsage,
  Notification,
  AuditLog,
  SystemSetting,
  RateChart,
  WalletTransaction,
  OwnerApprovalRequest,
};
