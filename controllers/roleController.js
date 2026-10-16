'use strict';

const { Op } = require('sequelize');
const { Role, Permission, AdminUser } = require('../models');
const { logAction } = require('../middleware/auditLog');

// ── List Roles ─────────────────────────────────────────────
exports.listRoles = async (req, res, next) => {
  try {
    const [roles, allPermissions] = await Promise.all([
      Role.findAll({
        include: [
          { model: Permission, as: 'permissions' },
          { model: AdminUser, as: 'admin_users', attributes: ['id'] },
        ],
        order: [['id', 'ASC']],
      }),
      Permission.findAll({ order: [['module', 'ASC'], ['id', 'ASC']] }),
    ]);

    const formatted = roles.map((role) => {
      const r = role.toJSON();
      const isAdmin = Number(r.id) === 1 || String(r.name || '').toLowerCase() === 'admin';
      if (isAdmin && (!r.permissions || r.permissions.length < allPermissions.length)) {
        r.permissions = allPermissions;
      }
      r.users_count = r.admin_users ? r.admin_users.length : 0;
      return r;
    });

    res.json({ success: true, data: formatted });
  } catch (err) {
    next(err);
  }
};

// ── Create Role ────────────────────────────────────────────
exports.createRole = async (req, res, next) => {
  try {
    const { name, display_name, description, permission_ids } = req.body;
    const exists = await Role.findOne({ where: { name } });
    if (exists) return res.status(409).json({ success: false, message: 'Role already exists' });

    const role = await Role.create({ name, display_name, description });
    if (permission_ids?.length) {
      const permissions = await Permission.findAll({ where: { id: permission_ids } });
      await role.setPermissions(permissions);
    }

    await logAction({ userId: req.user?.id, userType: req.user?.role?.name, userName: req.user?.name, action: 'create', module: 'roles', entityType: 'Role', entityId: role.id, newValues: { name, display_name }, ipAddress: req.ip, description: `Created role ${name}` });

    const created = await Role.findByPk(role.id, { include: [{ model: Permission, as: 'permissions' }] });
    res.status(201).json({ success: true, message: 'Role created', data: created });
  } catch (err) {
    next(err);
  }
};

// ── Update Role ────────────────────────────────────────────
exports.updateRole = async (req, res, next) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    if (Number(role.id) === 1 || String(role.name || '').toLowerCase() === 'admin') {
      return res.status(403).json({ success: false, message: 'System Admin role cannot be modified' });
    }

    const { display_name, description, is_active, permission_ids } = req.body;
    await role.update({ display_name, description, is_active });
    if (permission_ids !== undefined) {
      const permissions = await Permission.findAll({ where: { id: permission_ids } });
      await role.setPermissions(permissions);
    }

    const updated = await Role.findByPk(role.id, { include: [{ model: Permission, as: 'permissions' }] });
    res.json({ success: true, message: 'Role updated', data: updated });
  } catch (err) {
    next(err);
  }
};

// ── Delete Role ────────────────────────────────────────────
exports.deleteRole = async (req, res, next) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    if (Number(role.id) === 1 || String(role.name || '').toLowerCase() === 'admin') {
      return res.status(403).json({ success: false, message: 'System Admin role cannot be deleted' });
    }

    const usersCount = await AdminUser.count({ where: { role_id: role.id } });
    if (usersCount > 0) return res.status(409).json({ success: false, message: `Cannot delete role: ${usersCount} users assigned to it` });

    await role.destroy();
    res.json({ success: true, message: 'Role deleted' });
  } catch (err) {
    next(err);
  }
};

// ── List Permissions ───────────────────────────────────────
exports.listPermissions = async (req, res, next) => {
  try {
    const { module } = req.query;
    const where = module ? { module } : {};
    const permissions = await Permission.findAll({ where, order: [['module', 'ASC'], ['id', 'ASC']] });
    
    // Group by module with safe fallback
    const grouped = permissions.reduce((acc, p) => {
      const mod = p.module || (p.name ? p.name.split('.')[0] : 'general');
      if (!acc[mod]) acc[mod] = [];
      acc[mod].push(p);
      return acc;
    }, {});

    res.json({ success: true, data: { permissions, grouped } });
  } catch (err) {
    next(err);
  }
};

// ── Assign Permissions to Role ─────────────────────────────
exports.assignPermissions = async (req, res, next) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    if (Number(role.id) === 1 || String(role.name || '').toLowerCase() === 'admin') {
      return res.status(403).json({ success: false, message: 'System Admin role inherently has all permissions and cannot be modified' });
    }

    const { permission_ids } = req.body;
    const permissions = await Permission.findAll({ where: { id: permission_ids } });
    await role.setPermissions(permissions);

    const updated = await Role.findByPk(role.id, { include: [{ model: Permission, as: 'permissions' }] });
    res.json({ success: true, message: 'Permissions updated', data: updated });
  } catch (err) {
    next(err);
  }
};
