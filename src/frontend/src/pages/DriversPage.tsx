import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Edit2, Trash2, Phone, Mail, MapPin, Upload, Image, CheckCircle2, X, Eye, FileText, Users, UserCheck, Shield, Bus, Filter, RotateCcw } from 'lucide-react';
import { driversAPI, rolesAPI, vehiclesAPI, usersAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, Table, Tr, Td, Pagination, SearchInput, Button, Select, StatusBadge, Modal, ConfirmDialog, LoadingState, ErrorState, EmptyState, Badge } from '../components/ui';
import { hasRole } from '../utils/roles';

interface Driver {
  id: number;
  name: string;
  email: string;
  mobile: string;
  driver_user_id: string;
  vehicle_type_id?: number | null;
  is_bus_driver?: boolean;
  preferred_bus_type_id?: number | null;
  status: string;
  online_status: string;
  block_status: string;
  complete_status: string;
  sex: string;
  aadhar: string;
  pan: string;
  address: string;
  owner_id?: number | null;
  owner?: {
    id: number;
    name: string;
    email: string;
    phone?: string;
  } | null;
  created_at: string;
  details?: any;
}

interface DriversPageProps {
  onNotify: (msg: string, type?: any) => void;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'Approve', label: 'Approved' },
  { value: 'Disapprove', label: 'Disapproved' },
  { value: 'Reject', label: 'Rejected' },
  { value: 'Pending', label: 'Pending' },
];

const ONLINE_OPTIONS = [
  { value: '', label: 'All Online Status' },
  { value: 'Online', label: 'Online' },
  { value: 'Offline', label: 'Offline' },
];

const DOC_STATUS_OPTIONS = [
  { value: '', label: 'All Doc Status' },
  { value: 'Complete', label: 'Complete' },
  { value: 'Incomplete', label: 'Incomplete' },
];

const DRIVER_TYPE_OPTIONS = [
  { value: '', label: 'All Driver Types' },
  { value: 'true', label: 'Bus Drivers Only' },
  { value: 'false', label: 'Non-Bus Drivers' },
];

export const DriversPage: React.FC<DriversPageProps> = ({ onNotify }) => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [onlineFilter, setOnlineFilter] = useState('');
  const [docFilter, setDocFilter] = useState('');
  const [driverTypeFilter, setDriverTypeFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });
  const [busTypes, setBusTypes] = useState<Array<{ id: number; name: string }>>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownersLoadError, setOwnersLoadError] = useState('');
  const latestFetchId = useRef(0);
  const { user } = useAuth();
  const isOwner = hasRole(user, 'owner');

  const [showModal, setShowModal] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Driver | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Lightbox preview for full document image viewer
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  // Form matching requested fields:
  // Full Name, Mobile, Email, Gender, Aadhar Number, Aadhar Photo, Driving License Number, Driving License Photo, Address, Status
  const [form, setForm] = useState({
    name: '',
    email: '',
    mobile: '',
    sex: 'Male',
    aadhar: '',
    aadhar_img: '',
    pan: '',
    pan_img: '',
    address: '',
    status: 'Pending',
    complete_status: 'Incomplete',
    is_bus_driver: false,
    preferred_bus_type_id: '',
    owner_id: '',
  });

  const fetchDrivers = useCallback(async () => {
    const fetchId = ++latestFetchId.current;
    try {
      setLoading(true);
      setError('');
      const params: any = { page, limit: 15, search };
      if (statusFilter) params.status = statusFilter;
      if (onlineFilter) params.online_status = onlineFilter;
      if (docFilter) params.complete_status = docFilter;
      if (driverTypeFilter !== '') params.is_bus_driver = driverTypeFilter;
      if (ownerFilter && !isOwner) params.owner_id = ownerFilter;

      const resp = await driversAPI.list(params);
      if (fetchId !== latestFetchId.current) return;
      setDrivers(resp.data.data || []);
      setPagination(resp.data.pagination || { total: 0, pages: 1, limit: 15 });
    } catch (err: any) {
      if (fetchId !== latestFetchId.current) return;
      setError(err.response?.data?.message || 'Failed to load drivers');
    } finally {
      if (fetchId === latestFetchId.current) setLoading(false);
    }
  }, [page, search, statusFilter, onlineFilter, docFilter, driverTypeFilter, ownerFilter, isOwner]);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  useEffect(() => {
    vehiclesAPI.busTypes()
      .then((response) => setBusTypes(response.data.data || []))
      .catch(() => setBusTypes([]));

    if (!isOwner) {
      const loadOwners = async () => {
        setOwnersLoading(true);
        setOwnersLoadError('');
        try {
          let ownerRoleId: number | undefined;
          try {
            const rolesResponse = await rolesAPI.list();
            const ownerRole = (rolesResponse.data.data || []).find((role: any) => role.name?.toLowerCase() === 'owner');
            ownerRoleId = ownerRole ? Number(ownerRole.id) : undefined;
          } catch {
            // The users response also includes the role for fallback matching.
          }

          const fetchUserPages = async (roleId?: number) => {
            const firstPage = await usersAPI.list({ page: 1, limit: 100, ...(roleId ? { role_id: roleId } : {}) });
            const pages = Number(firstPage.data.pagination?.pages || 1);
            const remainingPages = await Promise.all(
              Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
                usersAPI.list({ page: index + 2, limit: 100, ...(roleId ? { role_id: roleId } : {}) })
              )
            );
            return [
              ...(firstPage.data.data || []),
              ...remainingPages.flatMap((response) => response.data.data || []),
            ];
          };

          let ownerUsers = ownerRoleId
            ? await fetchUserPages(ownerRoleId)
            : (await fetchUserPages()).filter((entry: any) => entry.role?.name?.toLowerCase() === 'owner');

          if (ownerRoleId && ownerUsers.length === 0) {
            ownerUsers = (await fetchUserPages()).filter((entry: any) =>
              entry.role?.name?.toLowerCase() === 'owner' || Number(entry.role_id) === ownerRoleId
            );
          }

          setOwners(ownerUsers);
        } catch (error: any) {
          setOwners([]);
          setOwnersLoadError(error.response?.data?.message || 'Could not load owner users');
        } finally {
          setOwnersLoading(false);
        }
      };

      loadOwners();
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, onlineFilter, docFilter, driverTypeFilter, ownerFilter]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusFilter) count++;
    if (onlineFilter) count++;
    if (docFilter) count++;
    if (driverTypeFilter !== '') count++;
    if (ownerFilter) count++;
    return count;
  }, [search, statusFilter, onlineFilter, docFilter, driverTypeFilter, ownerFilter]);

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('');
    setOnlineFilter('');
    setDocFilter('');
    setDriverTypeFilter('');
    setOwnerFilter('');
    setPage(1);
  };

  const HEADERS = [
    'Driver',
    ...(!isOwner ? ['Owner'] : []),
    'Mobile / Email',
    'Aadhar / Driving License',
    'Documents',
    'Doc Status',
    'Status',
    'Online',
    'Block',
    'Joined',
    'Actions',
  ];

  const ownerOptions = [
    { value: '', label: 'All Owners' },
    ...owners.map((o: any) => ({
      value: String(o.id),
      label: o.name + (o.phone ? ` (${o.phone})` : ''),
    })),
  ];

  const openCreate = () => {
    setEditDriver(null);
    setForm({
      name: '',
      email: '',
      mobile: '',
      sex: 'Male',
      aadhar: '',
      aadhar_img: '',
      pan: '',
      pan_img: '',
      address: '',
      status: 'Pending',
      complete_status: 'Incomplete',
      is_bus_driver: false,
      preferred_bus_type_id: '',
      owner_id: isOwner ? String(user?.id || '') : '',
    });
    setShowModal(true);
  };

  const openEdit = (d: Driver) => {
    setEditDriver(d);
    setForm({
      name: d.name || '',
      email: d.email || '',
      mobile: d.mobile || '',
      sex: d.sex || 'Male',
      aadhar: d.aadhar || d.details?.aadhar || '',
      aadhar_img: d.details?.aadhar_img || '',
      pan: d.pan || d.details?.smart_card_number || '',
      pan_img: d.details?.smart_card_img || '',
      address: d.address || '',
      status: d.status || 'Pending',
      complete_status: d.complete_status || 'Incomplete',
      is_bus_driver: Boolean(d.is_bus_driver),
      preferred_bus_type_id: d.preferred_bus_type_id ? String(d.preferred_bus_type_id) : '',
      owner_id: isOwner ? String(user?.id || '') : String(d.owner_id || ''),
    });
    setShowModal(true);
  };

  const handleFileUpload = (field: 'aadhar_img' | 'pan_img') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (file) {
      const reader = new FileReader();

      reader.onloadend = () => {
        setForm((prev) => ({
          ...prev,
          [field]: reader.result as string,
        }));
      };

      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.mobile) {
      onNotify('Full Name and Mobile are required', 'error');
      return;
    }
    if (isOwner && !user?.id) {
      onNotify('Owner context is missing', 'error');
      return;
    }
    if (!isOwner && !form.owner_id) {
      onNotify('Please select an owner for this driver', 'error');
      return;
    }
    if (form.is_bus_driver && !form.preferred_bus_type_id) {
      onNotify('Select a preferred bus type for this bus driver', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        owner_id: isOwner ? Number(user?.id) : Number(form.owner_id),
      };
      if (editDriver) {
        const response = await driversAPI.update(editDriver.id, payload);
        onNotify(response.data.message || 'Driver updated successfully');
      } else {
        const response = await driversAPI.create(payload);
        onNotify(response.data.message || 'Driver created successfully');
      }
      setShowModal(false);
      await fetchDrivers();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await driversAPI.delete(deleteTarget.id);
      onNotify('Driver deleted successfully');
      setDeleteTarget(null);
      fetchDrivers();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusUpdate = async (driver: Driver, field: string, value: string) => {
    try {
      await driversAPI.updateStatus(driver.id, { [field]: value });
      onNotify(`Driver status updated to ${value}`);
      fetchDrivers();
    } catch {
      onNotify('Failed to update status', 'error');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Driver Management</h2>
          <p className="text-slate-400 text-sm">{pagination.total} drivers registered</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={14} />
          Add New Driver
        </Button>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-700/60 bg-slate-850 p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Drivers</span>
            <span className="rounded-lg bg-indigo-500/10 p-1.5 text-indigo-400">
              <Users size={15} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-white tracking-tight">{pagination.total}</p>
          <p className="mt-0.5 text-xs text-slate-500">Matching criteria</p>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-850 p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Page Approved</span>
            <span className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-400">
              <UserCheck size={15} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight">
            {drivers.filter(d => d.status === 'Approve').length}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Approved in current view</p>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-850 p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Page Online</span>
            <span className="rounded-lg bg-cyan-500/10 p-1.5 text-cyan-400">
              <Shield size={15} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-cyan-400 tracking-tight">
            {drivers.filter(d => d.online_status === 'Online').length}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Currently active on duty</p>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-850 p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Bus Drivers</span>
            <span className="rounded-lg bg-amber-500/10 p-1.5 text-amber-400">
              <Bus size={15} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-400 tracking-tight">
            {drivers.filter(d => d.is_bus_driver).length}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Designated bus operators</p>
        </div>
      </div>

      {/* Advanced Multi-Dimensional Filter Bar */}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="sm:col-span-2 lg:col-span-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search driver, mobile, aadhar, DL, ID..."
            />
          </div>

          {!isOwner && (
            <div>
              <Select
                value={ownerFilter}
                onChange={setOwnerFilter}
                options={ownerOptions}
                placeholder="All Owners"
              />
            </div>
          )}

          <div>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_OPTIONS}
              placeholder="Approval Status"
            />
          </div>

          <div>
            <Select
              value={onlineFilter}
              onChange={setOnlineFilter}
              options={ONLINE_OPTIONS}
              placeholder="Online Status"
            />
          </div>

          <div>
            <Select
              value={docFilter}
              onChange={setDocFilter}
              options={DOC_STATUS_OPTIONS}
              placeholder="Doc Status"
            />
          </div>

          <div>
            <Select
              value={driverTypeFilter}
              onChange={setDriverTypeFilter}
              options={DRIVER_TYPE_OPTIONS}
              placeholder="Driver Type"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <Card padding={false}>
        {error ? (
          <ErrorState message={error} onRetry={fetchDrivers} />
        ) : (
          <>
            <Table
              headers={HEADERS}
              loading={loading}
              empty={!loading && drivers.length === 0}
              emptyMessage="No drivers found"
            >
              {drivers.map((driver) => {
                const aadharImg = driver.details?.aadhar_img;
                const panImg = driver.details?.smart_card_img;

                return (
                  <Tr key={driver.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                        >
                          {driver.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-white font-medium text-sm flex items-center gap-1.5">
                            <span>{driver.name}</span>
                            {driver.is_bus_driver && (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                Bus
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500 text-xs font-mono">
                            {driver.driver_user_id || `DRV-${driver.id}`} • {driver.sex || 'Male'}
                          </div>
                        </div>
                      </div>
                    </Td>
                    {!isOwner && (
                      <Td>
                        {driver.owner ? (
                          <div>
                            <div className="text-white text-xs font-medium">{driver.owner.name}</div>
                            <div className="text-slate-500 text-[11px] font-mono">{driver.owner.phone || driver.owner.email || '—'}</div>
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </Td>
                    )}
                    <Td>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <Phone size={11} className="text-indigo-400" />
                          <span>{driver.mobile || '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Mail size={11} />
                          <span>{driver.email || '—'}</span>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="space-y-0.5 font-mono text-xs">
                        <div className="text-slate-300">
                          <span className="text-slate-500 mr-1">UID:</span>
                          {driver.aadhar || driver.details?.aadhar || '—'}
                        </div>
                        <div className="text-slate-400">
                          <span className="text-slate-500 mr-1">Driving License:</span>
                          {driver.pan || driver.details?.smart_card_number || '—'}
                        </div>
                      </div>
                    </Td>
                    {/* Documents Thumbnail column with click-to-preview lightbox */}
                    <Td>
                      <div className="flex items-center gap-2">
                        {aadharImg ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewImage({
                                url: aadharImg,
                                title: `${driver.name} - Aadhar Document`,
                              })
                            }
                            className="group relative flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 border border-slate-700 hover:border-indigo-500 hover:bg-slate-750 transition-all text-xs text-slate-300"
                            title="Click to view full Aadhar Card"
                          >
                            <div className="w-5 h-5 rounded overflow-hidden bg-slate-900 border border-slate-700 flex-shrink-0 flex items-center justify-center">
                              <img
                                src={aadharImg}
                                alt="Aadhar"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  // Fallback if image data is truncated
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                              <FileText size={12} className="text-indigo-400" />
                            </div>
                            <span className="font-mono text-[11px] text-slate-200">Aadhar</span>
                            <Eye size={12} className="text-slate-400 group-hover:text-indigo-400 transition-colors" />
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-600">No Aadhar</span>
                        )}

                        {panImg ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewImage({
                                url: panImg,
                                title: `${driver.name} - Driving License Document`,
                              })
                            }
                            className="group relative flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 border border-slate-700 hover:border-indigo-500 hover:bg-slate-750 transition-all text-xs text-slate-300"
                            title="Click to view full Driving License"
                          >
                            <div className="w-5 h-5 rounded overflow-hidden bg-slate-900 border border-slate-700 flex-shrink-0 flex items-center justify-center">
                              <img
                                src={panImg}
                                alt="Driving License"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  // Fallback if image data is truncated
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                              <FileText size={12} className="text-cyan-400" />
                            </div>
                            <span className="font-mono text-[11px] text-slate-200">Driving License</span>
                            <Eye size={12} className="text-slate-400 group-hover:text-cyan-400 transition-colors" />
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-600">No Driving License</span>
                        )}
                      </div>
                    </Td>
                    {/* Document Status Column */}
                    <Td>
                      {isOwner ? (
                        <StatusBadge status={driver.complete_status || 'Incomplete'} />
                      ) : <button
                        onClick={() => handleStatusUpdate(driver, 'complete_status', driver.complete_status === 'Complete' ? 'Incomplete' : 'Complete')}
                        title="Click to toggle Complete / Incomplete document status">
                        <StatusBadge status={driver.complete_status || 'Incomplete'} />
                      </button>}
                    </Td>
                    <Td>
                      {isOwner ? <StatusBadge status={driver.status || 'Pending'} /> : <select
                        value={driver.status || 'Pending'}
                        onChange={(e) => handleStatusUpdate(driver, 'status', e.target.value)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer outline-none ${
                          driver.status === 'Approve'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : driver.status === 'Reject' || driver.status === 'Disapprove'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        <option value="Pending" className="bg-slate-900 text-white">Pending</option>
                        <option value="Approve" className="bg-slate-900 text-white">Approve</option>
                        <option value="Disapprove" className="bg-slate-900 text-white">Disapprove</option>
                        <option value="Reject" className="bg-slate-900 text-white">Reject</option>
                      </select>}
                    </Td>
                    <Td>
                      {isOwner ? <StatusBadge status={driver.online_status || 'Offline'} /> : <button
                        onClick={() =>
                          handleStatusUpdate(
                            driver,
                            'online_status',
                            driver.online_status === 'Online' ? 'Offline' : 'Online'
                          )
                        }
                        title="Click to toggle online/offline"
                      >
                        <StatusBadge status={driver.online_status || 'Offline'} />
                      </button>}
                    </Td>
                    <Td>
                      {isOwner ? <StatusBadge status={driver.block_status || 'Unblock'} /> : <button
                        onClick={() =>
                          handleStatusUpdate(
                            driver,
                            'block_status',
                            driver.block_status === 'Block' ? 'Unblock' : 'Block'
                          )
                        }
                        title="Click to toggle block status"
                      >
                        <StatusBadge status={driver.block_status || 'Unblock'} />
                      </button>}
                    </Td>
                    <Td className="text-xs text-slate-500 font-mono">
                      {driver.created_at ? new Date(driver.created_at).toLocaleDateString() : '—'}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(driver)}
                        >
                          <Edit2 size={13} className="text-slate-300" />
                        </Button>
                        {!isOwner && <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setDeleteTarget(driver)}
                        >
                          <Trash2 size={13} />
                        </Button>
                        }
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Table>
            <Pagination
              page={page}
              pages={pagination.pages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      {/* Add / Edit Driver Modal with Aadhar Photo, PAN No, PAN Photo */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl p-6 my-8 max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-lg font-semibold text-white">
                {editDriver ? 'Edit Driver' : 'Add New Driver'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSave} className="space-y-4 pt-4">
              {/* Full Name */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Driver's full name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Mobile & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Mobile <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="+91 9800000000"
                    value={form.mobile}
                    onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="driver@email.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-700/70 bg-slate-800/40 p-3.5 space-y-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.is_bus_driver}
                    onChange={(event) => setForm({
                      ...form,
                      is_bus_driver: event.target.checked,
                      preferred_bus_type_id: event.target.checked ? form.preferred_bus_type_id : '',
                    })}
                    className="h-4 w-4 accent-cyan-500"
                  />
                  Registered as bus driver
                </label>
                {form.is_bus_driver && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">Preferred Bus Type</label>
                    <select
                      required
                      value={form.preferred_bus_type_id}
                      onChange={(event) => setForm({ ...form, preferred_bus_type_id: event.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="">Select bus type</option>
                      {busTypes.map((busType) => <option key={busType.id} value={busType.id}>{busType.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {!isOwner && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Owner <span className="text-rose-500">*</span>
                  </label>
                  <select
                    required
                    value={form.owner_id}
                    onChange={(event) => setForm({ ...form, owner_id: event.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">
                      {ownersLoading ? 'Loading owners...' : ownersLoadError || (owners.length ? 'Select owner' : 'No owner users found')}
                    </option>
                    {owners.map((owner) => (
                      <option key={owner.id} value={String(owner.id)}>{owner.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Gender & Approval Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Gender</label>
                  <select
                    value={form.sex}
                    onChange={(e) => setForm({ ...form, sex: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Driver Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Approve">Approve (Active)</option>
                    <option value="Disapprove">Disapprove</option>
                    <option value="Reject">Reject</option>
                  </select>
                </div>
              </div>

              {/* Aadhar Number & Aadhar Photo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 bg-slate-800/50 border border-slate-700/60 rounded-xl">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Aadhar Number
                  </label>
                  <input
                    type="text"
                    placeholder="XXXX XXXX XXXX"
                    value={form.aadhar}
                    onChange={(e) => setForm({ ...form, aadhar: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Aadhar Photo (Card / Document)
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 border border-dashed border-slate-600 hover:border-indigo-500 rounded-lg text-xs text-slate-300 cursor-pointer transition-colors truncate">
                      <Upload size={14} className="text-indigo-400 flex-shrink-0" />
                      <span className="truncate">
                        {form.aadhar_img ? 'Change Aadhar' : 'Upload Aadhar Image'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileUpload('aadhar_img')}
                      />
                    </label>
                    {form.aadhar_img && (
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewImage({
                              url: form.aadhar_img,
                              title: `${form.name || 'Driver'} - Aadhar Document`,
                            })
                          }
                          className="w-10 h-10 rounded-lg overflow-hidden border border-emerald-500/60 flex-shrink-0 relative block"
                          title="Click to zoom image"
                        >
                          <img
                            src={form.aadhar_img}
                            alt="Aadhar"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye size={12} className="text-white" />
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* PAN Number & PAN Photo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 bg-slate-800/50 border border-slate-700/60 rounded-xl">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Driving License Number
                  </label>
                  <input
                    type="text"
                    placeholder="ABCDE1234F"
                    value={form.pan}
                    onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Driving License Photo (Card / Document)
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 border border-dashed border-slate-600 hover:border-indigo-500 rounded-lg text-xs text-slate-300 cursor-pointer transition-colors truncate">
                      <Upload size={14} className="text-indigo-400 flex-shrink-0" />
                      <span className="truncate">
                        {form.pan_img ? 'Change Driving License' : 'Upload Driving License Image'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileUpload('pan_img')}
                      />
                    </label>
                    {form.pan_img && (
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewImage({
                              url: form.pan_img,
                              title: `${form.name || 'Driver'} - Driving License Document`,
                            })
                          }
                          className="w-10 h-10 rounded-lg overflow-hidden border border-emerald-500/60 flex-shrink-0 relative block"
                          title="Click to zoom image"
                        >
                          <img
                            src={form.pan_img}
                            alt="Driving License"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye size={12} className="text-white" />
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Address</label>
                <textarea
                  rows={2}
                  placeholder="Full residential address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button variant="ghost" type="button" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  {editDriver ? 'Update Driver' : 'Create Driver'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Size Image Preview Modal (Lightbox) */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-2xl w-full bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <h4 className="text-sm font-semibold text-white">{previewImage.title}</h4>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex flex-col items-center justify-center bg-slate-950/80 rounded-xl p-4 min-h-[260px] max-h-[75vh] overflow-hidden">
              <img
                src={previewImage.url}
                alt="Document Preview"
                className="max-h-[65vh] max-w-full object-contain rounded-lg shadow-lg"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                  const fallback = document.getElementById('preview-error-fallback');
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
              <div
                id="preview-error-fallback"
                style={{ display: 'none' }}
                className="flex-col items-center justify-center text-center p-6 text-slate-400 gap-3"
              >
                <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-400">
                  <FileText size={24} />
                </div>
                <div className="text-white font-medium text-sm">Image Data Incomplete or Truncated</div>
                <p className="text-xs text-slate-400 max-w-xs">
                  This image was uploaded previously when database storage was limited to 255 characters. Please click <b>Edit Driver</b> and re-upload the full photo.
                </p>
              </div>
            </div>
            <div className="flex justify-between items-center pt-3 mt-2 border-t border-slate-800">
              <span className="text-[11px] text-slate-500">
                {previewImage.url.startsWith('data:') ? 'Base64 Encoded Image' : 'Remote File URL'}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setPreviewImage(null)}>
                Close Preview
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Driver"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
};
