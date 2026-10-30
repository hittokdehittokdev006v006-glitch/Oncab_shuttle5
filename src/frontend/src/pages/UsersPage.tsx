import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usersAPI, rolesAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, SearchInput, Button, Select, StatusBadge, Modal, Input, ConfirmDialog, ErrorState, Badge } from '../components/ui';
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Users, UserCheck, UserX, Shield, Filter, RotateCcw } from 'lucide-react';

interface UsersPageProps { onNotify: (msg: string, type?: any) => void; }

const ADMIN_ROLE_ID = 1;

export const UsersPage: React.FC<UsersPageProps> = ({ onNotify }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', role_id: '' });

  const fetch = useCallback(async () => {
    try {
      setLoading(true); setError('');
      const params: any = { page, limit: 15, search };
      if (roleFilter) params.role_id = roleFilter;
      if (statusFilter !== '') params.is_active = statusFilter;

      const [ur, rr] = await Promise.all([usersAPI.list(params), rolesAPI.list()]);
      const visibleRoles = (rr.data.data || []).filter((role: any) => Number(role.id) !== ADMIN_ROLE_ID);
      setUsers((ur.data.data || []).filter((user: any) => Number(user.role_id) !== ADMIN_ROLE_ID));
      setPagination(ur.data.pagination);
      setRoles(visibleRoles);
    } catch (e: any) { setError(e.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  }, [page, search, roleFilter, statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { setPage(1); }, [search, roleFilter, statusFilter]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (roleFilter) count++;
    if (statusFilter !== '') count++;
    return count;
  }, [search, roleFilter, statusFilter]);

  const resetFilters = () => {
    setSearch('');
    setRoleFilter('');
    setStatusFilter('');
    setPage(1);
  };

  const openCreate = () => { setEditUser(null); setForm({ name: '', email: '', password: '', phone: '', role_id: '' }); setShowModal(true); };
  const openEdit = (u: any) => {
    setEditUser(u);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      phone: u.phone || '',
      role_id: Number(u.role_id) === ADMIN_ROLE_ID ? '' : String(u.role_id || ''),
    });
    setShowModal(true);
  };
  const f = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.name || !form.email || !form.role_id) { onNotify('Name, email and role are required', 'error'); return; }
    if (Number(form.role_id) === ADMIN_ROLE_ID) { onNotify('Admin role cannot be assigned from this panel', 'error'); return; }
    if (!editUser && !form.password) { onNotify('Password is required', 'error'); return; }
    setSaving(true);
    try {
      const data: any = { name: form.name, email: form.email, phone: form.phone, role_id: parseInt(form.role_id) };
      if (form.password) data.password = form.password;
      if (editUser) { await usersAPI.update(editUser.id, data); onNotify('User updated'); }
      else { await usersAPI.create({ ...data, password: form.password }); onNotify('User created'); }
      setShowModal(false); fetch();
    } catch (e: any) { onNotify(e.response?.data?.message || 'Save failed', 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await usersAPI.delete(deleteTarget.id); onNotify('User deleted'); setDeleteTarget(null); fetch(); }
    catch (e: any) { onNotify(e.response?.data?.message || 'Failed', 'error'); }
    finally { setDeleting(false); }
  };

  const handleToggle = async (u: any) => {
    try { await usersAPI.toggleStatus(u.id); onNotify(`User ${u.is_active ? 'deactivated' : 'activated'}`); fetch(); }
    catch { onNotify('Failed', 'error'); }
  };

  const HEADERS = ['User', 'Email', 'Role', 'Status', 'Joined', 'Actions'];
  const roleOptions = [
    { value: '', label: 'All Roles' },
    ...roles.map(r => ({ value: String(r.id), label: r.display_name || r.name }))
  ];
  const formRoleOptions = roles.map(r => ({ value: String(r.id), label: r.display_name || r.name }));

  const STATUS_OPTIONS = [
    { value: '', label: 'All Statuses' },
    { value: 'true', label: 'Active Only' },
    { value: 'false', label: 'Inactive Only' },
  ];

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">User Management</h2>
          <p className="text-slate-400 text-sm">Manage administrative & staff access credentials</p>
        </div>
        <Button onClick={openCreate}><Plus size={14} />Add New User</Button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-700/60 bg-slate-850 p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Users</span>
            <span className="rounded-lg bg-indigo-500/10 p-1.5 text-indigo-400">
              <Users size={15} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-white tracking-tight">{pagination.total}</p>
          <p className="mt-0.5 text-xs text-slate-500">Matching criteria</p>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-850 p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Page Active</span>
            <span className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-400">
              <UserCheck size={15} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight">
            {users.filter(u => u.is_active).length}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Active in current view</p>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-850 p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Page Inactive</span>
            <span className="rounded-lg bg-rose-500/10 p-1.5 text-rose-400">
              <UserX size={15} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-400 tracking-tight">
            {users.filter(u => !u.is_active).length}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Suspended / Inactive</p>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-850 p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Roles Configured</span>
            <span className="rounded-lg bg-purple-500/10 p-1.5 text-purple-400">
              <Shield size={15} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-purple-400 tracking-tight">{roles.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Available roles</p>
        </div>
      </div>

      {/* Professional Multi-Dimensional Filters Bar */}
      <div className="rounded-xl border border-slate-700/60 bg-slate-850/80 p-4 shadow-sm backdrop-blur-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-indigo-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Advanced Filters</span>
            {activeFiltersCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {activeFiltersCount} Active
              </span>
            )}
          </div>
          {activeFiltersCount > 0 && (
            <button
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-400 transition-colors"
            >
              <RotateCcw size={12} />
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search user by name, email, or phone..."
            />
          </div>
          <div>
            <Select
              value={roleFilter}
              onChange={setRoleFilter}
              options={roleOptions}
              placeholder="All Roles"
            />
          </div>
          <div>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_OPTIONS}
              placeholder="All Statuses"
            />
          </div>
        </div>
      </div>

      <Card padding={false}>
        {error ? <ErrorState message={error} onRetry={fetch} /> : (
          <>
            <Table headers={HEADERS} loading={loading} empty={!loading && users.length === 0} emptyMessage="No users found">
              {users.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-inner" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>{u.name.charAt(0)}</div>
                      <div>
                        <div className="text-white text-sm font-medium">{u.name}</div>
                        <div className="text-slate-500 text-xs font-mono">{u.phone || '—'}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-xs text-slate-300">{u.email}</Td>
                  <Td><Badge color="purple">{u.role?.display_name || u.role?.name || '—'}</Badge></Td>
                  <Td><StatusBadge status={u.is_active ? 'Active' : 'Inactive'} /></Td>
                  <Td className="text-xs text-slate-500">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)} title="Edit user"><Edit2 size={13} /></Button>
                      <Button variant={u.is_active ? 'danger' : 'secondary'} size="sm" onClick={() => handleToggle(u)} title={u.is_active ? 'Deactivate user' : 'Activate user'}>
                        {u.is_active ? <ToggleLeft size={13} /> : <ToggleRight size={13} />}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeleteTarget(u)} title="Delete user"><Trash2 size={13} /></Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
            <Pagination page={page} pages={pagination.pages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} />
          </>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editUser ? 'Edit User' : 'Create User'}
        footer={<><Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>{editUser ? 'Update' : 'Create'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Full Name" value={form.name} onChange={f('name')} required className="col-span-2" />
          <Input label="Email" type="email" value={form.email} onChange={f('email')} required className="col-span-2" />
          <Input label={editUser ? 'New Password (leave blank to keep)' : 'Password'} type="password" value={form.password} onChange={f('password')} placeholder="••••••••" required={!editUser} />
          <Input label="Phone" value={form.phone} onChange={f('phone')} placeholder="+91 ..." />
          <div className="space-y-1.5 col-span-2"><label className="block text-xs font-medium text-slate-400">Role <span style={{ color: '#ef4444' }}>*</span></label>
            <Select value={form.role_id} onChange={f('role_id')} options={formRoleOptions} placeholder="Select role" /></div>
        </div>
      </Modal>
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete User" message={`Delete user "${deleteTarget?.name}"?`} loading={deleting} />
    </div>
  );
};
