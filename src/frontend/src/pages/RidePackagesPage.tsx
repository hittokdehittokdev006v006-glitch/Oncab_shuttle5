import React, { useState, useEffect, useCallback, useRef } from 'react';
import { packagesAPI, routesAPI } from '../services/api';
import {
  Card,
  Table,
  Tr,
  Td,
  SearchInput,
  Button,
  Select,
  StatusBadge,
  Modal,
  Input,
  ConfirmDialog,
  ErrorState
} from '../components/ui';
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  Package,
  Sparkles,
  CheckCircle2,
  XCircle,
  Percent,
  Calendar,
  Layers,
} from 'lucide-react';
import { RidePackage } from '../types';

interface RidePackagesPageProps {
  onNotify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const RidePackagesPage: React.FC<RidePackagesPageProps> = ({
  onNotify = () => {}
}) => {
  const [packages, setPackages] = useState<RidePackage[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modals & Form
  const [showModal, setShowModal] = useState(false);
  const [editPackage, setEditPackage] = useState<RidePackage | null>(null);
  const [viewPackage, setViewPackage] = useState<RidePackage | null>(null);
  const [loadingView, setLoadingView] = useState(false);
  const viewRequestId = useRef(0);
  const [deleteTarget, setDeleteTarget] = useState<RidePackage | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form State
  const [form, setForm] = useState({
    name: '',
    package_code: '',
    package_type: 'fixed_bundle',
    rides_count: '10',
    validity_days: '30',
    price_per_ride: '80',
    total_price: '800',
    original_price: '1000',
    discount_percentage: '20',
    route_id: '',
    description: '',
    featuresText: 'Guaranteed AC Seat\nValid for all weekdays\nFree stop rescheduling',
    badge_text: 'Popular Saver',
    is_popular: false,
    status: 'Active',
  });

  const fetchPackages = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const resp = await packagesAPI.list({ status: statusFilter });
      const list = Array.isArray(resp.data?.data)
        ? resp.data.data
        : (Array.isArray(resp.data) ? resp.data : []);
      setPackages(list);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load ride packages');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchRoutes = async () => {
    try {
      if (routesAPI?.list) {
        const resp = await routesAPI.list({ limit: 100 });
        const rList = Array.isArray(resp.data?.data) ? resp.data.data : [];
        setRoutes(rList);
      }
    } catch {
      // ignore route load error
    }
  };

  useEffect(() => {
    fetchPackages();
    fetchRoutes();
  }, [fetchPackages]);

  // Recalculate discount percentage automatically when total_price or original_price changes
  const handlePriceChange = (field: 'total_price' | 'original_price', value: string) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      const tot = parseFloat(field === 'total_price' ? value : next.total_price) || 0;
      const orig = parseFloat(field === 'original_price' ? value : next.original_price) || 0;
      const rides = parseInt(next.rides_count, 10) || 1;

      if (field === 'total_price' && tot > 0 && rides > 0) {
        next.price_per_ride = (tot / rides).toFixed(2);
      }
      if (orig > tot && orig > 0) {
        next.discount_percentage = String(Math.round(((orig - tot) / orig) * 100));
      }
      return next;
    });
  };

  const handleRidesCountChange = (value: string) => {
    setForm(prev => {
      const next = { ...prev, rides_count: value };
      const tot = parseFloat(next.total_price) || 0;
      const rides = parseInt(value, 10) || 1;
      if (tot > 0 && rides > 0) {
        next.price_per_ride = (tot / rides).toFixed(2);
      }
      return next;
    });
  };

  const openCreate = () => {
    setEditPackage(null);
    setForm({
      name: '',
      package_code: `RP-${Date.now().toString(36).toUpperCase().slice(-5)}`,
      package_type: 'fixed_bundle',
      rides_count: '10',
      validity_days: '30',
      price_per_ride: '85',
      total_price: '850',
      original_price: '1100',
      discount_percentage: '23',
      route_id: '',
      description: 'Commuter saver pass with guaranteed seat reservations',
      featuresText: 'Guaranteed AC Seat\nValid for all weekdays\nFree stop rescheduling',
      badge_text: 'Saver Pass',
      is_popular: false,
      status: 'Active',
    });
    setShowModal(true);
  };

  const openEdit = (pkg: RidePackage) => {
    setEditPackage(pkg);
    const feats = Array.isArray(pkg.features)
      ? pkg.features.join('\n')
      : (typeof pkg.features === 'string' ? pkg.features : '');

    setForm({
      name: pkg.name || '',
      package_code: pkg.package_code || '',
      package_type: pkg.package_type || 'fixed_bundle',
      rides_count: String(pkg.rides_count || 10),
      validity_days: String(pkg.validity_days || 30),
      price_per_ride: String(pkg.price_per_ride || 0),
      total_price: String(pkg.total_price || 0),
      original_price: String(pkg.original_price || ''),
      discount_percentage: String(pkg.discount_percentage || 0),
      route_id: pkg.route_id ? String(pkg.route_id) : '',
      description: pkg.description || '',
      featuresText: feats,
      badge_text: pkg.badge_text || '',
      is_popular: Boolean(pkg.is_popular),
      status: pkg.status || 'Active',
    });
    setShowModal(true);
  };

  const handleView = async (pkg: RidePackage) => {
    const requestId = ++viewRequestId.current;
    setViewPackage(pkg);
    setLoadingView(true);
    try {
      const response = await packagesAPI.show(pkg.id);
      const details = response.data?.data;
      if (!details) {
        throw new Error('Package details were missing from the server response');
      }
      if (requestId !== viewRequestId.current) return;
      setViewPackage(details);
    } catch (err: any) {
      if (requestId !== viewRequestId.current) return;
      setViewPackage(null);
      onNotify(err.response?.data?.message || err.message || 'Failed to load package details', 'error');
    } finally {
      if (requestId === viewRequestId.current) setLoadingView(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      onNotify('Package name is required', 'error');
      return;
    }
    if (!form.total_price || parseFloat(form.total_price) <= 0) {
      onNotify('Total package price must be greater than zero', 'error');
      return;
    }

    setSaving(true);
    try {
      const featuresArray = form.featuresText
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean);

      const payload = {
        name: form.name.trim(),
        package_code: form.package_code.trim(),
        package_type: form.package_type,
        rides_count: parseInt(form.rides_count, 10) || 1,
        validity_days: parseInt(form.validity_days, 10) || 30,
        price_per_ride: parseFloat(form.price_per_ride) || 0,
        total_price: parseFloat(form.total_price) || 0,
        original_price: form.original_price ? parseFloat(form.original_price) : null,
        discount_percentage: parseFloat(form.discount_percentage) || 0,
        route_id: form.route_id ? Number(form.route_id) : null,
        description: form.description.trim() || null,
        features: featuresArray,
        badge_text: form.badge_text.trim() || null,
        is_popular: Boolean(form.is_popular),
        status: form.status,
      };

      if (editPackage) {
        await packagesAPI.update(editPackage.id, payload);
        onNotify(`Ride Pack "${payload.name}" updated successfully`);
      } else {
        await packagesAPI.create(payload);
        onNotify(`New Ride Pack "${payload.name}" created successfully`);
      }
      setShowModal(false);
      fetchPackages();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to save package', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (pkg: RidePackage) => {
    try {
      await packagesAPI.toggleStatus(pkg.id);
      const newStatus = (pkg.status || '').toLowerCase() === 'active' ? 'Inactive' : 'Active';
      onNotify(`Package "${pkg.name}" is now ${newStatus}`);
      fetchPackages();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to toggle status', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await packagesAPI.delete(deleteTarget.id);
      onNotify(`Package "${deleteTarget.name}" deleted successfully`);
      setDeleteTarget(null);
      fetchPackages();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to delete package', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Filter packages by search query
  const filteredPackages = packages.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.package_code || '').toLowerCase().includes(q) ||
      (p.badge_text || '').toLowerCase().includes(q)
    );
  });

  const HEADERS = [
    'Package Code & Name',
    'Type',
    'Rides',
    'Validity',
    'Per Ride',
    'Total Price',
    'Route Scope',
    'Popular',
    'Status',
    'Actions'
  ];

  const totalActive = packages.filter(p => (p.status || '').toLowerCase() === 'active').length;
  const totalPopular = packages.filter(p => p.is_popular).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 text-cyan-400">
              <Package size={22} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                Ride Packages (Oncab → Ride Pack)
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Fixed-Price Commuter Bundles
                </span>
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">
                Manage discounted multi-ride packages, validity, per-ride pricing, and route rules.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            onClick={openCreate}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold shadow-lg shadow-cyan-500/20"
          >
            <Plus size={16} className="mr-1.5" />
            Create Ride Pack
          </Button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Packages</p>
            <p className="text-2xl font-bold text-white mt-1">{packages.length}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Layers size={18} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Active for Commuters</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{totalActive}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 size={18} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Featured / Popular</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{totalPopular}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Sparkles size={18} />
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by package name, code, or badge..."
          />
        </div>

        <div className="w-44">
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'Active', label: 'Active Only' },
              { value: 'Inactive', label: 'Inactive' },
            ]}
          />
        </div>
      </div>

      {/* Main Table */}
      <Card padding={false} className="border-slate-800/80 bg-slate-900/70 overflow-hidden shadow-xl">
        {error ? (
          <ErrorState message={error} onRetry={fetchPackages} />
        ) : (
          <Table
            headers={HEADERS}
            loading={loading}
            empty={!loading && filteredPackages.length === 0}
            emptyMessage="No ride packages found. Click 'Create Ride Pack' to add one."
          >
            {filteredPackages.map((pkg) => {
              const isActive = (pkg.status || '').toLowerCase() === 'active';
              const price = Number(pkg.total_price);
              const perRide = Number(pkg.price_per_ride);
              const orig = pkg.original_price != null ? Number(pkg.original_price) : null;
              const discount = orig && orig > price ? Math.round(((orig - price) / orig) * 100) : pkg.discount_percentage;

              return (
                <Tr key={pkg.id} className="hover:bg-slate-800/40 transition-colors">
                  {/* Name & Code */}
                  <Td>
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 flex-shrink-0 mt-0.5">
                        <Package size={14} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{pkg.name}</span>
                          {pkg.badge_text && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {pkg.badge_text}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-mono text-cyan-400 mt-0.5">{pkg.package_code}</p>
                      </div>
                    </div>
                  </Td>

                  {/* Type */}
                  <Td>
                    <span className="text-xs capitalize font-medium text-slate-300 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
                      {(pkg.package_type || 'bundle').replace('_', ' ')}
                    </span>
                  </Td>

                  {/* Rides Count */}
                  <Td>
                    <span className="font-bold text-white text-sm">{pkg.rides_count}</span>
                    <span className="text-xs text-slate-400 ml-1">rides</span>
                  </Td>

                  {/* Validity */}
                  <Td>
                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                      <Calendar size={13} className="text-slate-400" />
                      <span>{pkg.validity_days} days</span>
                    </div>
                  </Td>

                  {/* Per Ride */}
                  <Td>
                    <span className="font-semibold text-emerald-400 text-sm">₹{perRide}</span>
                    <span className="text-[11px] text-slate-400">/ride</span>
                  </Td>

                  {/* Total Price & Savings */}
                  <Td>
                    <div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-bold text-white text-base">₹{price}</span>
                        {orig && orig > price && (
                          <span className="text-xs text-slate-500 line-through">₹{orig}</span>
                        )}
                      </div>
                      {discount > 0 && (
                        <p className="text-[11px] font-semibold text-emerald-400">Save {discount}%</p>
                      )}
                    </div>
                  </Td>

                  {/* Route Scope */}
                  <Td>
                    {pkg.route_id ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        Route #{pkg.route_id}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        Global (All Routes)
                      </span>
                    )}
                  </Td>

                  {/* Popular Star */}
                  <Td>
                    {pkg.is_popular ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                        <Sparkles size={11} />
                        Yes
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </Td>

                  {/* Status & Toggle */}
                  <Td>
                    <button
                      onClick={() => handleToggleStatus(pkg)}
                      title={`Click to ${isActive ? 'deactivate' : 'activate'}`}
                      className="cursor-pointer transition-transform hover:scale-105"
                    >
                      <StatusBadge status={isActive ? 'Active' : 'Inactive'} />
                    </button>
                  </Td>

                  {/* Actions */}
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleView(pkg)}
                        className="text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 p-1.5"
                        title="View Package"
                      >
                        <Eye size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(pkg)}
                        className="text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 p-1.5"
                        title="Edit Package"
                      >
                        <Edit2 size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(pkg)}
                        className="text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 p-1.5"
                        title="Delete Package"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Create / Edit Package Modal */}
      {showModal && (
        <Modal
          open={showModal}
          title={editPackage ? `Edit Ride Pack: ${editPackage.name}` : 'Create New Ride Pack'}
          onClose={() => setShowModal(false)}
        >
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Package Name *
                </label>
                <Input
                  value={form.name}
                  onChange={(value) => setForm(prev => ({ ...prev, name: value }))}
                  placeholder="e.g., Weekly Commuter Pack"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Package Code (Unique identifier) *
                </label>
                <Input
                  value={form.package_code}
                  onChange={(value) => setForm(prev => ({ ...prev, package_code: value }))}
                  placeholder="e.g., RP-WEEKLY-10"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Package Type
                </label>
                <Select
                  value={form.package_type}
                  onChange={(v) => setForm(prev => ({ ...prev, package_type: v }))}
                  options={[
                    { value: 'single_trip', label: 'Single Trip' },
                    { value: 'fixed_bundle', label: 'Fixed Bundle' },
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'quarterly', label: 'Quarterly' },
                    { value: 'annual', label: 'Annual' },
                  ]}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Total Rides Count *
                </label>
                <Input
                  type="number"
                  min="1"
                  value={form.rides_count}
                  onChange={handleRidesCountChange}
                  placeholder="e.g. 10"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Validity (in Days) *
                </label>
                <Input
                  type="number"
                  min="1"
                  value={form.validity_days}
                  onChange={(value) => setForm(prev => ({ ...prev, validity_days: value }))}
                  placeholder="e.g. 14 or 30"
                />
              </div>
            </div>

            {/* Pricing Section */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/50 space-y-3">
              <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Percent size={13} />
                Pricing & Savings Calculation
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Total Package Price (₹) *
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    value={form.total_price}
                    onChange={(value) => handlePriceChange('total_price', value)}
                    placeholder="e.g. 990"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Standard / Original Fare (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.original_price}
                    onChange={(value) => handlePriceChange('original_price', value)}
                    placeholder="e.g. 1200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Computed Per-Ride Rate (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.price_per_ride}
                    onChange={(value) => setForm(prev => ({ ...prev, price_per_ride: value }))}
                    placeholder="e.g. 99"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <span>
                  Calculated Commuter Discount:{' '}
                  <strong className="text-emerald-400">{form.discount_percentage}% OFF</strong>
                </span>
                <span>
                  Effective Commuter Fare:{' '}
                  <strong className="text-cyan-400">₹{form.price_per_ride} per ride</strong>
                </span>
              </div>
            </div>

            {/* Route & Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Route Scope (Optional)
                </label>
                <Select
                  value={form.route_id}
                  onChange={(v) => setForm(prev => ({ ...prev, route_id: v }))}
                  options={[
                    { value: '', label: 'Global (All Shuttle Routes)' },
                    ...routes.map(r => ({
                      value: String(r.id),
                      label: `${r.route_name || r.name} (#${r.id})`
                    }))
                  ]}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Badge Text (Callout banner)
                </label>
                <Input
                  value={form.badge_text}
                  onChange={(value) => setForm(prev => ({ ...prev, badge_text: value }))}
                  placeholder="e.g. 18% OFF, Most Popular, Best Value"
                />
              </div>
            </div>

            {/* Status & Popular Checkbox */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Status
                </label>
                <Select
                  value={form.status}
                  onChange={(v) => setForm(prev => ({ ...prev, status: v }))}
                  options={[
                    { value: 'Active', label: 'Active (Visible for Commuters)' },
                    { value: 'Inactive', label: 'Inactive / Hidden' },
                  ]}
                />
              </div>

              <div className="pt-5">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.is_popular}
                    onChange={(e) => setForm(prev => ({ ...prev, is_popular: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span>Mark as "Most Popular" on Booking Screen</span>
                </label>
              </div>
            </div>

            {/* Features list */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Included Features / Perks (One per line)
              </label>
              <textarea
                rows={3}
                value={form.featuresText}
                onChange={(e) => setForm(prev => ({ ...prev, featuresText: e.target.value }))}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                placeholder="Guaranteed AC Seat&#10;Valid for all morning and evening schedules&#10;Free stop rescheduling"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Description (Optional)
              </label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                placeholder="Commuter saver pass designed for daily office travel..."
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <Button
                variant="outline"
                onClick={() => setShowModal(false)}
                className="text-slate-400 border-slate-700"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                loading={saving}
                className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
              >
                {editPackage ? 'Update Ride Pack' : 'Create Ride Pack'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <Modal
        open={Boolean(viewPackage)}
        title={viewPackage ? `Ride Pack: ${viewPackage.name}` : 'Ride Pack Details'}
        onClose={() => {
          viewRequestId.current += 1;
          setLoadingView(false);
          setViewPackage(null);
        }}
        size="md"
      >
        {loadingView || !viewPackage ? (
          <p className="text-sm text-slate-400">Loading package details...</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{viewPackage.name}</h3>
                <p className="font-mono text-xs text-cyan-400">{viewPackage.package_code}</p>
              </div>
              <StatusBadge status={viewPackage.status} />
            </div>
            {viewPackage.description && (
              <p className="text-sm text-slate-300">{viewPackage.description}</p>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-400">Type</span><p className="capitalize text-white">{viewPackage.package_type.replace(/_/g, ' ')}</p></div>
              <div><span className="text-slate-400">Route</span><p className="text-white">{viewPackage.route_id ? `Route #${viewPackage.route_id}` : 'All routes'}</p></div>
              <div><span className="text-slate-400">Rides</span><p className="text-white">{viewPackage.rides_count}</p></div>
              <div><span className="text-slate-400">Validity</span><p className="text-white">{viewPackage.validity_days} days</p></div>
              <div><span className="text-slate-400">Package price</span><p className="text-white">₹{Number(viewPackage.total_price).toFixed(2)}</p></div>
              <div><span className="text-slate-400">Price per ride</span><p className="text-white">₹{Number(viewPackage.price_per_ride).toFixed(2)}</p></div>
              <div><span className="text-slate-400">Original price</span><p className="text-white">{viewPackage.original_price != null ? `₹${Number(viewPackage.original_price).toFixed(2)}` : '—'}</p></div>
              <div><span className="text-slate-400">Discount</span><p className="text-white">{Number(viewPackage.discount_percentage || 0)}%</p></div>
            </div>
            {viewPackage.features?.length ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Included features</p>
                <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
                  {viewPackage.features.map((feature, index) => <li key={`${index}-${feature}`}>{feature}</li>)}
                </ul>
              </div>
            ) : null}
            {viewPackage.badge_text && <p className="text-sm text-amber-300">Badge: {viewPackage.badge_text}</p>}
            <p className="text-xs text-slate-500">
              {viewPackage.is_popular ? 'Featured as popular' : 'Not featured'} · Created {viewPackage.created_at ? new Date(viewPackage.created_at).toLocaleString() : '—'}
            </p>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          title={`Delete Ride Pack: ${deleteTarget.name}?`}
          message={`Are you sure you want to delete "${deleteTarget.name}" (${deleteTarget.package_code})? Existing bookings will retain their historical snapshots, but this package will no longer be available for new bookings.`}
          confirmLabel="Yes, Delete Package"
          variant="danger"
          loading={deleting}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
};
