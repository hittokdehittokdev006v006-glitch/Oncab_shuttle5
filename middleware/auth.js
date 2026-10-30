'use strict';

const jwt = require('jsonwebtoken');
const { AdminUser, AdminSession, Role, Permission } = require('../models');
const { normalizeRoleName, hasRole } = require('../utils/roles');

const hasPermission = (userPermissions, permission) => {
  if (userPermissions.includes(permission)) return true;
  const module = permission.split('.')[0];
  return userPermissions.includes(`${module}.manage`);
};

/**
 * Verify JWT Access Token middleware
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await AdminUser.findOne({
      where: { id: decoded.id, is_active: true },
      include: [
        {
          model: Role,
          as: 'role',
          include: [{ model: Permission, as: 'permissions' }],
        },
      ],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found or account deactivated',
      });
    }

    if (decoded.sid) {
      const session = await AdminSession.findOne({
        where: { user_id: user.id, session_token: decoded.sid, is_active: true },
      });

      if (!session) {
        return res.status(401).json({
          success: false,
          message: 'This session has been signed out or terminated remotely.',
          code: 'SESSION_REVOKED',
        });
      }

      req.session = session;
      req.sessionToken = decoded.sid;

      // Throttle last activity update to every 2 minutes
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      if (!session.last_activity_at || session.last_activity_at < twoMinutesAgo) {
        session.update({ last_activity_at: new Date() }).catch(() => {});
      }
    }

    req.user = user;
    req.userPermissions = user.role?.permissions?.map((p) => p.name) || [];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Access token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid access token' });
    }
    next(err);
  }
};

/**
 * Check if user has a specific role
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const userRole = normalizeRoleName(req.user.role?.name);
    if (!roles.some((role) => normalizeRoleName(role) === userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}`,
      });
    }
    next();
  };
};

/**
 * Check if user has a specific permission
 */
const requirePermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    // Admin has all permissions
    if (hasRole(req.user, 'admin')) {
      return next();
    }
    const userPerms = req.userPermissions || [];
    const allowed = permissions.every((permission) => hasPermission(userPerms, permission));
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        required: permissions,
      });
    }
    next();
  };
};

/**
 * Optional auth — doesn't fail if no token, but sets req.user if valid
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await AdminUser.findOne({
        where: { id: decoded.id, is_active: true },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
      });
      if (user) {
        req.user = user;
        req.userPermissions = user.role?.permissions?.map((p) => p.name) || [];
      }
    }
  } catch (_) {
    // Silently ignore
  }
  next();
};

module.exports = { authenticate, requireRole, requirePermission, optionalAuth };
