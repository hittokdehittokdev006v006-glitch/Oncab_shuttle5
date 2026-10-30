'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { AdminUser, AdminSession, Role, Permission } = require('../models');
const { logAction } = require('../middleware/auditLog');
const { parseDeviceDetails } = require('../utils/deviceDetector');

const generateTokens = (user, sessionToken = null) => {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role?.name,
    ...(sessionToken ? { sid: sessionToken } : {}),
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRY || '24h',
  });

  const refreshToken = jwt.sign(
    { id: user.id, ...(sessionToken ? { sid: sessionToken } : {}) },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRY || '14d',
    }
  );

  return { accessToken, refreshToken };
};

// ── Login with Device & Monitor Tracking ───────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password, device_info } = req.body;

    const user = await AdminUser.findOne({
      where: { email, is_active: true },
      include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });

    if (!user || !(await user.comparePassword(password))) {
      await logAction({
        action: 'login_failed',
        module: 'auth',
        description: `Failed login attempt for ${email}`,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        status: 'failed',
      });
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Generate unique session identifier
    const sessionToken = crypto.randomUUID();
    const { accessToken, refreshToken } = generateTokens(user, sessionToken);

    // Extract device, browser, OS, and monitor details
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const parsedDevice = parseDeviceDetails(userAgent, device_info || {});

    // Create active session in database
    await AdminSession.create({
      user_id: user.id,
      session_token: sessionToken,
      refresh_token: refreshToken,
      device_type: parsedDevice.deviceType,
      device_name: parsedDevice.deviceName,
      browser: parsedDevice.browser,
      os: parsedDevice.os,
      screen_resolution: parsedDevice.screenResolution,
      color_depth: parsedDevice.colorDepth,
      pixel_ratio: parsedDevice.pixelRatio,
      ip_address: ipAddress,
      user_agent: userAgent,
      is_active: true,
      last_activity_at: new Date(),
    });

    // Update user record
    await user.update({
      refresh_token: refreshToken,
      last_login_at: new Date(),
    });

    await logAction({
      userId: user.id,
      userType: user.role?.name,
      userName: user.name,
      action: 'login',
      module: 'auth',
      description: `User logged in from ${parsedDevice.deviceName} (${parsedDevice.browser}, Display: ${parsedDevice.screenResolution || 'N/A'})`,
      ipAddress: ipAddress,
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toJSON(),
        permissions: user.role?.permissions?.map((p) => p.name) || [],
        accessToken,
        refreshToken,
        sessionToken,
        device: {
          deviceName: parsedDevice.deviceName,
          screenResolution: parsedDevice.screenResolution,
          browser: parsedDevice.browser,
          os: parsedDevice.os,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Refresh Token ──────────────────────────────────────────
exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await AdminUser.findOne({
      where: { id: decoded.id, is_active: true },
      include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    // Verify session if token contains session id
    if (decoded.sid) {
      const session = await AdminSession.findOne({
        where: { user_id: user.id, session_token: decoded.sid, is_active: true },
      });
      if (!session) {
        return res.status(401).json({ success: false, message: 'Session has expired or was terminated remotely' });
      }

      const tokens = generateTokens(user, decoded.sid);
      await session.update({
        refresh_token: tokens.refreshToken,
        last_activity_at: new Date(),
      });

      return res.json({
        success: true,
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });
    }

    const tokens = generateTokens(user);
    await user.update({ refresh_token: tokens.refreshToken });

    res.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Refresh token expired, please login again' });
    }
    next(err);
  }
};

// ── Logout ─────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  try {
    if (req.sessionToken) {
      await AdminSession.update(
        { is_active: false },
        { where: { session_token: req.sessionToken } }
      );
    } else {
      await req.user.update({ refresh_token: null });
    }

    await logAction({
      userId: req.user.id,
      userType: req.user.role?.name,
      userName: req.user.name,
      action: 'logout',
      module: 'auth',
      description: 'User logged out',
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

// ── Get Current User ───────────────────────────────────────
exports.me = async (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user.toJSON(),
      permissions: req.userPermissions,
      sessionId: req.sessionToken || null,
      device: req.session ? {
        deviceName: req.session.device_name,
        browser: req.session.browser,
        os: req.session.os,
        screenResolution: req.session.screen_resolution,
      } : null,
    },
  });
};

// ── Forgot Password (6-digit OTP / Token) ──────────────────
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await AdminUser.findOne({ where: { email, is_active: true } });

    // Generate an easy-to-use 6-digit OTP code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    if (user) {
      await user.update({
        password_reset_token: resetCode,
        password_reset_expires: resetExpires,
      });

      console.log(`\n=========================================`);
      console.log(`🔐 [ADMIN FORGOT PASSWORD]`);
      console.log(`User: ${email}`);
      console.log(`6-Digit Verification Code: ${resetCode}`);
      console.log(`Expires at: ${resetExpires.toISOString()}`);
      console.log(`=========================================\n`);
    }

    // Always return success with code (for immediate developer/admin ease)
    res.json({
      success: true,
      message: 'Password reset code has been generated. Please check your verification code.',
      resetCode: resetCode,
      expiresInMinutes: 30,
    });
  } catch (err) {
    next(err);
  }
};

// ── Reset Password ─────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const user = await AdminUser.findOne({
      where: { password_reset_token: token.toString().trim() },
    });

    if (!user || !user.password_reset_expires || new Date() > user.password_reset_expires) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    // Update password (hashed by AdminUser beforeUpdate hook)
    await user.update({
      password,
      password_reset_token: null,
      password_reset_expires: null,
      refresh_token: null,
    });

    // Terminate all existing sessions on password reset for security
    await AdminSession.update(
      { is_active: false },
      { where: { user_id: user.id } }
    );

    await logAction({
      userId: user.id,
      userType: user.role?.name,
      userName: user.name,
      action: 'reset_password',
      module: 'auth',
      description: 'Admin password reset using verification code. All active sessions invalidated.',
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Password reset successfully. Please sign in with your new password.',
    });
  } catch (err) {
    next(err);
  }
};

// ── Change Password (Authenticated Admin) ──────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, logoutOtherDevices } = req.body;
    const user = await AdminUser.findByPk(req.user.id);

    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({ success: false, message: 'Current password does not match.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long.' });
    }

    await user.update({ password: newPassword });

    // Revoke other devices if requested (default true)
    if (logoutOtherDevices !== false && req.sessionToken) {
      await AdminSession.update(
        { is_active: false },
        {
          where: {
            user_id: user.id,
            session_token: { [Op.ne]: req.sessionToken },
          },
        }
      );
    }

    await logAction({
      userId: user.id,
      userType: user.role?.name,
      userName: user.name,
      action: 'change_password',
      module: 'auth',
      description: 'Admin successfully updated their account password.',
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Password updated successfully.',
    });
  } catch (err) {
    next(err);
  }
};

// ── List Logged-In Sessions & Monitors ─────────────────────
exports.listSessions = async (req, res, next) => {
  try {
    const sessions = await AdminSession.findAll({
      where: { user_id: req.user.id },
      order: [['last_activity_at', 'DESC']],
      limit: 50,
    });

    const activeSessions = sessions.filter((s) => s.is_active);
    const monitorResolutions = Array.from(new Set(activeSessions.map((s) => s.screen_resolution).filter(Boolean)));
    const deviceTypes = Array.from(new Set(activeSessions.map((s) => s.device_type)));

    const formattedSessions = sessions.map((session) => {
      const isCurrent = session.session_token === req.sessionToken;
      return {
        id: session.id,
        device_type: session.device_type,
        device_name: session.device_name,
        browser: session.browser,
        os: session.os,
        screen_resolution: session.screen_resolution,
        color_depth: session.color_depth,
        pixel_ratio: session.pixel_ratio,
        ip_address: session.ip_address,
        is_active: session.is_active,
        is_current: isCurrent,
        last_activity_at: session.last_activity_at,
        created_at: session.created_at,
      };
    });

    res.json({
      success: true,
      data: {
        sessions: formattedSessions,
        stats: {
          total_active: activeSessions.length,
          total_sessions_history: sessions.length,
          unique_monitors_count: monitorResolutions.length,
          monitors_list: monitorResolutions,
          device_types: deviceTypes,
          current_session_token: req.sessionToken || null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Revoke / Disconnect a Specific Device Session ──────────
exports.revokeSession = async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    const session = await AdminSession.findOne({
      where: { id: sessionId, user_id: req.user.id },
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Device session not found' });
    }

    await session.update({ is_active: false });

    await logAction({
      userId: req.user.id,
      userType: req.user.role?.name,
      userName: req.user.name,
      action: 'revoke_session',
      module: 'auth',
      description: `Revoked session on ${session.device_name} (${session.browser}, Display: ${session.screen_resolution})`,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: `Session on ${session.device_name} (${session.browser}) has been terminated.`,
    });
  } catch (err) {
    next(err);
  }
};

// ── Log Out / Terminate All Other Sessions ─────────────────
exports.revokeOtherSessions = async (req, res, next) => {
  try {
    const currentSessionToken = req.sessionToken;
    const whereClause = {
      user_id: req.user.id,
      is_active: true,
    };

    if (currentSessionToken) {
      whereClause.session_token = { [Op.ne]: currentSessionToken };
    }

    const [updatedCount] = await AdminSession.update(
      { is_active: false },
      { where: whereClause }
    );

    await logAction({
      userId: req.user.id,
      userType: req.user.role?.name,
      userName: req.user.name,
      action: 'revoke_all_other_sessions',
      module: 'auth',
      description: `Terminated ${updatedCount} remote sessions.`,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: `Successfully logged out ${updatedCount} other device session(s).`,
      revoked_count: updatedCount,
    });
  } catch (err) {
    next(err);
  }
};
