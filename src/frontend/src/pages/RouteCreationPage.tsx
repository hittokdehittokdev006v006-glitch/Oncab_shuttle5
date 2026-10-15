import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, MapPin, ChevronRight, X, Copy, RefreshCw, Layers, CheckSquare, Square, AlertTriangle, Eye } from 'lucide-react';
import { routesAPI, stopsAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, SearchInput, Button, Select, StatusBadge, Modal, Input, ConfirmDialog, ErrorState, Badge } from '../components/ui';

interface RouteStopItem {
  id?: number;
  stop_id?: number;
  stop_name: string;
  latitude: string;
  longitude: string;
  stop_sequence: number;
  travel_time_minutes: string;
  address: string;
}

interface PhysicalStopSearchResult {
  stop_id: number;
  id: number;
  stop_name: string;
  name: string;
  stop_code?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  landmark?: string;
  usage_count: number;
}

interface Stop {
  id: number;
  stop_name: string;
  stop_sequence: number;
  travel_time_minutes?: number;
  stop_code?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

interface Route {
  id: number;
  route_name: string;
  route_code: string;
  origin_city: string;
  destination_city: string;
  total_distance: number;
  estimated_duration: number;
  description?: string;
  status: string;
  stops?: Stop[];
  created_at: string;
}

interface RouteCreationPageProps {
  onNotify: (msg: string, type?: any) => void;
}

export const RouteCreationPage: React.FC<RouteCreationPageProps> = ({ onNotify }) => {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });

  const [showModal, setShowModal] = useState(false);
  const [editRoute, setEditRoute] = useState<Route | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Route | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);

  // Stop Search state inside Route Editor
  const [existingStopQuery, setExistingStopQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PhysicalStopSearchResult[]>([]);
  const [searchingStops, setSearchingStops] = useState(false);

  // Bulk Add Stops Modal state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [availableMasterStops, setAvailableMasterStops] = useState<PhysicalStopSearchResult[]>([]);
  const [selectedStopIds, setSelectedStopIds] = useState<number[]>([]);

  // Create New Stop Inline Modal state
  const [showCreateStopInline, setShowCreateStopInline] = useState(false);
  const [newStopForm, setNewStopForm] = useState({
    stop_name: '',
    stop_code: '',
    latitude: '',
    longitude: '',
    address: '',
    landmark: '',
  });
  const [nearbyWarning, setNearbyWarning] = useState<any[]>([]);

  // Form matching Route parameters
  const [form, setForm] = useState({
    route_name: '',
    route_code: '',
    origin_city: '',
    destination_city: '',
    total_distance: '',
    estimated_duration: '',
    status: 'Active',
    description: '',
  });

  const [stopsList, setStopsList] = useState<RouteStopItem[]>([]);

  const fetchRoutes = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const resp = await routesAPI.list({ page, limit: 15, search, status: statusFilter });
      setRoutes(resp.data.data || []);
      setPagination(resp.data.pagination || { total: 0, pages: 1, limit: 15 });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load routes');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  // Search existing stops as user types
  useEffect(() => {
    if (!existingStopQuery || existingStopQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchingStops(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingStops(true);
      try {
        const resp = await stopsAPI.search(existingStopQuery.trim());
        setSearchResults(resp.data.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchingStops(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [existingStopQuery]);

  // Auto-calculate Total Distance (km) & Estimated Duration (mins) from Stops Sequence Coordinates
  const autoCalculateMetricsFromStops = useCallback((list: RouteStopItem[], forceUpdate = false) => {
    if (!list || list.length < 2) return;

    let totalDistKm = 0;
    let validLegs = 0;

    for (let i = 0; i < list.length - 1; i++) {
      const s1 = list[i];
      const s2 = list[i + 1];

      const lat1 = parseFloat(s1.latitude);
      const lon1 = parseFloat(s1.longitude);
      const lat2 = parseFloat(s2.latitude);
      const lon2 = parseFloat(s2.longitude);

      if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
        const R = 6371; // Earth radius in km
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const directKm = R * c;

        // Apply road route factor (~1.25x for urban road network geometry)
        const roadDistKm = directKm * 1.25;
        totalDistKm += roadDistKm;
        validLegs++;
      }
    }

    if (validLegs > 0) {
      const calcDist = Math.round(totalDistKm * 100) / 100;
      const calcDuration = Math.max(5, Math.round((totalDistKm / 25) * 60 + (list.length - 1) * 1.5));

      const firstStopName = list[0]?.stop_name?.split('-')[0]?.split(',')[0]?.trim() || '';
      const lastStopName = list[list.length - 1]?.stop_name?.split('-')[0]?.split(',')[0]?.trim() || '';

      setForm((prev) => {
        const updated = { ...prev };
        // Auto update distance & duration if empty or zero or forced
        if (forceUpdate || !prev.total_distance || prev.total_distance === '0') {
          updated.total_distance = String(calcDist);
        }
        if (forceUpdate || !prev.estimated_duration || prev.estimated_duration === '0') {
          updated.estimated_duration = String(calcDuration);
        }
        // Auto fill origin & destination city if empty
        if (!prev.origin_city && firstStopName) {
          updated.origin_city = firstStopName;
        }
        if (!prev.destination_city && lastStopName) {
          updated.destination_city = lastStopName;
        }
        // Auto fill route name if empty
        if (!prev.route_name && firstStopName && lastStopName) {
          updated.route_name = `${firstStopName}-${lastStopName}`;
        }
        // Auto fill route code if empty
        if (!prev.route_code && firstStopName && lastStopName) {
          const code1 = firstStopName.substring(0, 3).toUpperCase();
          const code2 = lastStopName.substring(0, 3).toUpperCase();
          updated.route_code = `${code1}-${code2}-001`;
        }
        return updated;
      });
    }
  }, []);

  // Whenever stopsList changes in modal, auto-calculate metrics
  useEffect(() => {
    if (showModal && stopsList.length >= 2) {
      autoCalculateMetricsFromStops(stopsList);
    }
  }, [stopsList, showModal, autoCalculateMetricsFromStops]);

  const openCreate = () => {
    setEditRoute(null);
    setForm({
      route_name: '',
      route_code: '',
      origin_city: '',
      destination_city: '',
      total_distance: '',
      estimated_duration: '',
      status: 'Active',
      description: '',
    });
    setStopsList([]);
    setExistingStopQuery('');
    setSearchResults([]);
    setShowModal(true);
  };

  const openEdit = (r: Route) => {
    setEditRoute(r);
    setForm({
      route_name: r.route_name || '',
      route_code: r.route_code || '',
      origin_city: r.origin_city || '',
      destination_city: r.destination_city || '',
      total_distance: r.total_distance ? String(r.total_distance) : '',
      estimated_duration: r.estimated_duration ? String(r.estimated_duration) : '',
      status: r.status || 'Active',
      description: r.description || '',
    });
    if (r.stops && r.stops.length > 0) {
      setStopsList(
        [...r.stops].sort((a, b) => a.stop_sequence - b.stop_sequence).map((s, idx) => ({
          stop_id: s.id,
          id: s.id,
          stop_name: s.stop_name || '',
          latitude: s.latitude != null ? String(s.latitude) : '',
          longitude: s.longitude != null ? String(s.longitude) : '',
          stop_sequence: idx + 1,
          travel_time_minutes: s.travel_time_minutes != null ? String(s.travel_time_minutes) : '0',
          address: s.address || '',
        }))
      );
    } else {
      setStopsList([]);
    }
    setExistingStopQuery('');
    setSearchResults([]);
    setShowModal(true);
  };

  // Attach existing physical stop to route editor
  const addExistingStopToRoute = (stop: PhysicalStopSearchResult) => {
    // Check duplicate
    if (stopsList.some((s) => (s.stop_id || s.id) === stop.id)) {
      onNotify(`Stop "${stop.stop_name}" is already in this route`, 'error');
      return;
    }

    setStopsList((prev) => [
      ...prev,
      {
        stop_id: stop.id,
        id: stop.id,
        stop_name: stop.stop_name,
        latitude: stop.latitude != null ? String(stop.latitude) : '',
        longitude: stop.longitude != null ? String(stop.longitude) : '',
        stop_sequence: prev.length + 1,
        travel_time_minutes: '0',
        address: stop.address || '',
      },
    ]);
    setExistingStopQuery('');
    setSearchResults([]);
    onNotify(`Attached "${stop.stop_name}" to route`);
  };

  const removeStopRow = (index: number) => {
    setStopsList((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((stop, idx) => ({ ...stop, stop_sequence: idx + 1 }))
    );
  };

  const moveStop = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === stopsList.length - 1) return;

    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    setStopsList((prev) => {
      const updated = [...prev];
      const temp = updated[index];
      updated[index] = updated[targetIdx];
      updated[targetIdx] = temp;
      return updated.map((stop, idx) => ({ ...stop, stop_sequence: idx + 1 }));
    });
  };

  // Open Bulk Add Stops Modal
  const openBulkAddModal = async () => {
    try {
      const resp = await stopsAPI.list({ limit: 100 });
      setAvailableMasterStops(resp.data.data || []);
      setSelectedStopIds([]);
      setShowBulkModal(true);
    } catch {
      onNotify('Failed to fetch stops list', 'error');
    }
  };

  const handleBulkAddConfirm = () => {
    const selectedObjList = availableMasterStops.filter((s) => selectedStopIds.includes(s.id));
    let addedCount = 0;

    setStopsList((prev) => {
      const prevIds = new Set(prev.map((s) => s.stop_id || s.id));
      const newItems: RouteStopItem[] = [];

      selectedObjList.forEach((s) => {
        if (!prevIds.has(s.id)) {
          addedCount++;
          newItems.push({
            stop_id: s.id,
            id: s.id,
            stop_name: s.stop_name,
            latitude: s.latitude != null ? String(s.latitude) : '',
            longitude: s.longitude != null ? String(s.longitude) : '',
            stop_sequence: prev.length + newItems.length + 1,
            travel_time_minutes: '0',
            address: s.address || '',
          });
        }
      });

      return [...prev, ...newItems].map((item, idx) => ({ ...item, stop_sequence: idx + 1 }));
    });

    setShowBulkModal(false);
    onNotify(`Added ${addedCount} stop(s) to route`);
  };

  // Inline Create New Physical Stop
  const handleCheckNearbyInline = async (latStr: string, lngStr: string) => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!isNaN(lat) && !isNaN(lng)) {
      try {
        const resp = await stopsAPI.nearbyCheck(lat, lng, 100);
        if (resp.data?.has_nearby) {
          setNearbyWarning(resp.data.data || []);
        } else {
          setNearbyWarning([]);
        }
      } catch {
        setNearbyWarning([]);
      }
    }
  };

  const handleSaveInlineStop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStopForm.stop_name.trim()) {
      onNotify('Stop Name is required', 'error');
      return;
    }

    try {
      const resp = await stopsAPI.create(newStopForm);
      const createdStop = resp.data.data;
      addExistingStopToRoute(createdStop);
      setShowCreateStopInline(false);
      setNewStopForm({ stop_name: '', stop_code: '', latitude: '', longitude: '', address: '', landmark: '' });
      setNearbyWarning([]);
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to create stop', 'error');
    }
  };

  // Save Route
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.route_name || !form.route_code || !form.origin_city || !form.destination_city) {
      onNotify('Please fill in Route Name, Code, Origin and Destination cities', 'error');
      return;
    }

    if (stopsList.length < 2) {
      onNotify('Route should have at least 2 stops', 'error');
      return;
    }

    setSaving(true);
    try {
      const formattedStops = stopsList.map((s, idx) => ({
        stop_id: s.stop_id || s.id,
        id: s.stop_id || s.id,
        stop_name: s.stop_name.trim(),
        latitude: s.latitude ? parseFloat(s.latitude) : null,
        longitude: s.longitude ? parseFloat(s.longitude) : null,
        stop_sequence: idx + 1,
        travel_time_minutes: idx === 0 ? 0 : Math.max(0, Number(s.travel_time_minutes) || 0),
        address: s.address || null,
      }));

      const payload = {
        ...form,
        total_distance: form.total_distance ? parseFloat(form.total_distance) : 0,
        estimated_duration: form.estimated_duration ? parseInt(form.estimated_duration) : 0,
        stops: formattedStops,
      };

      if (editRoute) {
        await routesAPI.update(editRoute.id, payload);
        onNotify('Route updated successfully');
      } else {
        await routesAPI.create(payload);
        onNotify('Route created successfully');
      }
      setShowModal(false);
      fetchRoutes();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to save route', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Duplicate Route Action
  const handleDuplicate = async (r: Route) => {
    try {
      await routesAPI.duplicate(r.id);
      onNotify(`Duplicated route "${r.route_name}" successfully`);
      fetchRoutes();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Duplicate failed', 'error');
    }
  };

  // Create Reverse Route Action
  const handleCreateReverse = async (r: Route) => {
    try {
      await routesAPI.reverse(r.id);
      onNotify(`Created reverse route for "${r.route_name}" successfully`);
      fetchRoutes();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Create reverse failed', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await routesAPI.delete(deleteTarget.id);
      onNotify('Route deleted successfully');
      setDeleteTarget(null);
      fetchRoutes();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const HEADERS = ['ID', 'Route Name', 'Code', 'Origin', 'Destination', 'Distance', 'Duration', 'Stops', 'Status', 'Actions'];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Bus Routes Management</h2>
          <p className="text-slate-400 text-sm">{pagination.total} bus routes configured</p>
        </div>
        <Button onClick={openCreate} icon={Plus}>
          Create Route
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search route name, code, origin, destination..."
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'Active', label: 'Active' },
            { value: 'Inactive', label: 'Inactive' },
          ]}
          placeholder="All Statuses"
        />
      </div>

      {/* Selected Route Detail Visual Sequence Card */}
      {selectedRoute && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-semibold text-base">{selectedRoute.route_name} — Stop Sequence</h3>
              <p className="text-slate-400 text-xs">
                {selectedRoute.origin_city} → {selectedRoute.destination_city} ({selectedRoute.total_distance} km, ~{selectedRoute.estimated_duration} mins)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => handleCreateReverse(selectedRoute)}>
                <RefreshCw size={13} className="mr-1" /> Create Reverse
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleDuplicate(selectedRoute)}>
                <Copy size={13} className="mr-1" /> Duplicate
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedRoute(null)}>
                Close
              </Button>
            </div>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {(selectedRoute.stops || [])
              .sort((a, b) => a.stop_sequence - b.stop_sequence)
              .map((stop, idx, arr) => (
                <div key={stop.id || idx} className="flex items-start gap-3 bg-slate-900/60 p-2.5 rounded border border-slate-800">
                  <div className="flex flex-col items-center">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{
                        background: idx === 0 ? '#10b981' : idx === arr.length - 1 ? '#ef4444' : '#6366f1',
                      }}
                    >
                      {stop.stop_sequence || idx + 1}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-white text-sm font-medium flex items-center justify-between">
                      <span>{stop.stop_name}</span>
                      <span className="text-[10px] text-slate-500 font-mono">ID #{stop.id}</span>
                    </div>
                    <div className="text-slate-400 text-xs">
                      {stop.address ? `${stop.address} • ` : ''}Sequence #{stop.stop_sequence || idx + 1}
                      {stop.latitude && stop.longitude ? ` (${stop.latitude}, ${stop.longitude})` : ''}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Routes Table */}
      <Card padding={false}>
        {error ? (
          <ErrorState message={error} onRetry={fetchRoutes} />
        ) : (
          <>
            <Table
              headers={HEADERS}
              loading={loading}
              empty={!loading && routes.length === 0}
              emptyMessage="No bus routes found"
            >
              {routes.map((route) => (
                <Tr key={route.id}>
                  <Td className="text-slate-400 font-mono text-xs">{route.id}</Td>
                  <Td>
                    <div className="text-white font-medium text-sm">{route.route_name}</div>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40">
                      {route.route_code}
                    </span>
                  </Td>
                  <Td className="text-slate-300 text-xs">{route.origin_city}</Td>
                  <Td className="text-slate-300 text-xs">{route.destination_city}</Td>
                  <Td className="text-slate-300 text-xs">{route.total_distance || 0} km</Td>
                  <Td className="text-slate-300 text-xs">{route.estimated_duration || 0} min</Td>
                  <Td>
                    <button onClick={() => setSelectedRoute(route)} className="hover:opacity-80 transition-opacity">
                      <Badge color="blue">{route.stops?.length || 0} stops</Badge>
                    </button>
                  </Td>
                  <Td>
                    <StatusBadge status={route.status} />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedRoute(route)} title="View Sequence">
                        <Eye size={13} className="text-cyan-400" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(route)} title="Edit Route">
                        <Edit2 size={13} className="text-slate-300" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDuplicate(route)} title="Duplicate Route">
                        <Copy size={13} className="text-indigo-400" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleCreateReverse(route)} title="Create Reverse Route">
                        <RefreshCw size={13} className="text-emerald-400" />
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeleteTarget(route)} title="Delete Route">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
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

      {/* Main Create / Edit Route Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl p-6 my-8 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {editRoute ? 'Edit Route & Stop Sequence' : 'Create Route (Cityflo Style Reusable Stops)'}
                </h3>
                <p className="text-xs text-slate-400">Reuses physical stops across routes without creating duplicates</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Route Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ranikuthi → National Insurance"
                    value={form.route_name}
                    onChange={(e) => setForm({ ...form, route_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Route Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ROUTE-007"
                    value={form.route_code}
                    onChange={(e) => setForm({ ...form, route_code: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Origin City <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Origin City"
                    value={form.origin_city}
                    onChange={(e) => setForm({ ...form, origin_city: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Destination City <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Destination City"
                    value={form.destination_city}
                    onChange={(e) => setForm({ ...form, destination_city: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-300">Total Distance (km)</label>
                    <button
                      type="button"
                      onClick={() => autoCalculateMetricsFromStops(stopsList, true)}
                      title="Auto-calculate distance from stops coordinates"
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1"
                    >
                      <RefreshCw size={10} /> Auto-Calc
                    </button>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Total Distance"
                    value={form.total_distance}
                    onChange={(e) => setForm({ ...form, total_distance: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-300">Estimated Duration (mins)</label>
                    <button
                      type="button"
                      onClick={() => autoCalculateMetricsFromStops(stopsList, true)}
                      title="Auto-calculate duration from distance & stop sequence"
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1"
                    >
                      <RefreshCw size={10} /> Auto-Calc
                    </button>
                  </div>
                  <input
                    type="number"
                    placeholder="Duration"
                    value={form.estimated_duration}
                    onChange={(e) => setForm({ ...form, estimated_duration: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="Active">Active / Published</option>
                    <option value="Inactive">Draft / Inactive</option>
                  </select>
                </div>
              </div>

              {/* SEARCH EXISTING STOPS & ADD INLINE SECTION */}
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="block text-xs font-bold text-white uppercase tracking-wider">
                    Route Stop Sequence ({stopsList.length} Selected Stops)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openBulkAddModal}
                      className="px-2.5 py-1 bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-medium rounded transition-colors"
                    >
                      + Bulk Add Stops
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateStopInline(true)}
                      className="px-2.5 py-1 bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-medium rounded transition-colors"
                    >
                      + Create New Stop
                    </button>
                  </div>
                </div>

                {/* Existing Stop Autosuggest Search Box */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search existing physical stop by name (e.g. Rani, Garia, Newtown)..."
                    value={existingStopQuery}
                    onChange={(e) => setExistingStopQuery(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-indigo-500/50 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-400"
                  />
                  {searchingStops && (
                    <div className="absolute right-3 top-2.5 text-xs text-slate-400">Searching master stops...</div>
                  )}
                  {searchResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 shadow-2xl">
                      {searchResults.map((stop) => (
                        <div
                          key={stop.id}
                          className="flex items-center justify-between border-b border-slate-800 p-2.5 hover:bg-slate-900 transition-colors"
                        >
                          <div>
                            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                              <MapPin size={12} className="text-indigo-400 shrink-0" />
                              {stop.stop_name}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {stop.latitude && stop.longitude ? `(${stop.latitude}, ${stop.longitude})` : ''} • Used by {stop.usage_count} route(s)
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => addExistingStopToRoute(stop)}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded shrink-0"
                          >
                            + Add to Route
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected Ordered Stops Drag & Drop List */}
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {stopsList.map((stop, index) => (
                    <div
                      key={stop.stop_id || stop.id || index}
                      className="flex items-center gap-2 bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/60"
                    >
                      <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{stop.stop_name}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {stop.latitude && stop.longitude ? `(${stop.latitude}, ${stop.longitude})` : 'No coordinates'}
                        </div>
                      </div>
                      {index > 0 && (
                        <label className="text-[10px] text-slate-400 shrink-0 flex flex-col gap-1">
                          From previous (min)
                          <input
                            type="number"
                            min="0"
                            value={stop.travel_time_minutes}
                            onChange={(e) => setStopsList((prev) => prev.map((item, idx) => idx === index ? { ...item, travel_time_minutes: e.target.value } : item))}
                            className="w-20 rounded bg-slate-900 border border-slate-600 px-2 py-1 text-xs text-white"
                          />
                        </label>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveStop(index, 'up')}
                          className="px-1.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-white text-xs rounded"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === stopsList.length - 1}
                          onClick={() => moveStop(index, 'down')}
                          className="px-1.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-white text-xs rounded"
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeStopRow(index)}
                          className="p-1 bg-rose-500/20 text-rose-400 hover:bg-rose-500/40 rounded transition-colors"
                          title="Remove from route"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {stopsList.length === 0 && (
                    <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg">
                      No stops selected. Use search or bulk add to attach physical stops.
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button variant="ghost" type="button" onClick={() => setShowModal(false)}>
                  Close
                </Button>
                <Button type="submit" loading={saving}>
                  Save Route
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Add Stops Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-semibold text-white">Bulk Add Physical Stops</h3>
              <button onClick={() => setShowBulkModal(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="py-3 space-y-2 max-h-72 overflow-y-auto">
              {availableMasterStops.map((stop) => {
                const isChecked = selectedStopIds.includes(stop.id);
                return (
                  <div
                    key={stop.id}
                    onClick={() =>
                      setSelectedStopIds((prev) =>
                        prev.includes(stop.id) ? prev.filter((id) => id !== stop.id) : [...prev, stop.id]
                      )
                    }
                    className={`flex items-center justify-between p-2.5 rounded cursor-pointer border transition-colors ${
                      isChecked
                        ? 'bg-indigo-950/60 border-indigo-500 text-white'
                        : 'bg-slate-800/60 border-slate-700/50 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-medium">{stop.stop_name}</div>
                      <div className="text-[10px] text-slate-400">
                        {stop.latitude && stop.longitude ? `(${stop.latitude}, ${stop.longitude})` : ''}
                      </div>
                    </div>
                    {isChecked ? <CheckSquare size={16} className="text-indigo-400" /> : <Square size={16} className="text-slate-500" />}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <Button variant="ghost" onClick={() => setShowBulkModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleBulkAddConfirm}>
                Add {selectedStopIds.length} Selected Stop(s)
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create New Physical Stop Inline Modal */}
      {showCreateStopInline && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-xl p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-semibold text-white">Create New Physical Stop</h3>
              <button onClick={() => setShowCreateStopInline(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveInlineStop} className="space-y-3 pt-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Stop Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Kadampukur"
                  value={newStopForm.stop_name}
                  onChange={(e) => setNewStopForm({ ...newStopForm, stop_name: e.target.value })}
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Latitude</label>
                  <input
                    type="text"
                    placeholder="22.6010335"
                    value={newStopForm.latitude}
                    onChange={(e) => {
                      setNewStopForm({ ...newStopForm, latitude: e.target.value });
                      handleCheckNearbyInline(e.target.value, newStopForm.longitude);
                    }}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Longitude</label>
                  <input
                    type="text"
                    placeholder="88.4684492"
                    value={newStopForm.longitude}
                    onChange={(e) => {
                      setNewStopForm({ ...newStopForm, longitude: e.target.value });
                      handleCheckNearbyInline(newStopForm.latitude, e.target.value);
                    }}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              {nearbyWarning.length > 0 && (
                <div className="p-3 bg-amber-950/50 border border-amber-800/60 rounded-lg text-xs text-amber-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                    An existing stop is nearby!
                  </div>
                  {nearbyWarning.slice(0, 2).map((item) => (
                    <div key={item.id} className="text-[11px] text-amber-200/90 pl-5">
                      • {item.stop_name} ({item.distance_meters}m away)
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Address</label>
                <input
                  type="text"
                  placeholder="Address or area"
                  value={newStopForm.address}
                  onChange={(e) => setNewStopForm({ ...newStopForm, address: e.target.value })}
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <Button variant="ghost" type="button" onClick={() => setShowCreateStopInline(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Save & Add To Route
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Route"
        message={`Are you sure you want to delete route "${deleteTarget?.route_name}" (${deleteTarget?.route_code})?`}
        loading={deleting}
      />
    </div>
  );
};
