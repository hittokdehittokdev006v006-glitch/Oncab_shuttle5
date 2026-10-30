import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitMerge,
  Search,
  RefreshCw,
  Filter,
  Download,
  Settings,
  MapPin,
  Calendar,
  Clock,
  ArrowRight,
  Bus,
  User,
  Sliders,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Compass,
  Maximize2,
  Minimize2,
  Info,
  ChevronRight,
  TrendingUp,
  Layers,
  ChevronLeft,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { crossConnectionsAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  StatCard,
  Badge,
  Button,
  Input,
  Select,
  Modal,
  Pagination,
  LoadingState,
  ErrorState,
  EmptyState,
} from '../components/ui';

interface CrossConnectionPageProps {
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

interface VehicleInfo {
  id: number;
  registration_number: string;
  company_model?: string;
  color?: string;
  status?: string;
}

interface DriverInfo {
  id: number;
  name: string;
  mobile?: string;
  online_status?: string;
}

interface RouteInfo {
  id?: number;
  route_name?: string;
  route_code?: string;
  origin_city?: string;
  destination_city?: string;
}

interface TripPhysicalStop {
  id?: number;
  stop_id?: number;
  stop_name?: string;
  latitude?: number | string;
  longitude?: number | string;
}

interface TripInfo {
  id: number;
  schedule_code: string;
  trip_date: string;
  departure_time: string;
  arrival_time?: string;
  status: string;
  route?: RouteInfo;
  vehicle?: VehicleInfo;
  driver?: DriverInfo;
  physical_stops?: TripPhysicalStop[];
}

interface CrossConnectionItem {
  id: number;
  connection_code: string;
  trip1_id: number;
  trip2_id: number;
  vehicle1_id?: number;
  vehicle2_id?: number;
  driver1_id?: number;
  driver2_id?: number;
  route_type1: string;
  route_type2: string;
  current_distance_meters: number;
  min_distance_meters?: number;
  overlap_duration_seconds: number;
  overlap_started_at: string;
  last_overlap_at: string;
  shared_segment_name?: string;
  shared_segment_details?: any;
  status: 'Active' | 'Completed' | 'No Longer Matching';
  notes?: string;
  created_at?: string;
  trip1?: TripInfo;
  trip2?: TripInfo;
  vehicle1?: VehicleInfo;
  vehicle2?: VehicleInfo;
  driver1?: DriverInfo;
  driver2?: DriverInfo;
}

interface DynamicConfig {
  cross_connection_max_distance_meters: number;
  cross_connection_min_overlap_minutes: number;
  cross_connection_eval_frequency_seconds: number;
  cross_connection_supported_route_types: string;
  cross_connection_match_expiration_minutes: number;
  cross_connection_heading_tolerance_degrees: number;
}

// Custom markers for Vehicle 1 (Emerald) and Vehicle 2 (Indigo)
const createVehicleMarkerIcon = (label: string, color: string, heading?: number) => {
  const rotationStyle = heading != null ? `transform: rotate(${heading}deg);` : '';
  return L.divIcon({
    className: 'custom-cross-vehicle-marker',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="background:${color};color:white;font-weight:700;font-size:10px;padding:2px 7px;border-radius:12px;border:2px solid white;box-shadow:0 3px 8px rgba(0,0,0,0.3);white-space:nowrap;margin-bottom:2px;">
          ${label}
        </div>
        <div style="width:28px;height:28px;background:${color};border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.35);${rotationStyle}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
          </svg>
        </div>
      </div>
    `,
    iconSize: [60, 52],
    iconAnchor: [30, 48],
    popupAnchor: [0, -48],
  });
};

// Map auto-fitter and size invalidator component for Modal rendering
const MapController: React.FC<{ points: [number, number][] }> = ({ points }) => {
  const map = useMap();

  useEffect(() => {
    // Invalidate map size so Leaflet recalculates dimensions when modal opens
    const timer = setTimeout(() => {
      try {
        map.invalidateSize();
      } catch {
        // ignore
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    if (points && points.length > 0) {
      const valid = points.filter(
        ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      );
      if (valid.length === 1) {
        map.setView(valid[0], 14);
      } else if (valid.length > 1) {
        const bounds = L.latLngBounds(valid);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    }
  }, [map, points]);

  return null;
};

export const CrossConnectionPage: React.FC<CrossConnectionPageProps> = ({ onNotify }) => {
  const { hasPermission, hasRole } = useAuth();
  const canConfigure = hasPermission('cross_connection.configure') || hasRole('admin');
  const canViewDetails = hasPermission('cross_connection.view_details') || hasRole('admin');
  const canExport = hasPermission('cross_connection.export') || hasRole('admin');
  const canManage = hasPermission('cross_connection.manage') || hasRole('admin');

  // List states
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [connections, setConnections] = useState<CrossConnectionItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [summary, setSummary] = useState({
    active: 0,
    completed: 0,
    no_longer_matching: 0,
    total: 0,
  });

  // Filters
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Completed' | 'No Longer Matching'>('All');
  const [routeTypeFilter, setRouteTypeFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('last_overlap_at');
  const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');

  // Detail Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CrossConnectionItem | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Settings / Config Modal State
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [config, setConfig] = useState<DynamicConfig>({
    cross_connection_max_distance_meters: 500,
    cross_connection_min_overlap_minutes: 5,
    cross_connection_eval_frequency_seconds: 30,
    cross_connection_supported_route_types: 'Regular,Scheduled,Dynamic,Express,Shuttle',
    cross_connection_match_expiration_minutes: 15,
    cross_connection_heading_tolerance_degrees: 60,
  });

  // Fetch Cross Connection List
  const fetchConnections = useCallback(
    async (isManualRefresh = false) => {
      try {
        if (isManualRefresh) setReloading(true);
        else setLoading(true);

        const params: any = {
          page: currentPage,
          limit: pageSize,
          sort_by: sortBy,
          sort_order: sortOrder,
        };
        if (statusFilter !== 'All') params.status = statusFilter;
        if (routeTypeFilter !== 'All') params.route_type = routeTypeFilter;
        if (searchQuery.trim()) params.search = searchQuery.trim();
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;

        const res = await crossConnectionsAPI.list(params);
        if (res.data?.success) {
          setConnections(res.data.data.rows || []);
          setTotalCount(res.data.data.total || 0);
          setTotalPages(res.data.data.total_pages || 1);
          if (res.data.data.summary) {
            setSummary(res.data.data.summary);
          }
        }
      } catch (err: any) {
        onNotify(err.response?.data?.message || 'Failed to load cross connections', 'error');
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [currentPage, pageSize, sortBy, sortOrder, statusFilter, routeTypeFilter, searchQuery, dateFrom, dateTo, onNotify]
  );

  // Initial and periodic fetch
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Periodic polling based on configured evaluation frequency
  useEffect(() => {
    const intervalMs = Math.max(10000, (config.cross_connection_eval_frequency_seconds || 30) * 1000);
    const timer = setInterval(() => {
      fetchConnections(true);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [fetchConnections, config.cross_connection_eval_frequency_seconds]);

  // Load configuration
  const loadConfig = async () => {
    try {
      setConfigLoading(true);
      const res = await crossConnectionsAPI.getConfig();
      if (res.data?.success && res.data.data) {
        setConfig(res.data.data);
      }
    } catch {
      // Keep defaults
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  // Save updated configuration
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setConfigSaving(true);
      const res = await crossConnectionsAPI.updateConfig(config);
      if (res.data?.success) {
        setConfig(res.data.data);
        setConfigModalOpen(false);
        onNotify('Cross connection matching thresholds updated successfully', 'success');
        fetchConnections(true);
      }
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to update configuration', 'error');
    } finally {
      setConfigSaving(false);
    }
  };

  // Manual trigger of matching evaluation
  const handleRunEvaluation = async () => {
    try {
      setReloading(true);
      const res = await crossConnectionsAPI.evaluate();
      if (res.data?.success) {
        onNotify(res.data.message || 'Cross connection evaluation complete', 'success');
        fetchConnections(true);
      }
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Evaluation failed', 'error');
      setReloading(false);
    }
  };

  // View Record Details
  const handleOpenDetail = async (item: CrossConnectionItem) => {
    setSelectedItem(item);
    setDetailModalOpen(true);
    if (!canViewDetails) return;
    try {
      setLoadingDetail(true);
      const res = await crossConnectionsAPI.show(item.id);
      if (res.data?.success && res.data.data) {
        setSelectedItem(res.data.data);
      }
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to fetch detailed cross connection info', 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Export Data
  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const params: any = { format };
      if (statusFilter !== 'All') params.status = statusFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const res = await crossConnectionsAPI.export(params);
      const blob = new Blob([res.data], { type: format === 'csv' ? 'text/csv' : 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cross_connections_${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      onNotify(`Exported ${format.toUpperCase()} successfully`, 'success');
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Export failed', 'error');
    }
  };

  // Format overlap duration helper
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0 min';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s > 0 ? `${s}s` : ''}`;
  };

  // Status Badge color helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Active':
        return <Badge color="green">Active</Badge>;
      case 'Completed':
        return <Badge color="blue">Completed</Badge>;
      case 'No Longer Matching':
        return <Badge color="gray">No Longer Matching</Badge>;
      default:
        return <Badge color="slate">{status}</Badge>;
    }
  };

  // Extract map coordinates for selected item
  const mapData = useMemo(() => {
    if (!selectedItem) return { points: [], loc1: null, loc2: null, path: [] };
    let details = selectedItem.shared_segment_details;
    if (typeof details === 'string') {
      try {
        details = JSON.parse(details);
      } catch {
        details = {};
      }
    }
    details = details || {};

    let loc1 = details.location1;
    let loc2 = details.location2;

    // Fallback: Check if trip/driver has last known position or stops
    if (!loc1 && selectedItem.trip1?.physical_stops?.length) {
      const stop = selectedItem.trip1.physical_stops[0];
      if (stop.latitude && stop.longitude) loc1 = { latitude: stop.latitude, longitude: stop.longitude, heading: 0, speed: 0 };
    }
    if (!loc2 && selectedItem.trip2?.physical_stops?.length) {
      const stop = selectedItem.trip2.physical_stops[0];
      if (stop.latitude && stop.longitude) loc2 = { latitude: stop.latitude, longitude: stop.longitude, heading: 0, speed: 0 };
    }

    const points: [number, number][] = [];

    if (loc1 && loc1.latitude != null && loc1.longitude != null) {
      const lat = Number(loc1.latitude);
      const lng = Number(loc1.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        points.push([lat, lng]);
      }
    }
    if (loc2 && loc2.latitude != null && loc2.longitude != null) {
      const lat = Number(loc2.latitude);
      const lng = Number(loc2.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        points.push([lat, lng]);
      }
    }

    // Common segment points if available
    const rawSamplePoints = details.sharedSegment?.samplePoints || [];
    const samplePoints: [number, number][] = rawSamplePoints
      .map((p: any) => [Number(p[0]), Number(p[1])])
      .filter(([lat, lng]: [number, number]) => Number.isFinite(lat) && Number.isFinite(lng));

    const combinedPoints = [...points, ...samplePoints];

    return {
      points: combinedPoints,
      loc1,
      loc2,
      path: points.length === 2 ? points : [],
      samplePoints,
    };
  }, [selectedItem]);

  return (
    <div className="space-y-6">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50">
                <GitMerge size={22} />
              </span>
              Cross Connection
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              Live Fleet Corridors
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Detect and monitor vehicles traveling in the same direction along similar routes with dynamic distance and overlap thresholds.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunEvaluation}
              disabled={reloading}
              className="flex items-center gap-1.5"
            >
              <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />
              Evaluate Now
            </Button>
          )}

          {canConfigure && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                loadConfig();
                setConfigModalOpen(true);
              }}
              className="flex items-center gap-1.5"
            >
              <Sliders size={14} />
              Threshold Settings
            </Button>
          )}

          {canExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('csv')}
              className="flex items-center gap-1.5"
            >
              <Download size={14} />
              Export CSV
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchConnections(true)}
            disabled={reloading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {/* ── Summary Stats Cards ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Active Cross Connections"
          value={summary.active}
          icon={GitMerge}
          color="#10b981"
          subtitle="Currently sharing corridor"
        />
        <StatCard
          title="Total Matches Detected"
          value={summary.total}
          icon={TrendingUp}
          color="#6366f1"
          subtitle="All recorded cross trips"
        />
        <StatCard
          title="Completed Overlaps"
          value={summary.completed}
          icon={CheckCircle2}
          color="#0ea5e9"
          subtitle="Finished joint travel"
        />
        <StatCard
          title="Threshold Distance"
          value={`${config.cross_connection_max_distance_meters || 500} m`}
          icon={Compass}
          color="#f59e0b"
          subtitle={`Min Overlap: ${config.cross_connection_min_overlap_minutes || 5} min`}
        />
      </div>

      {/* ── Filter Bar ────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ID, route corridor, notes..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="md:col-span-2">
            <Select
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as any)}
              options={[
                { value: 'All', label: 'All Statuses' },
                { value: 'Active', label: 'Active Matches' },
                { value: 'Completed', label: 'Completed' },
                { value: 'No Longer Matching', label: 'No Longer Matching' },
              ]}
              className="w-full text-sm"
            />
          </div>

          <div className="md:col-span-2">
            <Select
              value={routeTypeFilter}
              onChange={(val) => setRouteTypeFilter(val)}
              options={[
                { value: 'All', label: 'All Route Types' },
                { value: 'Regular', label: 'Regular Routes' },
                { value: 'Scheduled', label: 'Scheduled Routes' },
                { value: 'Dynamic', label: 'Dynamic Corridors' },
                { value: 'Shuttle', label: 'Shuttle Routes' },
              ]}
              className="w-full text-sm"
            />
          </div>

          <div className="md:col-span-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="From date"
              className="w-full px-2.5 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div className="md:col-span-2 flex items-center gap-2">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="To date"
              className="w-full px-2.5 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            {(searchQuery || statusFilter !== 'All' || routeTypeFilter !== 'All' || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('All');
                  setRouteTypeFilter('All');
                  setDateFrom('');
                  setDateTo('');
                }}
                className="text-xs text-rose-500 hover:text-rose-600 px-2"
                title="Reset filters"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* ── Main Data Table ────────────────────────────────────────── */}
      <Card padding={false} className="overflow-hidden">
        {loading ? (
          <LoadingState message="Evaluating and loading cross connections..." />
        ) : connections.length === 0 ? (
          <EmptyState
            message="No Cross Connections Found"
            description="No vehicle pairs currently satisfy the configured distance and shared time overlap criteria."
            action={
              canManage
                ? {
                    label: 'Run Matching Evaluation',
                    onClick: handleRunEvaluation,
                  }
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-3.5 px-4">Connection Code</th>
                  <th className="py-3.5 px-4">Vehicle 1 & Trip</th>
                  <th className="py-3.5 px-4">Vehicle 2 & Trip</th>
                  <th className="py-3.5 px-4">Current Distance</th>
                  <th className="py-3.5 px-4">Shared Duration</th>
                  <th className="py-3.5 px-4">Common Route Segment</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Last Overlap</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                {connections.map((conn) => {
                  const reg1 = conn.vehicle1?.registration_number || 'Unassigned';
                  const reg2 = conn.vehicle2?.registration_number || 'Unassigned';
                  const driver1Name = conn.driver1?.name || 'Driver 1';
                  const driver2Name = conn.driver2?.name || 'Driver 2';
                  const route1Name = conn.trip1?.route?.route_name || `Trip #${conn.trip1_id}`;
                  const route2Name = conn.trip2?.route?.route_name || `Trip #${conn.trip2_id}`;

                  return (
                    <tr
                      key={conn.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-850/50 transition-colors group cursor-pointer"
                      onClick={() => handleOpenDetail(conn)}
                    >
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="font-semibold text-xs tracking-tight">{conn.connection_code}</span>
                        </div>
                      </td>

                      {/* Vehicle 1 */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Bus size={13} className="text-emerald-500" />
                            {reg1}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {driver1Name} • <span className="text-indigo-600 dark:text-indigo-400">{route1Name}</span>
                          </span>
                        </div>
                      </td>

                      {/* Vehicle 2 */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Bus size={13} className="text-indigo-500" />
                            {reg2}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {driver2Name} • <span className="text-indigo-600 dark:text-indigo-400">{route2Name}</span>
                          </span>
                        </div>
                      </td>

                      {/* Distance */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-900/40">
                          <Compass size={12} />
                          {Math.round(conn.current_distance_meters)} m
                        </div>
                      </td>

                      {/* Overlap Duration */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium text-xs">
                          <Clock size={13} className="text-slate-400" />
                          {formatDuration(conn.overlap_duration_seconds)}
                        </div>
                      </td>

                      {/* Shared Segment */}
                      <td className="py-3.5 px-4">
                        <div className="max-w-xs truncate text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1">
                          <MapPin size={12} className="text-indigo-500 flex-shrink-0" />
                          <span className="truncate">{conn.shared_segment_name || 'Common Corridor'}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">{getStatusBadge(conn.status)}</td>

                      {/* Last Overlap */}
                      <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400">
                        {conn.last_overlap_at ? new Date(conn.last_overlap_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDetail(conn)}
                          className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                        >
                          View Map & Details
                          <ChevronRight size={14} className="ml-1" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalCount > pageSize && (
          <Pagination
            page={currentPage}
            pages={totalPages}
            total={totalCount}
            limit={pageSize}
            onPageChange={setCurrentPage}
          />
        )}
      </Card>

      {/* ── Detail & Live Map View Modal ────────────────────────────── */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={
          selectedItem ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{selectedItem.connection_code}</span>
              {getStatusBadge(selectedItem.status)}
            </div>
          ) : (
            'Cross Connection Details'
          )
        }
        size="xl"
      >
        {selectedItem && (
          <div className="space-y-5">
            {/* Vehicles comparison banner */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Vehicle 1 Card */}
              <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      Vehicle 1 (Primary)
                    </span>
                  </div>
                  <Badge color="emerald">{selectedItem.route_type1 || 'Regular'}</Badge>
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Bus size={18} className="text-emerald-600 dark:text-emerald-400" />
                  {selectedItem.vehicle1?.registration_number || `Vehicle #${selectedItem.vehicle1_id || '—'}`}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <p>
                    <strong>Driver:</strong> {selectedItem.driver1?.name || 'Unassigned'} ({selectedItem.driver1?.mobile || 'No contact'})
                  </p>
                  <p>
                    <strong>Trip ID:</strong> #{selectedItem.trip1_id} • Schedule: {selectedItem.trip1?.schedule_code || '—'}
                  </p>
                  <p>
                    <strong>Route:</strong> {selectedItem.trip1?.route?.route_name || 'Corridor Route'} ({selectedItem.trip1?.route?.origin_city} ➔ {selectedItem.trip1?.route?.destination_city})
                  </p>
                  <p>
                    <strong>Departure:</strong> {selectedItem.trip1?.departure_time || '—'}
                  </p>
                </div>
              </div>

              {/* Vehicle 2 Card */}
              <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-indigo-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
                      Vehicle 2 (Secondary)
                    </span>
                  </div>
                  <Badge color="blue">{selectedItem.route_type2 || 'Regular'}</Badge>
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Bus size={18} className="text-indigo-600 dark:text-indigo-400" />
                  {selectedItem.vehicle2?.registration_number || `Vehicle #${selectedItem.vehicle2_id || '—'}`}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <p>
                    <strong>Driver:</strong> {selectedItem.driver2?.name || 'Unassigned'} ({selectedItem.driver2?.mobile || 'No contact'})
                  </p>
                  <p>
                    <strong>Trip ID:</strong> #{selectedItem.trip2_id} • Schedule: {selectedItem.trip2?.schedule_code || '—'}
                  </p>
                  <p>
                    <strong>Route:</strong> {selectedItem.trip2?.route?.route_name || 'Corridor Route'} ({selectedItem.trip2?.route?.origin_city} ➔ {selectedItem.trip2?.route?.destination_city})
                  </p>
                  <p>
                    <strong>Departure:</strong> {selectedItem.trip2?.departure_time || '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Overlap Metrics Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-900/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">Current Distance</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {Math.round(selectedItem.current_distance_meters)} meters
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Min Distance Recorded</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {selectedItem.min_distance_meters ? `${Math.round(selectedItem.min_distance_meters)} meters` : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Shared Travel Duration</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {formatDuration(selectedItem.overlap_duration_seconds)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Overlap Began At</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {new Date(selectedItem.overlap_started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>

            {/* Leaflet Live Map */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <MapPin size={14} className="text-indigo-500" />
                  Live Corridor Map & Shared Geometry
                </span>
                <span className="text-slate-400 font-normal">
                  Green: Vehicle 1 • Blue: Vehicle 2 • Dashed: Relative Vector
                </span>
              </div>

              <div className="h-80 w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 relative shadow-inner">
                {mapData.points.length > 0 ? (
                  <MapContainer
                    center={mapData.points[0]}
                    zoom={13}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {/* Auto-fit and resize map */}
                    <MapController points={mapData.points} />

                    {/* Vehicle 1 Marker */}
                    {mapData.loc1 && (
                      <Marker
                        position={[Number(mapData.loc1.latitude), Number(mapData.loc1.longitude)]}
                        icon={createVehicleMarkerIcon(
                          selectedItem.vehicle1?.registration_number || 'Veh 1',
                          '#059669',
                          mapData.loc1.heading
                        )}
                      >
                        <Popup>
                          <div className="p-1 space-y-1 text-xs">
                            <strong className="text-emerald-600 block">Vehicle 1: {selectedItem.vehicle1?.registration_number}</strong>
                            <p>Driver: {selectedItem.driver1?.name}</p>
                            <p>Speed: {mapData.loc1.speed || 0} km/h</p>
                            <p>Heading: {mapData.loc1.heading ? `${mapData.loc1.heading}°` : 'N/A'}</p>
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* Vehicle 2 Marker */}
                    {mapData.loc2 && (
                      <Marker
                        position={[Number(mapData.loc2.latitude), Number(mapData.loc2.longitude)]}
                        icon={createVehicleMarkerIcon(
                          selectedItem.vehicle2?.registration_number || 'Veh 2',
                          '#4f46e5',
                          mapData.loc2.heading
                        )}
                      >
                        <Popup>
                          <div className="p-1 space-y-1 text-xs">
                            <strong className="text-indigo-600 block">Vehicle 2: {selectedItem.vehicle2?.registration_number}</strong>
                            <p>Driver: {selectedItem.driver2?.name}</p>
                            <p>Speed: {mapData.loc2.speed || 0} km/h</p>
                            <p>Heading: {mapData.loc2.heading ? `${mapData.loc2.heading}°` : 'N/A'}</p>
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* Vector line connecting vehicles */}
                    {mapData.path.length === 2 && (
                      <Polyline
                        positions={mapData.path}
                        color="#f59e0b"
                        dashArray="6, 8"
                        weight={3}
                      />
                    )}

                    {/* Common route segment line if points exist */}
                    {mapData.samplePoints && mapData.samplePoints.length > 1 && (
                      <Polyline
                        positions={mapData.samplePoints}
                        color="#10b981"
                        weight={5}
                        opacity={0.6}
                      />
                    )}
                  </MapContainer>
                ) : (
                  <div className="h-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs">
                    No GPS coordinate pair available for map visualization.
                  </div>
                )}
              </div>
            </div>

            {/* Notes / Details */}
            {selectedItem.notes && (
              <div className="text-xs p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300">
                <strong>Evaluation Notes:</strong> {selectedItem.notes}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Dynamic Configuration Modal ────────────────────────────── */}
      <Modal
        isOpen={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        title="Cross Connection Matching Rules & Thresholds"
        size="lg"
      >
        <form onSubmit={handleSaveConfig} className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure dynamic distance and time-overlap thresholds. Changes take effect on subsequent evaluations without requiring application redeployment.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Maximum Distance Threshold (Meters)
              </label>
              <input
                type="number"
                min="10"
                max="50000"
                step="10"
                required
                value={config.cross_connection_max_distance_meters ?? 500}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    cross_connection_max_distance_meters: Number(e.target.value) || 0,
                  })
                }
                placeholder="e.g. 500"
                className="w-full px-3.5 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Typical presets: 100m (close), 500m (corridor), 1000m (city wide)
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Minimum Shared Travel Duration (Minutes)
              </label>
              <input
                type="number"
                min="1"
                max="180"
                step="1"
                required
                value={config.cross_connection_min_overlap_minutes ?? 5}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    cross_connection_min_overlap_minutes: Number(e.target.value) || 0,
                  })
                }
                placeholder="e.g. 5"
                className="w-full px-3.5 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Min minutes traveling together to confirm cross connection
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Evaluation Frequency (Seconds)
              </label>
              <input
                type="number"
                min="5"
                max="300"
                step="5"
                required
                value={config.cross_connection_eval_frequency_seconds ?? 30}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    cross_connection_eval_frequency_seconds: Number(e.target.value) || 0,
                  })
                }
                placeholder="e.g. 30"
                className="w-full px-3.5 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                How frequently live GPS positions are compared
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Heading Tolerance (Degrees)
              </label>
              <input
                type="number"
                min="10"
                max="180"
                step="5"
                required
                value={config.cross_connection_heading_tolerance_degrees ?? 60}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    cross_connection_heading_tolerance_degrees: Number(e.target.value) || 0,
                  })
                }
                placeholder="e.g. 60"
                className="w-full px-3.5 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Angular difference to confirm travel in same direction
              </span>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Match Expiration Time (Minutes)
              </label>
              <input
                type="number"
                min="1"
                max="120"
                step="1"
                required
                value={config.cross_connection_match_expiration_minutes ?? 15}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    cross_connection_match_expiration_minutes: Number(e.target.value) || 0,
                  })
                }
                placeholder="e.g. 15"
                className="w-full px-3.5 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Time without GPS proximity before an active match transitions to 'No Longer Matching'
              </span>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Supported Route Types (Comma-Separated)
              </label>
              <input
                type="text"
                value={config.cross_connection_supported_route_types ?? ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    cross_connection_supported_route_types: e.target.value,
                  })
                }
                placeholder="Regular,Scheduled,Dynamic,Express,Shuttle"
                className="w-full px-3.5 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfigModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={configSaving}
              className="flex items-center gap-1.5"
            >
              {configSaving && <RefreshCw size={14} className="animate-spin" />}
              Save Thresholds
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
