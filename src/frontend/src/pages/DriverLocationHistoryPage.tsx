import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  Bus, Calendar, CheckCircle2, ChevronRight, Clock, Compass, Download, 
  Filter, Gauge, History, MapPin, Navigation, Play, Pause, RefreshCw, 
  RotateCcw, Route, Search, User, X, AlertCircle, Activity
} from 'lucide-react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { locationsAPI } from '../services/api';
import { Card, ErrorState, LoadingState } from '../components/ui';

type PerspectiveMode = 'all' | 'routewise' | 'buswise' | 'timewise' | 'driverwise';
type Position = [number, number];

interface RouteStop {
  id: number;
  stop_name: string;
  stop_sequence: number;
  latitude: number | string | null;
  longitude: number | string | null;
}

interface TripItem {
  id: number;
  schedule_code: string;
  status: 'Scheduled' | 'Active' | 'Completed' | 'Cancelled' | 'Delayed';
  trip_date: string | null;
  departure_time: string;
  started_at: string | null;
  completed_at: string | null;
  route_id: number;
  vehicle_id: number | null;
  driver_id: number | null;
  route?: {
    id: number;
    route_name: string;
    route_code: string;
    origin_city: string;
    destination_city: string;
    stops?: RouteStop[];
  } | null;
  vehicle?: {
    id: number;
    registration_number: string;
    company_model: string | null;
    status: string;
  } | null;
  driver?: {
    id: number;
    name: string;
    mobile: string;
  } | null;
  location_stats?: {
    total_points: number;
    first_ping: string | null;
    latest_ping: string | null;
    max_speed_kmh: number;
    avg_speed_kmh: number;
  };
}

interface BreadcrumbLocation {
  id: number;
  latitude: string | number;
  longitude: string | number;
  speed_kmh: string | number | null;
  heading: string | number | null;
  accuracy: string | number | null;
  battery_level: string | number | null;
  recorded_at: string;
}

interface FilterOptions {
  routes: Array<{ id: number; route_name: string; route_code: string; origin_city: string; destination_city: string }>;
  vehicles: Array<{ id: number; registration_number: string; company_model: string | null }>;
  drivers: Array<{ id: number; name: string; mobile: string }>;
  retention_hours: number;
  cutoff_date: string;
}

// Custom Leaflet Icons
const createStartIcon = () =>
  L.divIcon({
    className: 'custom-start-marker',
    html: `
      <div style="background-color: #10b981; width: 28px; height: 28px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 11px;">
        ▶
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });

const createEndIcon = (isActive: boolean) =>
  L.divIcon({
    className: 'custom-end-marker',
    html: `
      <div style="background-color: ${isActive ? '#0284c7' : '#ef4444'}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 2px 10px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">
        ${isActive ? '🚌' : '🏁'}
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });

const createScrubberIcon = (speed: number | null) =>
  L.divIcon({
    className: 'custom-scrubber-marker',
    html: `
      <div style="background-color: #f59e0b; width: 34px; height: 34px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.4), 0 4px 12px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-size: 15px;">
        📍
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });

const createStopPinIcon = (sequence: number) =>
  L.divIcon({
    className: 'custom-stop-marker',
    html: `
      <div style="background-color: #475569; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: 700;">
        ${sequence}
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  });

// Viewport controller to auto-center bounds on coordinates
const MapViewportAdjuster: React.FC<{ coordinates: Position[]; selectedPoint?: Position | null }> = ({
  coordinates,
  selectedPoint,
}) => {
  const map = useMap();

  useEffect(() => {
    if (selectedPoint && Number.isFinite(selectedPoint[0]) && Number.isFinite(selectedPoint[1])) {
      map.setView(selectedPoint, Math.max(map.getZoom(), 15), { animate: true });
      return;
    }

    if (coordinates.length > 0) {
      const valid = coordinates.filter(
        ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      );
      if (valid.length > 0) {
        const bounds = L.latLngBounds(valid);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    }
  }, [coordinates, map, selectedPoint]);

  return null;
};

// Distance calculation in KM
const calculateTotalDistanceKm = (points: Position[]): number => {
  if (points.length < 2) return 0;
  let totalMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const lat1 = points[i - 1][0];
    const lon1 = points[i - 1][1];
    const lat2 = points[i][0];
    const lon2 = points[i][1];
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    totalMeters += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return Number((totalMeters / 1000).toFixed(2));
};

export const DriverLocationHistoryPage: React.FC = () => {
  // Main Data States
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // Selected Trip & Breadcrumb State
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [tripLocations, setTripLocations] = useState<BreadcrumbLocation[]>([]);
  const [loadingTripLocations, setLoadingTripLocations] = useState<boolean>(false);
  const [tripDetail, setTripDetail] = useState<any>(null);

  // Perspective Mode
  const [mode, setMode] = useState<PerspectiveMode>('all');

  // Filter States
  const [search, setSearch] = useState<string>('');
  const [routeFilter, setRouteFilter] = useState<string>('');
  const [busFilter, setBusFilter] = useState<string>('');
  const [driverFilter, setDriverFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [timeSlotFilter, setTimeSlotFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'48h' | 'today' | 'yesterday'>('48h');

  // Timeline / Scrubber Playback
  const [scrubberIndex, setScrubberIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playbackIntervalRef = useRef<number | null>(null);

  // Fetch Trips List with Multi-filters
  const fetchTripsList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const params: any = { limit: 100 };
      if (search.trim()) params.search = search.trim();
      if (routeFilter) params.route_id = routeFilter;
      if (busFilter) params.vehicle_id = busFilter;
      if (driverFilter) params.driver_id = driverFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (timeSlotFilter !== 'all') params.time_slot = timeSlotFilter;

      if (dateFilter === 'today') {
        params.date = todayStr;
      } else if (dateFilter === 'yesterday') {
        params.date = yesterdayStr;
      }

      const res = await locationsAPI.getHistoryList(params);
      const data = res.data?.data;
      setTrips(data?.trips || []);
      setFilterOptions(data?.filters || null);

      // Auto-select first trip if none is selected
      if (!selectedTripId && data?.trips?.length > 0) {
        setSelectedTripId(data.trips[0].id);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load trip location history');
    } finally {
      setLoading(false);
    }
  }, [busFilter, dateFilter, driverFilter, routeFilter, search, selectedTripId, statusFilter, timeSlotFilter]);

  useEffect(() => {
    fetchTripsList();
  }, [fetchTripsList]);

  // Fetch Breadcrumbs when a trip is selected
  useEffect(() => {
    if (!selectedTripId) {
      setTripLocations([]);
      setTripDetail(null);
      setScrubberIndex(null);
      return;
    }

    let isMounted = true;
    setLoadingTripLocations(true);
    setIsPlaying(false);
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
    }

    locationsAPI
      .getTripHistory(selectedTripId)
      .then((res) => {
        if (!isMounted) return;
        const data = res.data?.data;
        setTripDetail(data || null);
        setTripLocations(data?.locations || []);
        setScrubberIndex(data?.locations?.length ? data.locations.length - 1 : null);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Failed to load trip breadcrumbs:', err.message);
      })
      .finally(() => {
        if (isMounted) setLoadingTripLocations(false);
      });

    return () => {
      isMounted = false;
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, [selectedTripId]);

  // Playback timer control
  useEffect(() => {
    if (isPlaying && tripLocations.length > 0) {
      playbackIntervalRef.current = window.setInterval(() => {
        setScrubberIndex((prev) => {
          if (prev === null || prev >= tripLocations.length - 1) {
            setIsPlaying(false);
            return tripLocations.length - 1;
          }
          return prev + 1;
        });
      }, 700);
    } else {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    }
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, [isPlaying, tripLocations.length]);

  // Convert locations into coordinates
  const trajectoryPositions: Position[] = useMemo(() => {
    return tripLocations
      .map((loc) => [Number(loc.latitude), Number(loc.longitude)] as Position)
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
  }, [tripLocations]);

  // Selected Trip Object
  const selectedTrip = useMemo(() => {
    return trips.find((t) => t.id === selectedTripId) || null;
  }, [selectedTripId, trips]);

  // Current Scrubber Location
  const currentScrubberPoint = useMemo(() => {
    if (scrubberIndex === null || !tripLocations[scrubberIndex]) return null;
    const item = tripLocations[scrubberIndex];
    return {
      location: item,
      position: [Number(item.latitude), Number(item.longitude)] as Position,
    };
  }, [scrubberIndex, tripLocations]);

  // Distance & Metrics
  const distanceKm = useMemo(() => {
    return calculateTotalDistanceKm(trajectoryPositions);
  }, [trajectoryPositions]);

  // Export Breadcrumbs CSV
  const exportCsv = useCallback(() => {
    if (!tripLocations.length || !selectedTrip) return;
    const headers = ['ID', 'Latitude', 'Longitude', 'Speed_KMH', 'Heading', 'Accuracy_M', 'Battery_Pct', 'Timestamp'];
    const rows = tripLocations.map((l) => [
      l.id,
      l.latitude,
      l.longitude,
      l.speed_kmh ?? '',
      l.heading ?? '',
      l.accuracy ?? '',
      l.battery_level ?? '',
      new Date(l.recorded_at).toISOString(),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `trip_${selectedTrip.id}_${selectedTrip.schedule_code}_gps_history.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [selectedTrip, tripLocations]);

  // Filter Grouping according to Perspective Mode
  const groupedContent = useMemo(() => {
    if (mode === 'routewise') {
      const map: Record<string, { route: any; trips: TripItem[] }> = {};
      for (const t of trips) {
        const key = t.route ? `${t.route.id}_${t.route.route_name}` : 'Unknown Route';
        if (!map[key]) map[key] = { route: t.route, trips: [] };
        map[key].trips.push(t);
      }
      return Object.values(map);
    }
    if (mode === 'buswise') {
      const map: Record<string, { vehicle: any; trips: TripItem[] }> = {};
      for (const t of trips) {
        const key = t.vehicle ? `${t.vehicle.id}_${t.vehicle.registration_number}` : 'Unknown Bus';
        if (!map[key]) map[key] = { vehicle: t.vehicle, trips: [] };
        map[key].trips.push(t);
      }
      return Object.values(map);
    }
    if (mode === 'driverwise') {
      const map: Record<string, { driver: any; trips: TripItem[] }> = {};
      for (const t of trips) {
        const key = t.driver ? `${t.driver.id}_${t.driver.name}` : 'Unassigned Driver';
        if (!map[key]) map[key] = { driver: t.driver, trips: [] };
        map[key].trips.push(t);
      }
      return Object.values(map);
    }
    return null;
  }, [mode, trips]);

  return (
    <div className="space-y-5 p-4 md:p-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Driver Location History
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              <Activity size={12} className="animate-pulse" />
              Retained for 48 Hours
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Per-trip driver GPS breadcrumbs, speed analytics, and stop trajectory replay. Automatically stored when trips start and auto-purged after 2 days.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={fetchTripsList}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          {selectedTrip && tripLocations.length > 0 && (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-600 bg-teal-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-700"
            >
              <Download size={14} />
              Export GPS Points (CSV)
            </button>
          )}
        </div>
      </div>

      {/* Perspective Tabs (Routewise, Buswise, Timewise, Driverwise) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Group By:</span>
        <button
          type="button"
          onClick={() => { setMode('all'); setRouteFilter(''); setBusFilter(''); setDriverFilter(''); }}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            mode === 'all'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          <History size={14} />
          All Trips ({trips.length})
        </button>

        <button
          type="button"
          onClick={() => setMode('routewise')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            mode === 'routewise'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          <Route size={14} />
          🛣️ Route-wise
        </button>

        <button
          type="button"
          onClick={() => setMode('buswise')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            mode === 'buswise'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          <Bus size={14} />
          🚌 Bus-wise
        </button>

        <button
          type="button"
          onClick={() => setMode('timewise')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            mode === 'timewise'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          <Clock size={14} />
          ⏱️ Time-wise
        </button>

        <button
          type="button"
          onClick={() => setMode('driverwise')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            mode === 'driverwise'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          <User size={14} />
          👤 Driver-wise
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2 lg:grid-cols-6">
        {/* Search */}
        <div className="relative lg:col-span-2">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search schedule code, bus, driver..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
        </div>

        {/* Date Quick Filter */}
        <div>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="48h">Last 48 Hours (Full Retention)</option>
            <option value="today">Today Only</option>
            <option value="yesterday">Yesterday</option>
          </select>
        </div>

        {/* Route Filter */}
        <div>
          <select
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="">All Routes</option>
            {filterOptions?.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.route_name}
              </option>
            ))}
          </select>
        </div>

        {/* Bus Filter */}
        <div>
          <select
            value={busFilter}
            onChange={(e) => setBusFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="">All Buses</option>
            {filterOptions?.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration_number} {v.company_model ? `(${v.company_model})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Time Slot Filter */}
        <div>
          <select
            value={timeSlotFilter}
            onChange={(e) => setTimeSlotFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">All Day (24h)</option>
            <option value="morning">Morning (06:00 - 12:00)</option>
            <option value="afternoon">Afternoon (12:00 - 18:00)</option>
            <option value="evening">Evening (18:00 - 24:00)</option>
            <option value="night">Night (00:00 - 06:00)</option>
          </select>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {/* Main Grid: Trip List on Left, Interactive Trajectory Map & Replay on Right */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left Column: Trips List / Groups */}
        <div className="xl:col-span-4 2xl:col-span-4">
          <Card padding={false} className="overflow-hidden shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/75 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {mode === 'all' && 'Trip Journeys'}
                  {mode === 'routewise' && 'Trips by Route'}
                  {mode === 'buswise' && 'Trips by Bus'}
                  {mode === 'timewise' && 'Trips by Departure Time'}
                  {mode === 'driverwise' && 'Trips by Driver'}
                </h2>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {trips.length}
                </span>
              </div>

              <span className="text-[11px] text-slate-500">Click trip to inspect</span>
            </div>

            {loading ? (
              <div className="p-8">
                <LoadingState message="Loading trips history..." />
              </div>
            ) : trips.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                <AlertCircle size={28} className="mx-auto mb-2 text-slate-400" />
                No trips found in the last 48 hours for the chosen filter criteria.
              </div>
            ) : (
              <div className="max-h-[750px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {/* Categorized Mode View */}
                {groupedContent ? (
                  groupedContent.map((group: any, idx: number) => {
                    const groupTitle =
                      mode === 'routewise'
                        ? group.route?.route_name || 'Unassigned Route'
                        : mode === 'buswise'
                        ? group.vehicle?.registration_number || 'Unassigned Bus'
                        : group.driver?.name || 'Unassigned Driver';

                    const groupSubtitle =
                      mode === 'routewise'
                        ? `${group.route?.origin_city || ''} → ${group.route?.destination_city || ''}`
                        : mode === 'buswise'
                        ? group.vehicle?.company_model || 'Vehicle'
                        : group.driver?.mobile || '';

                    return (
                      <div key={idx} className="border-b border-slate-200/80 p-2 dark:border-slate-800">
                        <div className="mb-1 flex items-center justify-between rounded bg-slate-100/70 px-2 py-1 text-xs font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                          <span className="truncate">{groupTitle}</span>
                          <span className="text-[10px] text-slate-500">{groupSubtitle}</span>
                        </div>
                        <div className="space-y-1.5 pl-1">
                          {group.trips.map((trip: TripItem) => (
                            <TripListItem
                              key={trip.id}
                              trip={trip}
                              isSelected={trip.id === selectedTripId}
                              onSelect={() => setSelectedTripId(trip.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  // Flat Chronological List
                  trips.map((trip) => (
                    <TripListItem
                      key={trip.id}
                      trip={trip}
                      isSelected={trip.id === selectedTripId}
                      onSelect={() => setSelectedTripId(trip.id)}
                    />
                  ))
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Interactive Map, Scrubber Playback, & Analytics */}
        <div className="space-y-4 xl:col-span-8 2xl:col-span-8">
          {/* Trip Header Card & Metrics */}
          {selectedTrip && (
            <Card padding={false} className="overflow-hidden border-t-2 border-t-teal-600 shadow-sm">
              <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-900 dark:text-white">
                        {selectedTrip.route?.route_name || 'Trip Details'}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          selectedTrip.status === 'Active'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : selectedTrip.status === 'Completed'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {selectedTrip.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Schedule: <strong className="font-semibold text-slate-700 dark:text-slate-300">{selectedTrip.schedule_code}</strong> · Date: {selectedTrip.trip_date || 'N/A'} at {selectedTrip.departure_time}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-right dark:bg-slate-800">
                      <div className="text-[10px] uppercase text-slate-400">Assigned Bus</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedTrip.vehicle?.registration_number || 'Unassigned'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-right dark:bg-slate-800">
                      <div className="text-[10px] uppercase text-slate-400">Driver</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedTrip.driver?.name || 'Unassigned'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* KPI Metrics Ribbon */}
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800/80 sm:grid-cols-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                      <MapPin size={15} />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">GPS Pings</div>
                      <div className="text-xs font-bold text-slate-800 dark:text-white">
                        {tripLocations.length} points
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      <Route size={15} />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Distance Driven</div>
                      <div className="text-xs font-bold text-slate-800 dark:text-white">
                        {distanceKm} km
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                      <Gauge size={15} />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Max Speed</div>
                      <div className="text-xs font-bold text-slate-800 dark:text-white">
                        {selectedTrip.location_stats?.max_speed_kmh || 0} km/h
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                      <Clock size={15} />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Started At</div>
                      <div className="text-xs font-bold text-slate-800 dark:text-white">
                        {selectedTrip.started_at ? new Date(selectedTrip.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Map Canvas */}
              <div className="relative h-[480px] w-full bg-slate-100 dark:bg-slate-950">
                {loadingTripLocations ? (
                  <div className="flex h-full items-center justify-center">
                    <LoadingState message="Loading GPS breadcrumbs..." />
                  </div>
                ) : (
                  <MapContainer center={[19.076, 72.877]} zoom={12} className="h-full w-full z-0">
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
                    />

                    <MapViewportAdjuster
                      coordinates={trajectoryPositions}
                      selectedPoint={currentScrubberPoint ? currentScrubberPoint.position : null}
                    />

                    {/* Polyline Trajectory */}
                    {trajectoryPositions.length > 1 && (
                      <Polyline
                        positions={trajectoryPositions}
                        pathOptions={{
                          color: '#0284c7',
                          weight: 5,
                          opacity: 0.85,
                          lineCap: 'round',
                          lineJoin: 'round',
                        }}
                      />
                    )}

                    {/* Start Marker (Green) */}
                    {trajectoryPositions.length > 0 && (
                      <Marker position={trajectoryPositions[0]} icon={createStartIcon()}>
                        <Popup>
                          <div className="text-xs">
                            <strong className="text-emerald-700">Trip Starting Point</strong>
                            <div>Time: {new Date(tripLocations[0].recorded_at).toLocaleTimeString()}</div>
                            <div>Speed: {tripLocations[0].speed_kmh ?? 0} km/h</div>
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* End Marker (Red/Blue) */}
                    {trajectoryPositions.length > 1 && (
                      <Marker
                        position={trajectoryPositions[trajectoryPositions.length - 1]}
                        icon={createEndIcon(selectedTrip.status === 'Active')}
                      >
                        <Popup>
                          <div className="text-xs">
                            <strong className={selectedTrip.status === 'Active' ? 'text-blue-600' : 'text-rose-600'}>
                              {selectedTrip.status === 'Active' ? 'Latest Active GPS Ping' : 'Trip Destination End'}
                            </strong>
                            <div>
                              Time:{' '}
                              {new Date(
                                tripLocations[tripLocations.length - 1].recorded_at
                              ).toLocaleTimeString()}
                            </div>
                            <div>Speed: {tripLocations[tripLocations.length - 1].speed_kmh ?? 0} km/h</div>
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* Active Scrubber Marker */}
                    {currentScrubberPoint && (
                      <Marker position={currentScrubberPoint.position} icon={createScrubberIcon(Number(currentScrubberPoint.location.speed_kmh))}>
                        <Popup>
                          <div className="text-xs font-sans">
                            <strong className="text-amber-600">Replay Ping #{scrubberIndex! + 1}</strong>
                            <div>Time: {new Date(currentScrubberPoint.location.recorded_at).toLocaleTimeString()}</div>
                            <div>Speed: {currentScrubberPoint.location.speed_kmh ?? 0} km/h</div>
                            {currentScrubberPoint.location.heading && <div>Heading: {currentScrubberPoint.location.heading}°</div>}
                            {currentScrubberPoint.location.battery_level && <div>Battery: {currentScrubberPoint.location.battery_level}%</div>}
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* Stop markers along the route */}
                    {(tripDetail?.route?.stops || []).map((stop: RouteStop) => {
                      if (!stop.latitude || !stop.longitude) return null;
                      const stopPos: Position = [Number(stop.latitude), Number(stop.longitude)];
                      return (
                        <Marker key={`stop-${stop.id}`} position={stopPos} icon={createStopPinIcon(stop.stop_sequence)}>
                          <Popup>
                            <div className="text-xs">
                              <strong>Stop {stop.stop_sequence}: {stop.stop_name}</strong>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                )}

                {/* Map Legend Overlay */}
                <div className="absolute left-3 top-3 z-[1000] flex items-center gap-3 rounded-md border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Start
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> GPS Path
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> End
                  </span>
                </div>

                {tripLocations.length === 0 && !loadingTripLocations && (
                  <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/80 dark:bg-slate-900/80">
                    <div className="text-center text-xs text-slate-500">
                      <AlertCircle size={24} className="mx-auto mb-1 text-slate-400" />
                      No GPS coordinates recorded for this trip yet.
                    </div>
                  </div>
                )}
              </div>

              {/* Timeline Replay & Scrubber Bar */}
              {tripLocations.length > 0 && (
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-white shadow transition hover:bg-teal-700"
                        title={isPlaying ? 'Pause replay' : 'Play trajectory replay'}
                      >
                        {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setScrubberIndex(0);
                        }}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                        title="Restart from beginning"
                      >
                        <RotateCcw size={14} />
                      </button>

                      <div className="text-xs">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          Point {(scrubberIndex ?? 0) + 1} of {tripLocations.length}
                        </span>
                        {currentScrubberPoint && (
                          <span className="ml-2 text-slate-500">
                            ({new Date(currentScrubberPoint.location.recorded_at).toLocaleTimeString()},{' '}
                            {currentScrubberPoint.location.speed_kmh ?? 0} km/h)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 sm:max-w-md">
                      <input
                        type="range"
                        min={0}
                        max={tripLocations.length - 1}
                        value={scrubberIndex ?? 0}
                        onChange={(e) => {
                          setIsPlaying(false);
                          setScrubberIndex(Number(e.target.value));
                        }}
                        className="w-full accent-teal-600"
                      />
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Breadcrumbs Table Log */}
          {tripLocations.length > 0 && (
            <Card padding={false} className="overflow-hidden shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-white">
                <span>Recent GPS Breadcrumb Pings ({tripLocations.length})</span>
                <span className="text-[10px] font-normal text-slate-500">Chronological Order</span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-[10px] uppercase text-slate-500 dark:bg-slate-800">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Coordinates</th>
                      <th className="px-3 py-2">Speed</th>
                      <th className="px-3 py-2">Heading</th>
                      <th className="px-3 py-2">Accuracy</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {tripLocations.map((loc, idx) => (
                      <tr
                        key={loc.id}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                          scrubberIndex === idx ? 'bg-teal-50 dark:bg-teal-950/40' : ''
                        }`}
                      >
                        <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium">{new Date(loc.recorded_at).toLocaleTimeString()}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {Number(loc.latitude).toFixed(5)}, {Number(loc.longitude).toFixed(5)}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {loc.speed_kmh != null ? `${loc.speed_kmh} km/h` : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{loc.heading != null ? `${loc.heading}°` : '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{loc.accuracy != null ? `±${loc.accuracy}m` : '—'}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => {
                              setIsPlaying(false);
                              setScrubberIndex(idx);
                            }}
                            className="font-medium text-teal-600 hover:underline dark:text-teal-400"
                          >
                            Locate
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

// Subcomponent for each trip item in list
const TripListItem: React.FC<{
  trip: TripItem;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ trip, isSelected, onSelect }) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition ${
        isSelected
          ? 'border-teal-500 bg-teal-50/70 shadow-sm dark:border-teal-600 dark:bg-teal-950/30'
          : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-slate-800/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
            <Bus size={13} className="text-teal-600" />
            <span className="truncate">{trip.vehicle?.registration_number || 'No Bus'}</span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">{trip.schedule_code}</span>
          </div>

          <div className="mt-1 truncate text-xs text-slate-700 dark:text-slate-300">
            {trip.route?.route_name || 'Route'}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <span>👤 {trip.driver?.name || 'Unassigned'}</span>
            <span>·</span>
            <span>📅 {trip.trip_date || 'Date N/A'} at {trip.departure_time}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
              trip.status === 'Active'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : trip.status === 'Completed'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {trip.status}
          </span>

          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
            <MapPin size={10} className="text-teal-600" />
            {trip.location_stats?.total_points || 0} pings
          </span>
        </div>
      </div>
    </button>
  );
};
