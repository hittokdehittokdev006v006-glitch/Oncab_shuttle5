'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan'); 
const rateLimit = require('express-rate-limit');

const { sequelize } = require('../models');
const { errorHandler, notFound } = require('../middleware/errorHandler');

// ── Routes ─────────────────────────────────────────────────
const authRoutes = require('../routes/authRoutes');
const userRoutes = require('../routes/userRoutes');
const roleRoutes = require('../routes/roleRoutes');
const driverRoutes = require('../routes/driverRoutes');
const driverAppRoutes = require('../routes/driverAppRoutes');
const vehicleRoutes = require('../routes/vehicleRoutes');
const routeRoutes = require('../routes/routeRoutes');
const tripRoutes = require('../routes/tripRoutes');
const bookingRoutes = require('../routes/bookingRoutes');
const refundRoutes = require('../routes/refundRoutes');
const dashboardRoutes = require('../routes/dashboardRoutes');
const locationRoutes = require('../routes/locationRoutes');
const rateChartRoutes = require('../routes/rateChartRoutes');
const otherRoutes = require('../routes/otherRoutes');
const internalRoutes = require('../routes/internal');
const busRoutes = require('../routes/busRoutes');
const ownerApprovalRoutes = require('../routes/ownerApprovalRoutes');
const bannerRoutes = require('../routes/bannerRoutes');


const app = express();
app.set('trust proxy', 1);
// ── Security & Middleware ───────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate Limiting ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  max: parseInt(process.env.RATE_LIMIT_MAX || 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { success: false, message: 'Too many login attempts' } });

app.use('/api', limiter);

// ── Static Files ─────────────────────────────────────────────
const frontendPath = path.join(__dirname, 'frontend', 'dist');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/', express.static(frontendPath));

// ── API Routes ───────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV }));

app.use('/api2/auth', authRoutes);
app.use('/api2/internal',internalRoutes);
app.use('/api2/dashboard', dashboardRoutes);
app.use('/api2/locations', locationRoutes);
app.use('/api2/rate-charts', rateChartRoutes);
app.use('/api2/users', userRoutes);
app.use('/api2/roles', roleRoutes);
app.use('/api2/drivers', driverRoutes);
app.use('/api2/bus-driver', driverAppRoutes);
app.use('/api2/driver-app', driverAppRoutes);
app.use('/api2/vehicles', vehicleRoutes);
app.use('/api2/routes', routeRoutes);
app.use('/api2/trips', tripRoutes);
app.use('/api2/bookings', bookingRoutes);
app.use('/api2/refunds', refundRoutes);
app.use('/api2/owner-approval-requests', ownerApprovalRoutes);
app.use('/api2/banners', bannerRoutes);
app.use('/api2/bus', busRoutes);
app.use('/api2', otherRoutes);

// ── SPA Fallback ─────────────────────────────────────────────
app.get('{*splat}', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ── Error Handlers ───────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start Server ─────────────────────────────────────────────
const { ensureTripsIndex, ensureTripLocationsTable, ensureTripStopArrivalsTable } = require('../utils/dbIndexMigrator');
const { startTripLocationPurgeJob } = require('../services/tripLocationPurgeService');

const PORT = parseInt(process.env.PORT || '4000');

const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected successfully');
    await ensureTripsIndex();
    await ensureTripLocationsTable();
    await ensureTripStopArrivalsTable();
    // Start automatic retention purge for trip driver locations (>= 48h data kept)
    startTripLocationPurgeJob();
    // Sync models (use migrations in production)
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: false });
      console.log('✅ Models synchronized');
    }
    app.listen(PORT, () => {
      console.log(`🚀 OncabShuttle server running on port ${PORT}`);
      console.log(`📡 API: http://localhost:${PORT}/api`);
      console.log(`🌐 Frontend: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
};

startServer();

module.exports = app;
