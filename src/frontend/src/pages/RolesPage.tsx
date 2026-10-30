import React, { useState, useEffect, useCallback } from 'react';
import { rolesAPI } from '../services/api';
import { Card, Button, Modal, Input, ErrorState, Badge, LoadingState } from '../components/ui';
import { Plus, Edit2, Shield, Check, Search, CheckCheck, X, LockKeyhole, Lock, Info } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface RolesPageProps { onNotify: (msg: string, type?: any) => void; }

const MODULE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard & Overview',
  users: 'User Management',
  roles: 'Roles & Access Control',
  owner_requests: 'Approval Requests',
  owner_kyc: 'Owner KYC & Bank',
  drivers: 'Driver & Crew Management',
  vehicles: 'Buses & Vehicles',
  routes: 'Transit Routes',
  stops: 'Stops & Stations',
  trips: 'Trip Operations',
  schedules: 'Trip Schedules',
  locations: 'Live Tracking & GPS',
  rates: 'Rate Charts & Fares',
  passengers: 'Passenger Customers',
  bookings: 'Ticket Bookings',
  passes: 'Shuttle Commuter Passes',
  coupons: 'Promotions & Coupons',
  payments: 'Payment Gateway',
  refunds: 'Refunds & Returns',
  webhooks: 'PayU Webhooks',
  reports: 'Reports & Analytics',
  audit_logs: 'Audit Trail Logs',
  notifications: 'Broadcast Notifications',
  banners: 'Promotional Banners',
  settings: 'System Settings',
  cross_connection: 'Cross Connection & Route Overlap',
};

export const RolesPage: React.FC<RolesPageProps> = ({ onNotify }) => {
  const { hasPermission } = useAuth();
  const canManageRoles = hasPermission('roles.manage');
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editRole, setEditRole] = useState<any>(null);
  const [permModal, setPermModal] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [assigningSaving, setAssigningSaving] = useState(false);
  const [selectedPerms, setSelectedPerms] = useState<number[]>([]);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [form, setForm] = useState({ name: '', display_name: '', description: '' });

  const fetch = useCallback(async () => {
    try {
      setLoading(true); setError('');
      const [rr, pr] = await Promise.all([rolesAPI.list(), rolesAPI.listPermissions()]);
      setRoles(rr.data.data || []);
      setPermissions(pr.data.data.grouped || {});
    } catch (e: any) { setError(e.response?.data?.message || 'Failed to load roles'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const allAvailablePermissions = Object.values(permissions).flat() as any[];
  const totalPermCount = allAvailablePermissions.length;

  const openCreate = () => { setEditRole(null); setForm({ name: '', display_name: '', description: '' }); setShowModal(true); };
  const openEdit = (r: any) => { setEditRole(r); setForm({ name: r.name, display_name: r.display_name || '', description: r.description || '' }); setShowModal(true); };
  const openPermissions = (r: any) => {
    const isAdmin = Number(r.id) === 1 || String(r.name || '').toLowerCase() === 'admin';
    setPermModal(r);
    if (isAdmin) {
      setSelectedPerms(allAvailablePermissions.map((p: any) => p.id));
    } else {
      setSelectedPerms((r.permissions || []).map((p: any) => p.id));
    }
    setPermissionSearch('');
  };
  const f = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.name || !form.display_name) { onNotify('Name and display name required', 'error'); return; }
    setSaving(true);
    try {
      if (editRole) { await rolesAPI.update(editRole.id, form); onNotify('Role updated'); }
      else { await rolesAPI.create(form); onNotify('Role created'); }
      setShowModal(false); fetch();
    } catch (e: any) { onNotify(e.response?.data?.message || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  const handleAssignPerms = async () => {
    if (!permModal) return;
    const isPermAdmin = Number(permModal.id) === 1 || String(permModal.name || '').toLowerCase() === 'admin';
    if (isPermAdmin) {
      setPermModal(null);
      return;
    }
    setAssigningSaving(true);
    try {
      await rolesAPI.assignPermissions(permModal.id, selectedPerms);
      onNotify('Permissions updated');
      setPermModal(null);
      fetch();
    } catch (e: any) {
      onNotify(e.response?.data?.message || 'Failed', 'error');
    } finally {
      setAssigningSaving(false);
    }
  };

  const togglePerm = (id: number) => setSelectedPerms(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  const toggleGroup = (perms: any[]) => {
    const ids = perms.map((p: any) => p.id);
    const allSelected = ids.every(id => selectedPerms.includes(id));
    if (allSelected) setSelectedPerms(prev => prev.filter(id => !ids.includes(id)));
    else setSelectedPerms(prev => Array.from(new Set([...prev, ...ids])));
  };

  const normalizedPermissionSearch = permissionSearch.trim().toLowerCase();
  const visiblePermissionGroups = Object.entries(permissions).map(([module, perms]: [string, any]) => [
    module,
    (perms as any[]).filter((permission) =>
      `${permission.display_name} ${permission.name} ${permission.action} ${module} ${MODULE_TITLES[module] || ''}`.toLowerCase().includes(normalizedPermissionSearch)
    ),
  ] as [string, any[]]).filter(([, perms]) => perms.length > 0);
  const visiblePermissionIds = visiblePermissionGroups.flatMap(([, perms]) => perms.map((permission) => permission.id));

  const toggleVisiblePermissions = () => {
    const allVisibleSelected = visiblePermissionIds.every((id) => selectedPerms.includes(id));
    setSelectedPerms((current) => allVisibleSelected
      ? current.filter((id) => !visiblePermissionIds.includes(id))
      : Array.from(new Set([...current, ...visiblePermissionIds]))
    );
  };

  const isPermModalAdmin = permModal && (Number(permModal.id) === 1 || String(permModal.name || '').toLowerCase() === 'admin');

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-lg">Roles & Permissions</h2>
          <p className="text-slate-400 text-xs mt-0.5">{roles.length} roles configured in system</p>
        </div>
        {canManageRoles && <Button onClick={openCreate}><Plus size={14} />New Role</Button>}
      </div>

      {error ? <ErrorState message={error} onRetry={fetch} /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((role) => {
            const isAdmin = Number(role.id) === 1 || String(role.name || '').toLowerCase() === 'admin';
            const usersCount = role.users_count ?? (role.admin_users ? role.admin_users.length : 0);
            const rolePerms = role.permissions || [];

            return (
              <Card key={role.id} className={isAdmin ? 'border-indigo-500/30 bg-gradient-to-br from-indigo-950/20 via-transparent to-transparent' : ''}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: isAdmin ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.1)' }}>
                      <Shield size={20} style={{ color: isAdmin ? '#a5b4fc' : '#818cf8' }} />
                    </div>
                    <div>
                      <div className="text-white font-semibold text-sm flex items-center gap-2">
                        {role.display_name || role.name}
                        {isAdmin && (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            Super Admin
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500 text-xs font-mono">{role.name}</div>
                    </div>
                  </div>
                  <Badge color={usersCount > 0 ? 'blue' : 'gray'}>
                    {usersCount} {usersCount === 1 ? 'user' : 'users'}
                  </Badge>
                </div>

                <p className="text-slate-400 text-xs mb-3 min-h-[32px]">
                  {role.description || (isAdmin ? 'Complete system access to all resources and settings' : 'Custom assigned role')}
                </p>

                <div className="flex flex-wrap gap-1 mb-4">
                  {isAdmin ? (
                    <Badge color="green">All {totalPermCount || 'System'} Permissions Active</Badge>
                  ) : (
                    <>
                      {rolePerms.slice(0, 4).map((p: any) => (
                        <Badge key={p.id} color="purple">{p.module}</Badge>
                      ))}
                      {rolePerms.length > 4 && <Badge color="gray">+{rolePerms.length - 4} more</Badge>}
                      {rolePerms.length === 0 && <span className="text-slate-500 text-xs">No permissions assigned</span>}
                    </>
                  )}
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  {canManageRoles && (
                    <>
                      {isAdmin ? (
                        <span className="inline-flex items-center gap-1 text-slate-500 text-xs px-2 py-1.5" title="System admin role is permanently protected">
                          <Lock size={12} /> Protected
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(role)}>
                          <Edit2 size={12} />Edit
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => openPermissions(role)}>
                        <Shield size={12} />{isAdmin ? 'View Access' : 'Permissions'}
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Role Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editRole ? 'Edit Role' : 'Create Role'} size="sm"
        footer={<><Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>{editRole ? 'Update' : 'Create'}</Button></>}>
        <div className="space-y-4">
          <Input label="Role Name (slug)" value={form.name} onChange={f('name')} placeholder="operator" required />
          <Input label="Display Name" value={form.display_name} onChange={f('display_name')} placeholder="Operator" required />
          <Input label="Description" value={form.description} onChange={f('description')} placeholder="Can manage operations" />
        </div>
      </Modal>

      {/* Permissions Assignment Modal */}
      <Modal
        open={!!permModal}
        onClose={() => setPermModal(null)}
        title={`Permissions: ${permModal?.display_name || permModal?.name}`}
        size="xl"
        footer={
          <>
            <span className="mr-auto text-xs text-slate-400">
              {isPermModalAdmin ? `All ${totalPermCount} permissions enabled (Full Access)` : `${selectedPerms.length} permission${selectedPerms.length === 1 ? '' : 's'} selected`}
            </span>
            <Button variant="ghost" onClick={() => setPermModal(null)}>
              {isPermModalAdmin ? 'Close' : 'Cancel'}
            </Button>
            {!isPermModalAdmin && (
              <Button onClick={handleAssignPerms} loading={assigningSaving}>
                <Check size={14} />Save Permissions
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {isPermModalAdmin && (
            <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 p-3 text-sm text-indigo-300 flex items-center gap-2.5">
              <Info size={18} className="text-indigo-400 flex-shrink-0" />
              <span>
                <strong>System Super Administrator</strong> has complete, unrestricted access to all current and future modules. Permissions for this system role are permanently active.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={permissionSearch}
                onChange={(event) => setPermissionSearch(event.target.value)}
                placeholder="Search permissions or modules..."
                aria-label="Search permissions"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              {permissionSearch && (
                <button type="button" aria-label="Clear search" onClick={() => setPermissionSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                  <X size={14} />
                </button>
              )}
            </div>
            {!isPermModalAdmin && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={toggleVisiblePermissions} disabled={visiblePermissionIds.length === 0}>
                  <CheckCheck size={14} />
                  {visiblePermissionIds.length > 0 && visiblePermissionIds.every((id) => selectedPerms.includes(id)) ? 'Clear visible' : 'Select visible'}
                </Button>
                <span className="whitespace-nowrap text-xs tabular-nums text-slate-400">{selectedPerms.length} / {totalPermCount}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 max-h-[60vh] overflow-y-auto pr-1">
            {visiblePermissionGroups.map(([module, perms]: [string, any[]]) => {
              const ids = perms.map((p: any) => p.id);
              const allChecked = ids.every((id: number) => selectedPerms.includes(id));
              const someChecked = ids.some((id: number) => selectedPerms.includes(id));
              const moduleTitle = MODULE_TITLES[module] || module.replace(/[_-]/g, ' ');

              return (
                <section key={module} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/40">
                    <label className="flex min-w-0 items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isPermModalAdmin || allChecked}
                        disabled={isPermModalAdmin}
                        ref={(el) => { if (el) el.indeterminate = !isPermModalAdmin && someChecked && !allChecked; }}
                        onChange={() => toggleGroup(perms)}
                        className="h-4 w-4 accent-indigo-600 rounded"
                      />
                      <span className="truncate text-xs font-semibold capitalize text-slate-900 dark:text-white">{moduleTitle}</span>
                    </label>
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-slate-400">
                      {isPermModalAdmin ? ids.length : ids.filter((id) => selectedPerms.includes(id)).length}/{ids.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 p-2.5 sm:grid-cols-2">
                    {perms.map((p: any) => {
                      const isSelected = isPermModalAdmin || selectedPerms.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className={`flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md border p-2 transition-colors ${
                            isSelected
                              ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-500/10'
                              : 'border-transparent hover:border-slate-200 hover:bg-white dark:hover:border-slate-700 dark:hover:bg-slate-900'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isPermModalAdmin}
                            onChange={() => togglePerm(p.id)}
                            className="mt-0.5 h-3.5 w-3.5 accent-indigo-600 rounded"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-slate-800 dark:text-slate-200">{p.display_name}</span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">{p.name}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          {visiblePermissionGroups.length === 0 && (
            <div className="py-12 text-center">
              <LockKeyhole size={22} className="mx-auto mb-2 text-slate-400" />
              <p className="text-sm text-slate-500">{normalizedPermissionSearch ? 'No permissions match this search.' : 'No permissions available.'}</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
