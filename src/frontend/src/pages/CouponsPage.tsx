import React, { useState, useEffect, useCallback } from 'react';
import { couponsAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, SearchInput, Button, Select, StatusBadge, Modal, Input, ConfirmDialog, ErrorState, Badge } from '../components/ui';
import { Plus, Edit2, Trash2, Tag, History } from 'lucide-react';

interface CouponsPageProps { onNotify: (msg: string, type?: any) => void; }

export const CouponsPage: React.FC<CouponsPageProps> = ({ onNotify }) => {
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });
  const [showModal, setShowModal] = useState(false);
  const [editCoupon, setEditCoupon] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [usageCoupon, setUsageCoupon] = useState<any>(null);
  const [usages, setUsages] = useState<any[]>([]);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [usageSearch, setUsageSearch] = useState('');
  const [usagePage, setUsagePage] = useState(1);
  const [usagePagination, setUsagePagination] = useState({ total: 0, pages: 1, limit: 15 });
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', code_type: 'FLAT', amount: '0', max_discount: '', min_amount: '0', usage_limit: '', per_user_limit: '1', per_device_limit: '', max_seats: '', start_date: '', end_date: '', description: '', status: 'Active' });

  const fetch = useCallback(async () => {
    try {
      setLoading(true); setError('');
      const r = await couponsAPI.list({ page, limit: 15, search, status: statusFilter });
      setCoupons(r.data.data);
      setPagination(r.data.pagination);
    } catch (e: any) { setError(e.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const openCreate = () => { setEditCoupon(null); setForm({ code: '', code_type: 'FLAT', amount: '0', max_discount: '', min_amount: '0', usage_limit: '', per_user_limit: '1', per_device_limit: '', max_seats: '', start_date: '', end_date: '', description: '', status: 'Active' }); setShowModal(true); };
  const openEdit = (c: any) => { setEditCoupon(c); setForm({ code: c.code, code_type: c.code_type, amount: String(c.amount), max_discount: String(c.max_discount || ''), min_amount: String(c.min_amount || '0'), usage_limit: String(c.usage_limit || ''), per_user_limit: String(c.per_user_limit ?? '1'), per_device_limit: String(c.per_device_limit ?? ''), max_seats: String(c.max_seats ?? ''), start_date: c.start_date || '', end_date: c.end_date || '', description: c.description || '', status: c.status }); setShowModal(true); };
  const f = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const loadUsages = async (coupon: any, nextPage: number, searchQuery: string = usageSearch) => {
    setUsagesLoading(true);
    try {
      const response = await couponsAPI.usages(coupon.id, { page: nextPage, limit: 15, search: searchQuery || undefined });
      setUsages(response.data.data);
      setUsagePagination(response.data.pagination);
      setUsagePage(nextPage);
    } catch (e: any) {
      onNotify(e.response?.data?.message || 'Could not load coupon usage', 'error');
    } finally { setUsagesLoading(false); }
  };

  const openUsages = async (coupon: any) => {
    setUsageCoupon(coupon);
    setUsageSearch('');
    await loadUsages(coupon, 1, '');
  };

  const handleSave = async () => {
    if (!form.code || !form.amount) { onNotify('Code and amount required', 'error'); return; }
    setSaving(true);
    try {
      if (editCoupon) { await couponsAPI.update(editCoupon.id, form); onNotify('Coupon updated'); }
      else { await couponsAPI.create(form); onNotify('Coupon created'); }
      setShowModal(false); fetch();
    } catch (e: any) { onNotify(e.response?.data?.message || 'Failed', 'error'); }
    finally { setSaving(false); }
  };

  const [deleteUsageTarget, setDeleteUsageTarget] = useState<any>(null);
  const [deletingUsage, setDeletingUsage] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await couponsAPI.delete(deleteTarget.id);
      onNotify(res.data?.message || 'Coupon deleted and active bookings automatically cancelled');
      setDeleteTarget(null);
      if (usageCoupon?.id === deleteTarget.id) {
        setUsageCoupon(null);
      }
      fetch();
    } catch (e: any) {
      onNotify(e.response?.data?.message || 'Failed to delete coupon', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteUsage = async () => {
    if (!deleteUsageTarget || !usageCoupon) return;
    setDeletingUsage(true);
    try {
      await couponsAPI.deleteUsage(usageCoupon.id, deleteUsageTarget.id);
      onNotify('Coupon usage deleted from database and used count updated');
      setDeleteUsageTarget(null);
      await loadUsages(usageCoupon, usagePage, usageSearch);
      fetch();
    } catch (e: any) {
      onNotify(e.response?.data?.message || 'Failed to delete coupon usage', 'error');
    } finally {
      setDeletingUsage(false);
    }
  };

  const HEADERS = ['Code', 'Type', 'Discount', 'Min Order', 'Used', 'Usage / Seat Caps', 'Expires', 'Status', 'Actions'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-white font-semibold">Coupons & Discounts</h2><p className="text-slate-500 text-sm">{pagination.total} coupons</p></div>
        <Button onClick={openCreate}><Plus size={14} />Create Coupon</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search coupon code..." />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }, { value: 'Expired', label: 'Expired' }]} placeholder="All Statuses" />
      </div>
      <Card padding={false}>
        {error ? <ErrorState message={error} onRetry={fetch} /> : (
          <>
            <Table headers={HEADERS} loading={loading} empty={!loading && coupons.length === 0} emptyMessage="No coupons found">
              {coupons.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: 'rgba(245, 158, 11, 0.1)' }}><Tag size={13} style={{ color: '#f59e0b' }} /></div>
                      <div className="text-white font-mono font-bold text-sm">{c.code}</div>
                    </div>
                  </Td>
                  <Td><Badge color={c.code_type === 'FLAT' ? 'blue' : 'purple'}>{c.code_type === 'FLAT' ? 'FLAT' : 'PERCENTAGE'}</Badge></Td>
                  <Td>
                    <div className="text-emerald-400 font-semibold text-sm">
                      {c.code_type === 'FLAT' ? `₹${c.amount}` : `${c.amount}%`}
                    </div>
                    {c.max_discount && <div className="text-slate-500 text-xs">Max ₹{c.max_discount}</div>}
                  </Td>
                  <Td className="text-xs text-slate-300">₹{c.min_amount || 0}</Td>
                  <Td className="text-xs">
                    <span className="text-white">{c.used_count || 0}</span>
                    {c.usage_limit && <span className="text-slate-500">/{c.usage_limit}</span>}
                  </Td>
                  <Td className="text-xs text-slate-400">User {c.per_user_limit || 'Unlimited'} / Device {c.per_device_limit || 'Unlimited'} / Seats {c.max_seats || 'Unlimited'}</Td>
                  <Td className="text-xs text-slate-400">{c.end_date ? new Date(c.end_date).toLocaleDateString() : 'No expiry'}</Td>
                  <Td><StatusBadge status={c.status} /></Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openUsages(c)}><History size={13} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Edit2 size={13} /></Button>
                      <Button variant="danger" size="sm" onClick={() => setDeleteTarget(c)}><Trash2 size={13} /></Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
            <Pagination page={page} pages={pagination.pages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} />
          </>
        )}
      </Card>
      <Modal
        open={showModal}
        size="lg"
        onClose={() => setShowModal(false)}
        title={editCoupon ? 'Edit Coupon' : 'Create Coupon'}
        footer={<><Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>{editCoupon ? 'Update' : 'Create'}</Button></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <Input label="Coupon Code" value={form.code} onChange={f('code')} placeholder="WELCOME20" required className="col-span-2" />
          <div className="space-y-1.5"><label className="block text-xs font-medium text-slate-400">Discount Type</label>
            <Select value={form.code_type} onChange={f('code_type')} options={[{ value: 'FLAT', label: 'Flat (₹)' }, { value: 'PERCENTAGE', label: 'Percent (%)' }]} /></div>
          <Input label={form.code_type === 'FLAT' ? 'Amount (₹)' : 'Percentage (%)'} type="number" value={form.amount} onChange={f('amount')} required />
          {form.code_type === 'PERCENTAGE' && <Input label="Max Discount (₹)" type="number" value={form.max_discount} onChange={f('max_discount')} />}
          <Input label="Min Order (₹)" type="number" value={form.min_amount} onChange={f('min_amount')} />
          <Input label="Usage Limit" type="number" value={form.usage_limit} onChange={f('usage_limit')} placeholder="Unlimited" />
          <Input label="Per User Limit" type="number" value={form.per_user_limit} onChange={f('per_user_limit')} />
          <Input label="Per Device Limit" type="number" value={form.per_device_limit} onChange={f('per_device_limit')} placeholder="Unlimited" />
          <Input label="Max Seats Per Booking" type="number" value={form.max_seats} onChange={f('max_seats')} placeholder="Unlimited" />
          <Input label="Start Date" type="date" value={form.start_date} onChange={f('start_date')} />
          <Input label="End Date" type="date" value={form.end_date} onChange={f('end_date')} />
          <div className="space-y-1.5"><label className="block text-xs font-medium text-slate-400">Status</label>
            <Select value={form.status} onChange={f('status')} options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }, { value: 'Expired', label: 'Expired' }]} /></div>
          <Input label="Description" value={form.description} onChange={f('description')} placeholder="Coupon description" className="col-span-2" />
        </div>
      </Modal>

      <Modal
        open={!!usageCoupon}
        size="xl"
        onClose={() => setUsageCoupon(null)}
        title={`Coupon Usages & Redemption History · ${usageCoupon?.code || ''}`}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Total Times Redeemed</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">
                {usagePagination.total} <span className="text-xs text-slate-400 font-normal">used</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteTarget(usageCoupon)}
              >
                <Trash2 size={13} />
                Delete Coupon & All Usages
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SearchInput
              value={usageSearch}
              onChange={(val) => {
                setUsageSearch(val);
                loadUsages(usageCoupon, 1, val);
              }}
              placeholder="Search passenger name or mobile number..."
              className="w-full sm:w-80"
            />
            {usageSearch && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setUsageSearch('');
                  loadUsages(usageCoupon, 1, '');
                }}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="max-h-[65vh] overflow-auto">
            {usagesLoading ? (
              <div className="py-12 text-center text-sm text-slate-400">Loading coupon usage records...</div>
            ) : usages.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">
                {usageSearch ? `No users matching "${usageSearch}" found for this coupon.` : 'No bookings have used this coupon.'}
              </div>
            ) : (
              <Table headers={['Passenger', 'Mobile', 'User ID', 'Booking', 'Discount', 'Used At', 'Action']}>
                {usages.map((usage) => {
                  const passengerName = usage.passenger?.name || usage.booking?.passenger_name || 'Passenger';
                  const passengerMobile = usage.passenger?.mobile || usage.booking?.passenger_mobile || '—';
                  return (
                    <Tr key={usage.id}>
                      <Td>
                        <div className="text-slate-900 dark:text-white text-sm font-semibold">{passengerName}</div>
                      </Td>
                      <Td>
                        <div className="text-xs text-slate-700 dark:text-slate-300 font-mono">{passengerMobile}</div>
                      </Td>
                      <Td className="text-xs text-slate-500 dark:text-slate-400 font-mono">{usage.passenger_id || '—'}</Td>
                      <Td className="text-xs text-slate-700 dark:text-slate-300">
                        <div className="font-mono font-medium">{usage.booking?.booking_reference || `#${usage.booking_id}`}</div>
                        {usage.booking?.travel_date && (
                          <div className="text-[11px] text-slate-500">{usage.booking.travel_date}</div>
                        )}
                      </Td>
                      <Td className="text-xs text-emerald-600 dark:text-emerald-400 font-bold font-mono">₹{usage.discount_amount}</Td>
                      <Td className="text-xs text-slate-500 dark:text-slate-400">{new Date(usage.created_at).toLocaleString()}</Td>
                      <Td>
                        <Button
                          variant="danger"
                          size="sm"
                          title="Delete this usage record"
                          onClick={() => setDeleteUsageTarget(usage)}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
            {!usagesLoading && usagePagination.pages > 1 && (
              <Pagination
                page={usagePage}
                pages={usagePagination.pages}
                total={usagePagination.total}
                limit={usagePagination.limit}
                onPageChange={(nextPage) => loadUsages(usageCoupon, nextPage, usageSearch)}
              />
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Coupon & Reset Usage"
        message={`Are you sure you want to delete coupon "${deleteTarget?.code}"? Deleting this coupon will permanently remove it, delete its usage records, and automatically cancel all active bookings that redeemed this coupon.`}
        loading={deleting}
      />

      <ConfirmDialog
        open={!!deleteUsageTarget}
        onClose={() => setDeleteUsageTarget(null)}
        onConfirm={handleDeleteUsage}
        title="Delete Coupon Usage"
        message={`Delete this usage record (#${deleteUsageTarget?.id}) for passenger "${deleteUsageTarget?.passenger?.name || deleteUsageTarget?.booking?.passenger_name || 'Passenger'}"? This will delete the entry from coupon_usages in the database and reduce the coupon used count.`}
        loading={deletingUsage}
      />
    </div>
  );
};
