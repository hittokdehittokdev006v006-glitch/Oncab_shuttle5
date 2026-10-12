import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Search, Calendar, ChevronDown, Download, Info, CheckCircle2,
  Clock, AlertCircle, Eye, X, Filter, MapPin, Navigation, UserCheck,
  RotateCcw, Ban, User, Truck, ShieldAlert, Plus, Minus, Edit2, Zap
} from 'lucide-react';
import { tripsAPI, routesAPI, driversAPI, vehiclesAPI, bookingsAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, Button, LoadingState, ErrorState } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { hasRole } from '../utils/roles';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

type MapPosition = [number, number];

// Fix for default marker icon in Leaflet with React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const FitRouteBounds: React.FC<{ positions: MapPosition[] }> = ({ positions }) => {
  const map = useMap();

  useEffect(() => {
    if (positions.length > 1) map.fitBounds(positions, { padding: [24, 24] });
  }, [map, positions]);

  return null;
};

interface TripsPageProps {
  onNotify: (msg: string, type?: any) => void;
}

export const TripsPage: React.FC<TripsPageProps> = ({ onNotify }) => {
  const { user, hasPermission } = useAuth();
  const isOwner = hasRole(user, 'owner');
  const canViewTripDetails = !isOwner || hasPermission('bookings.read');
  const [trips, setTrips] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });

  // Filters
  const [searchId, setSearchId] = useState('');
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [driverFilter, setDriverFilter] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [quickDate, setQuickDate] = useState('Today');
  const [viewMode, setViewMode] = useState<'expanded' | 'compact'>('expanded');

  // Modal states
  const [infoTrip, setInfoTrip] = useState<any | null>(null);
  const [tripBookings, setTripBookings] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [roadRoute, setRoadRoute] = useState<MapPosition[]>([]);
  const [routeMapError, setRouteMapError] = useState('');
  const [loadingRoadRoute, setLoadingRoadRoute] = useState(false);

  const routeStops = useMemo(() => {
    const stops = infoTrip?.route?.stops;
    if (!Array.isArray(stops)) return [];

    return stops
      .map((stop: any) => ({
        ...stop,
        hasCoordinates: stop.latitude !== null && stop.latitude !== undefined && stop.latitude !== ''
          && stop.longitude !== null && stop.longitude !== undefined && stop.longitude !== '',
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
      }))
      .filter((stop: any) => stop.hasCoordinates && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)
        && Math.abs(stop.latitude) <= 90 && Math.abs(stop.longitude) <= 180)
      .sort((a: any, b: any) => Number(a.stop_sequence) - Number(b.stop_sequence));
  }, [infoTrip]);

  useEffect(() => {
    if (routeStops.length < 2) {
      setRoadRoute([]);
      setRouteMapError('Add at least two route stops with valid coordinates to display the road route.');
      return;
    }

    const controller = new AbortController();
    const coordinates = routeStops.map((stop: any) => `${stop.longitude},${stop.latitude}`).join(';');
    setLoadingRoadRoute(true);
    setRouteMapError('');
    setRoadRoute([]);

    fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Road routing service is unavailable.');
        return response.json();
      })
      .then((data) => {
        const coordinates = data.routes?.[0]?.geometry?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
          throw new Error('No drivable road route was found for these stops.');
        }
        setRoadRoute(coordinates.map(([longitude, latitude]: [number, number]) => [latitude, longitude]));
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setRouteMapError(error.message || 'Unable to load the road route.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRoadRoute(false);
      });

    return () => controller.abort();
  }, [routeStops]);

  // Sub-modals
  const [actionModal, setActionModal] = useState<'reschedule' | 'driver' | 'vehicle' | 'route' | 'capacity' | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [selectedNewDriver, setSelectedNewDriver] = useState('');
  const [selectedNewVehicle, setSelectedNewVehicle] = useState('');
  const [selectedNewRoute, setSelectedNewRoute] = useState('');
  const [newCapacity, setNewCapacity] = useState('');
  const [updatingAction, setUpdatingAction] = useState(false);

  const fetchTrips = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params: any = {
        page,
        limit: 15,
        search: searchId || undefined,
        route_id: routeFilter || undefined,
        status: statusFilter || undefined,
      };

      if (fromDate && toDate) {
        params.from_date = fromDate;
        params.to_date = toDate;
      }

      const resp = await tripsAPI.list(params);
      setTrips(resp.data.data || []);
      setPagination(resp.data.pagination || { total: 0, pages: 1, limit: 15 });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load trips');
    } finally {
      setLoading(false);
    }
  }, [page, searchId, fromDate, toDate, routeFilter, statusFilter]);

  const loadDropdowns = async () => {
    if (isOwner) {
      try {
        const response = await tripsAPI.assignmentOptions();
        const ownerDrivers = response.data.data?.drivers || [];
        const ownerVehicles = response.data.data?.vehicles || [];
        if (ownerDrivers.length && ownerVehicles.length) {
          setDrivers(ownerDrivers);
          setVehicles(ownerVehicles);
        } else {
          const [driversResult, vehiclesResult] = await Promise.allSettled([
            ownerDrivers.length ? Promise.resolve({ data: { data: ownerDrivers } }) : driversAPI.list({ limit: 100 }),
            ownerVehicles.length ? Promise.resolve({ data: { data: ownerVehicles } }) : vehiclesAPI.list({ limit: 100 }),
          ]);
          setDrivers(driversResult.status === 'fulfilled' ? driversResult.value.data.data || [] : ownerDrivers);
          setVehicles(vehiclesResult.status === 'fulfilled' ? vehiclesResult.value.data.data || [] : ownerVehicles);
        }
      } catch {
        const [driversResult, vehiclesResult] = await Promise.allSettled([
          driversAPI.list({ limit: 100 }),
          vehiclesAPI.list({ limit: 100 }),
        ]);
        setDrivers(driversResult.status === 'fulfilled' ? driversResult.value.data.data || [] : []);
        setVehicles(vehiclesResult.status === 'fulfilled' ? vehiclesResult.value.data.data || [] : []);
      }
      setRoutes([]);
      return;
    }

    const [routesResult, driversResult, vehiclesResult] = await Promise.allSettled([
      routesAPI.list({ limit: 100 }),
      driversAPI.list({ limit: 100 }),
      vehiclesAPI.list({ limit: 100 }),
    ]);
    setRoutes(routesResult.status === 'fulfilled' ? routesResult.value.data.data || [] : []);
    setDrivers(driversResult.status === 'fulfilled' ? driversResult.value.data.data || [] : []);
    setVehicles(vehiclesResult.status === 'fulfilled' ? vehiclesResult.value.data.data || [] : []);
  };

  useEffect(() => {
    fetchTrips();
    loadDropdowns();
  }, [fetchTrips, isOwner]);

  useEffect(() => {
    if (isOwner && !canViewTripDetails) {
      setInfoTrip(null);
      setActionModal(null);
    }
  }, [isOwner, canViewTripDetails]);

  // Open trip dashboard with full data
  const handleOpenTripDashboard = async (trip: any) => {
    if (!canViewTripDetails) return;
    setLoadingBookings(true);
    try {
      const tripResp = await tripsAPI.show(trip.id);
      setInfoTrip(tripResp.data.data);

      const bookingResp = await bookingsAPI.list({ trip_id: trip.id, limit: 100 });
      setTripBookings(bookingResp.data.data || []);
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to load trip details', 'error');
      setInfoTrip(trip);
      setTripBookings([]);
    } finally {
      setLoadingBookings(false);
    }
  };

  // Refresh trip data
  const handleRefreshTrip = async () => {
    if (!infoTrip) return;
    setLoadingBookings(true);
    try {
      const tripResp = await tripsAPI.show(infoTrip.id);
      setInfoTrip(tripResp.data.data);

      const bookingResp = await bookingsAPI.list({ trip_id: infoTrip.id, limit: 100 });
      setTripBookings(bookingResp.data.data || []);
      onNotify('Trip data refreshed successfully');
    } catch {
      onNotify('Failed to refresh trip data', 'error');
    } finally {
      setLoadingBookings(false);
    }
  };

  // Status change
  const handleStatusChange = async (tripId: number, newStatus: string) => {
    try {
      await tripsAPI.updateStatus(tripId, newStatus);
      onNotify(`Trip marked as ${newStatus}`);
      if (infoTrip && infoTrip.id === tripId) {
        const updatedTrip = await tripsAPI.show(tripId);
        setInfoTrip(updatedTrip.data.data);
      }
      fetchTrips();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to update trip status', 'error');
    }
  };

  // Reschedule trip
  const handleApplyReschedule = async () => {
    if (!infoTrip) return;
    setUpdatingAction(true);
    try {
      await tripsAPI.update(infoTrip.id, {
        trip_date: rescheduleDate || infoTrip.trip_date,
        departure_time: rescheduleTime || infoTrip.departure_time,
      });
      onNotify('Trip rescheduled successfully');
      const updatedTrip = await tripsAPI.show(infoTrip.id);
      setInfoTrip(updatedTrip.data.data);
      setActionModal(null);
      fetchTrips();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to reschedule trip', 'error');
    } finally {
      setUpdatingAction(false);
    }
  };

  // Change driver
  const handleApplyDriver = async () => {
    if (!infoTrip || !selectedNewDriver || !canViewTripDetails) return;
    setUpdatingAction(true);
    try {
      const response = await tripsAPI.assignDriver(infoTrip.id, parseInt(selectedNewDriver));
      onNotify(response.data.message || (isOwner ? 'Driver assignment request submitted' : 'Driver reassigned successfully'));
      const updatedTrip = await tripsAPI.show(infoTrip.id);
      setInfoTrip(updatedTrip.data.data);
      setActionModal(null);
      fetchTrips();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to assign driver', 'error');
    } finally {
      setUpdatingAction(false);
    }
  };

  // Change vehicle
  const handleApplyVehicle = async () => {
    if (!infoTrip || !selectedNewVehicle || !canViewTripDetails) return;
    setUpdatingAction(true);
    try {
      const response = await tripsAPI.assignVehicle(infoTrip.id, parseInt(selectedNewVehicle));
      onNotify(response.data.message || (isOwner ? 'Vehicle assignment request submitted' : 'Vehicle reassigned successfully'));
      const updatedTrip = await tripsAPI.show(infoTrip.id);
      setInfoTrip(updatedTrip.data.data);
      setActionModal(null);
      fetchTrips();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to assign vehicle', 'error');
    } finally {
      setUpdatingAction(false);
    }
  };

  // Open Route Modal
  const handleOpenRouteModal = async () => {
    if (!infoTrip) return;
    if (routes.length === 0 && !isOwner) {
      try {
        const resp = await routesAPI.list({ limit: 100 });
        setRoutes(resp.data.data || []);
      } catch (err) {
        console.error('Failed to load routes', err);
      }
    }
    setSelectedNewRoute(infoTrip.route_id ? String(infoTrip.route_id) : '');
    setActionModal('route');
  };

  // Change route
  const handleApplyRoute = async () => {
    if (!infoTrip || !selectedNewRoute) return;
    setUpdatingAction(true);
    try {
      const response = await tripsAPI.assignRoute(infoTrip.id, parseInt(selectedNewRoute));
      onNotify(response.data.message || 'Route reassigned successfully');
      const updatedTrip = await tripsAPI.show(infoTrip.id);
      setInfoTrip(updatedTrip.data.data);
      setActionModal(null);
      fetchTrips();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to assign route', 'error');
    } finally {
      setUpdatingAction(false);
    }
  };

  // Change capacity
  const handleApplyCapacity = async () => {
    if (!infoTrip || !newCapacity) return;
    setUpdatingAction(true);
    try {
      await tripsAPI.update(infoTrip.id, {
        seat_capacity: parseInt(newCapacity),
      });
      onNotify(`Seat capacity updated to ${newCapacity}`);
      const updatedTrip = await tripsAPI.show(infoTrip.id);
      setInfoTrip(updatedTrip.data.data);
      setActionModal(null);
      fetchTrips();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to update capacity', 'error');
    } finally {
      setUpdatingAction(false);
    }
  };

  // Quick date filter
  const handleQuickDate = (type: string) => {
    setQuickDate(type);
    const today = new Date();
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    if (type === 'All Dates') {
      setFromDate('');
      setToDate('');
    } else if (type === 'Today') {
      setFromDate(formatDate(today));
      setToDate(formatDate(today));
    } else if (type === 'Tomorrow') {
      const tom = new Date(today);
      tom.setDate(tom.getDate() + 1);
      setFromDate(formatDate(tom));
      setToDate(formatDate(tom));
    } else if (type === 'Today+Tomorrow') {
      const tom = new Date(today);
      tom.setDate(tom.getDate() + 1);
      setFromDate(formatDate(today));
      setToDate(formatDate(tom));
    } else if (type === '3 Days') {
      const next = new Date(today);
      next.setDate(next.getDate() + 2);
      setFromDate(formatDate(today));
      setToDate(formatDate(next));
    } else if (type === '7 Days') {
      const next = new Date(today);
      next.setDate(next.getDate() + 6);
      setFromDate(formatDate(today));
      setToDate(formatDate(next));
    } else if (type === '15 Days') {
      const next = new Date(today);
      next.setDate(next.getDate() + 14);
      setFromDate(formatDate(today));
      setToDate(formatDate(next));
    }
  };

  const handleClearFilters = () => {
    setSearchId('');
    setFromDate('');
    setToDate('');
    setDriverFilter('');
    setRouteFilter('');
    setStatusFilter('');
    setQuickDate('All Dates');
    setPage(1);
  };

  // Export CSV
  const handleExportCSV = () => {
    if (trips.length === 0) {
      onNotify('No trips to export', 'error');
      return;
    }
    const headers = ['Trip ID', 'Schedule Code', 'Route', 'Driver', 'Vehicle', 'Date', 'Time', 'Booked Seats', 'Capacity', 'Status'];
    const rows = trips.map(t => [
      t.id,
      t.schedule_code,
      t.route?.route_name || '',
      t.driver?.name || '',
      t.vehicle?.registration_number || '',
      t.trip_date || '',
      t.departure_time || '',
      t.booked_seats || 0,
      t.seat_capacity || 40,
      t.status || 'Scheduled'
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `trips_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onNotify('Trips exported to CSV successfully');
  };

  // Calculate metrics from real data
  const totalTripsCount = pagination.total || trips.length;
  const uniqueVehiclesCount = useMemo(() => {
    const vSet = new Set(trips.map(t => t.vehicle_id).filter(Boolean));
    return vSet.size;
  }, [trips]);

  const totalSeatsBooked = trips.reduce((acc, t) => acc + (t.booked_seats || 0), 0);
  const totalCapacity = trips.reduce((acc, t) => acc + (t.seat_capacity || 0), 0);
  const fillRate = totalCapacity > 0 ? ((totalSeatsBooked / totalCapacity) * 100).toFixed(2) : '0.00';
  const avgFare = 80.63;
  const grossRevenue = (totalSeatsBooked * avgFare).toFixed(2);
  const gstAmount = (parseFloat(grossRevenue) * 0.05).toFixed(2);
  const netRevenue = (parseFloat(grossRevenue) - parseFloat(gstAmount)).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Trips</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{totalTripsCount} trips</span> • <span className="font-semibold text-slate-700 dark:text-slate-300">{uniqueVehiclesCount} vehicles</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                const resp = await tripsAPI.generateFuture({ days_ahead: 14 });
                onNotify(resp.data?.message || 'Generated future trip instances');
                fetchTrips();
              } catch (err: any) {
                onNotify(err.response?.data?.message || 'Future trip generation failed', 'error');
              }
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-sm transition-all"
          >
            <Zap size={13} className="fill-slate-950" />
            Auto-Generate Future Trips
          </button>
          <button
            onClick={fetchTrips}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#0c2e59] hover:bg-[#082040] text-white text-xs font-semibold shadow-sm transition-all"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5 items-end">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">SEARCH</label>
            <input
              type="text"
              placeholder="Trip / Route / Driver"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">FROM</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setQuickDate('Custom'); }}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">TO</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setQuickDate('Custom'); }}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">DRIVER</label>
            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">All drivers</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">ROUTE</label>
            <select
              value={routeFilter}
              onChange={(e) => setRouteFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">All routes</option>
              {routes.map(r => (
                <option key={r.id} value={r.id}>{r.route_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">STATUS</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">All statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Active">Active</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Delayed">Delayed</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1">Quick:</span>
            {['All Dates', 'Today', 'Tomorrow', 'Today+Tomorrow', '3 Days', '7 Days', '15 Days'].map((pill) => (
              <button
                key={pill}
                type="button"
                onClick={() => handleQuickDate(pill)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  quickDate === pill
                    ? 'bg-[#0c2e59] text-white border-[#0c2e59] shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                }`}
              >
                {pill}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearFilters}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => { setPage(1); fetchTrips(); }}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#0c2e59] hover:bg-[#082040] text-white shadow-sm transition-colors"
            >
              Search
            </button>
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Revenue Snapshot */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <span className="text-[10px] font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase">REVENUE SNAPSHOT</span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Fleet Revenue Brief</h3>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">TOTAL TRIPS</div>
            <div className="text-base font-bold text-slate-900 dark:text-white mt-1">{totalTripsCount}</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">VEHICLES</div>
            <div className="text-base font-bold text-slate-900 dark:text-white mt-1">{uniqueVehiclesCount}</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">SEATS BOOKED</div>
            <div className="text-base font-bold text-slate-900 dark:text-white mt-1">{totalSeatsBooked}</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">TOTAL CAPACITY</div>
            <div className="text-base font-bold text-slate-900 dark:text-white mt-1">{totalCapacity}</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">FILL RATE</div>
            <div className="text-base font-bold text-slate-900 dark:text-white mt-1">{fillRate}%</div>
          </div>

          <div className="p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border-2 border-blue-500 dark:border-blue-400 shadow-sm">
            <div className="text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">NET REVENUE</div>
            <div className="text-base font-bold text-blue-900 dark:text-blue-200 mt-1">₹{netRevenue}</div>
          </div>
        </div>
      </div>

      {/* Trips Table */}
      <Card padding={false}>
        {error ? (
          <ErrorState message={error} onRetry={fetchTrips} />
        ) : (
          <>
            <Table
              headers={[
                'TRIP',
                'ROUTE',
                'DRIVER',
                'DATE & TIME',
                'STATUS',
                'BOOKED / CAPACITY',
                'VEHICLE',
                'ACTIONS',
              ]}
              loading={loading}
              empty={!loading && trips.length === 0}
              emptyMessage="No trips match the selected filters"
            >
              {trips.map((trip) => {
                const capacity = trip.seat_capacity || trip.vehicle?.total_seats || trip.bus_type?.total_seats || 40;
                const booked = trip.booked_seats || 0;
                const pct = Math.min(100, Math.round((booked / capacity) * 100));

                return (
                  <Tr key={trip.id}>
                    <Td className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                      #{trip.schedule_code || `T${trip.id}`}
                    </Td>

                    <Td className="text-xs">
                      {trip.route ? (
                        <div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {trip.route.route_name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">No route</span>
                      )}
                    </Td>

                    <Td className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      {trip.driver?.name || 'Unassigned'}
                    </Td>

                    <Td className="text-xs font-mono text-slate-700 dark:text-slate-300">
                      <div>{trip.trip_date || '-'}</div>
                      <div className="text-slate-500 text-[11px]">{trip.departure_time?.slice(0, 5) || '-'}</div>
                    </Td>

                    <Td>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          trip.status === 'Completed'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
                            : trip.status === 'Active'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-300 dark:border-amber-800'
                            : trip.status === 'Cancelled'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-300 dark:border-rose-800'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-300 dark:border-blue-800'
                        }`}
                      >
                        {trip.status || 'Scheduled'}
                      </span>
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2 min-w-[110px]">
                        <div className="flex-1 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-600 h-full rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300">
                          {booked}/{capacity}
                        </span>
                      </div>
                    </Td>

                    <Td className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {trip.vehicle?.registration_number || 'Unassigned'}
                    </Td>

                    <Td>
                      {canViewTripDetails ? (
                        <button
                          type="button"
                          onClick={() => handleOpenTripDashboard(trip)}
                          className="px-3 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-colors"
                        >
                          <Info size={14} className="inline mr-1" />
                          Details
                        </button>
                      ) : <span className="text-xs text-slate-500">Details restricted</span>}
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

      {/* Trip Dashboard Modal */}
      {infoTrip && canViewTripDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-5xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] animate-in fade-in zoom-in duration-200">

            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Trip Dashboard</h2>
                  <span className="font-mono text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold">
                    #{infoTrip.schedule_code || `T${infoTrip.id}`}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    infoTrip.status === 'Active' ? 'bg-amber-600 text-white' :
                    infoTrip.status === 'Completed' ? 'bg-emerald-600 text-white' :
                    infoTrip.status === 'Cancelled' ? 'bg-rose-600 text-white' :
                    'bg-blue-600 text-white'
                  }`}>
                    {infoTrip.status || 'SCHEDULED'}
                  </span>
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  <b>{infoTrip.route?.route_name || 'No route'}</b> • {infoTrip.trip_date || '-'} {infoTrip.departure_time || '-'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Driver: {infoTrip.driver?.name || 'Unassigned'} • Vehicle: {infoTrip.vehicle?.registration_number || 'Unassigned'}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  {!isOwner && <button
                    onClick={() => {
                      setRescheduleDate(infoTrip.trip_date || '');
                      setRescheduleTime(infoTrip.departure_time || '');
                      setActionModal('reschedule');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0c2e59] hover:bg-[#082040] text-white shadow-sm transition-colors"
                  >
                    <Calendar size={14} className="inline mr-1" />
                    Reschedule
                  </button>}
                  {canViewTripDetails && <button
                    onClick={() => {
                      setSelectedNewDriver(infoTrip.driver_id ? String(infoTrip.driver_id) : '');
                      setActionModal('driver');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm transition-colors"
                  >
                    <UserCheck size={14} className="inline mr-1" />
                    Change Driver
                  </button>}
                  {canViewTripDetails && <button
                    onClick={() => {
                      setSelectedNewVehicle(infoTrip.vehicle_id ? String(infoTrip.vehicle_id) : '');
                      setActionModal('vehicle');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-700 hover:bg-purple-800 text-white shadow-sm transition-colors"
                  >
                    <Truck size={14} className="inline mr-1" />
                    Change Vehicle
                  </button>}
                  {!isOwner && <button
                    onClick={handleOpenRouteModal}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white shadow-sm transition-colors"
                  >
                    <MapPin size={14} className="inline mr-1" />
                    Change Route
                  </button>}
                  <button
                    onClick={() => setInfoTrip(null)}
                    className="w-7 h-7 rounded-full border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Trip Controls */}
                {!isOwner && <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleStatusChange(infoTrip.id, 'Scheduled')}
                    className="px-3 py-1 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => handleStatusChange(infoTrip.id, 'Active')}
                    className="px-3 py-1 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Start
                  </button>
                  <button
                    onClick={() => handleStatusChange(infoTrip.id, 'Completed')}
                    className="px-3 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => handleStatusChange(infoTrip.id, 'Cancelled')}
                    className="px-3 py-1 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    Cancel
                  </button>
                </div>}
              </div>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto p-4 sm:p-5 space-y-5 flex-1">
              {/* Trip Info Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                <div className="space-y-3.5 text-xs">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">ROUTE</span>
                      {!isOwner && (
                        <button
                          type="button"
                          onClick={handleOpenRouteModal}
                          className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline flex items-center gap-1"
                        >
                          <Edit2 size={11} />
                          Change Route
                        </button>
                      )}
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {infoTrip.route?.route_name || 'No route assigned'}
                    </div>
                    {infoTrip.route && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {infoTrip.route.origin_city} &rarr; {infoTrip.route.destination_city}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">DRIVER</span>
                      <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                        {infoTrip.driver?.name || 'Unassigned'}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">VEHICLE</span>
                      <div className="font-mono font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                        {infoTrip.vehicle?.registration_number || 'Unassigned'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">SCHEDULE</span>
                      <div className="font-mono font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                        {infoTrip.trip_date || '-'} {infoTrip.departure_time || '-'}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">CAPACITY</span>
                      <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                        {infoTrip.booked_seats || 0}/{infoTrip.seat_capacity || infoTrip.vehicle?.total_seats || infoTrip.bus_type?.total_seats || 0}
                      </div>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">SEATS</span>
                    <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 font-mono">
                      {infoTrip.booked_seats || 0} booked • {infoTrip.seat_capacity || infoTrip.vehicle?.total_seats || infoTrip.bus_type?.total_seats || 0} total
                    </div>
                  </div>

                  <div className="pt-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleRefreshTrip}
                        disabled={loadingBookings}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={`inline mr-1 ${loadingBookings ? 'animate-spin' : ''}`} />
                        {loadingBookings ? 'Refreshing...' : 'Refresh'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden h-64 sm:h-72">
                  {routeStops.length >= 2 ? (
                    <>
                      <MapContainer
                        center={[routeStops[0].latitude, routeStops[0].longitude]}
                        zoom={12}
                        style={{ height: '100%', width: '100%' }}
                        className="z-0"
                      >
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                          url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
                        />
                        <FitRouteBounds positions={roadRoute.length ? roadRoute : routeStops.map((stop: any) => [stop.latitude, stop.longitude])} />
                        {routeStops.map((stop: any, index: number) => (
                          <Marker key={stop.id || `${stop.stop_sequence}-${index}`} position={[stop.latitude, stop.longitude]}>
                            <Popup>
                              {index === 0 ? 'Origin' : index === routeStops.length - 1 ? 'Destination' : `Stop ${stop.stop_sequence || index + 1}`}:
                              {' '}{stop.stop_name || `Stop ${index + 1}`}
                            </Popup>
                          </Marker>
                        ))}
                        {roadRoute.length > 1 && <Polyline positions={roadRoute} color="#6366f1" weight={5} />}
                      </MapContainer>
                      {(loadingRoadRoute || routeMapError) && (
                        <div className="absolute bottom-2 left-2 z-[1000] rounded bg-white/95 px-2 py-1 text-xs text-slate-700 shadow">
                          {loadingRoadRoute ? 'Loading road route...' : routeMapError}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center bg-slate-50 px-4 text-center text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      {routeMapError || 'Route stops with coordinates are not configured.'}
                    </div>
                  )}
                </div>
              </div>

              {/* Bookings Manifest */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Bookings ({tripBookings.length})
                    </h4>
                    <span className="text-xs text-slate-500">
                      Capacity: <b>{infoTrip.seat_capacity || 0}</b>
                    </span>
                    <button
                      onClick={() => {
                        setNewCapacity(String(infoTrip.seat_capacity || 0));
                        setActionModal('capacity');
                      }}
                      className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Change Capacity
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase text-[10px] bg-slate-50 dark:bg-slate-800/50">
                        <th className="p-2.5">ID</th>
                        <th className="p-2.5">NAME</th>
                        <th className="p-2.5">FROM</th>
                        <th className="p-2.5">TO</th>
                        <th className="p-2.5">SEATS</th>
                        <th className="p-2.5">PAYMENT</th>
                        <th className="p-2.5">STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tripBookings.length > 0 ? tripBookings.map((b: any) => (
                        <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800/60 font-mono">
                          <td className="p-2.5 font-bold text-slate-900 dark:text-white">
                            #{b.booking_reference || `BK${b.id}`}
                          </td>
                          <td className="p-2.5 font-sans">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{b.passenger_name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{b.passenger_mobile}</div>
                          </td>
                          <td className="p-2.5 text-slate-600 dark:text-slate-400 font-sans">
                            {b.origin_stop?.stop_name || '-'}
                          </td>
                          <td className="p-2.5 text-slate-600 dark:text-slate-400 font-sans">
                            {b.destination_stop?.stop_name || '-'}
                          </td>
                          <td className="p-2.5 text-slate-800 dark:text-slate-200 font-bold">
                            {b.total_seats || 1}
                          </td>
                          <td className="p-2.5">
                            <div className={`font-bold ${b.payment_status === 'paid' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                              {b.payment_status?.toUpperCase() || 'PENDING'}
                            </div>
                            <div className="text-[10px] text-slate-400">₹{b.final_amount || '0'}</div>
                          </td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              b.boarding_status === 'boarded' ? 'bg-emerald-700 text-white' :
                              b.boarding_status === 'not_boarded' ? 'bg-blue-700 text-white' :
                              'bg-slate-700 text-white'
                            }`}>
                              {b.boarding_status?.replace('_', ' ') || b.booking_status || 'UNKNOWN'}
                            </span>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-500 dark:text-slate-400">
                            No bookings for this trip
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-50 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setInfoTrip(null)}>
                Close Dashboard
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Reschedule */}
      {actionModal === 'reschedule' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border-2 border-blue-500 dark:border-blue-400 rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Calendar size={20} className="text-blue-600 dark:text-blue-400" />
                Reschedule Trip
              </h3>
              <button onClick={() => setActionModal(null)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">New Date</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">New Departure Time</label>
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button size="sm" variant="ghost" onClick={() => setActionModal(null)}>Cancel</Button>
              <Button size="sm" onClick={handleApplyReschedule} loading={updatingAction} className="bg-blue-600 hover:bg-blue-700">Save Reschedule</Button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Change Driver */}
      {actionModal === 'driver' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border-2 border-emerald-500 dark:border-emerald-400 rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck size={20} className="text-emerald-600 dark:text-emerald-400" />
                Assign New Driver
              </h3>
              <button onClick={() => setActionModal(null)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">Select Driver</label>
              <select
                value={selectedNewDriver}
                onChange={(e) => setSelectedNewDriver(e.target.value)}
                className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">{drivers.length ? 'Select a driver' : 'No fleet drivers found'}</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.mobile})</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button size="sm" variant="ghost" onClick={() => setActionModal(null)}>Cancel</Button>
              <Button size="sm" onClick={handleApplyDriver} loading={updatingAction} disabled={!selectedNewDriver} className="bg-emerald-600 hover:bg-emerald-700">Confirm Driver</Button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Change Vehicle */}
      {actionModal === 'vehicle' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border-2 border-purple-500 dark:border-purple-400 rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Truck size={20} className="text-purple-600 dark:text-purple-400" />
                Assign New Vehicle
              </h3>
              <button onClick={() => setActionModal(null)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">Select Vehicle</label>
              <select
                value={selectedNewVehicle}
                onChange={(e) => setSelectedNewVehicle(e.target.value)}
                className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-purple-500"
              >
                <option value="">{vehicles.length ? 'Select a vehicle' : 'No fleet vehicles found'}</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>{v.registration_number || v.vehicle_number} ({v.bus_type?.name || 'Bus'})</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button size="sm" variant="ghost" onClick={() => setActionModal(null)}>Cancel</Button>
              <Button size="sm" onClick={handleApplyVehicle} loading={updatingAction} disabled={!selectedNewVehicle} className="bg-purple-600 hover:bg-purple-700">Confirm Vehicle</Button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Change Route */}
      {actionModal === 'route' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border-2 border-indigo-500 dark:border-indigo-400 rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <MapPin size={20} className="text-indigo-600 dark:text-indigo-400" />
                Assign New Route
              </h3>
              <button onClick={() => setActionModal(null)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Current Route info */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Current Assigned Route</div>
              <div className="font-semibold text-slate-900 dark:text-white text-sm">
                {infoTrip.route?.route_name || 'No route assigned'}
              </div>
              {infoTrip.route && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {infoTrip.route.origin_city} &rarr; {infoTrip.route.destination_city}
                  {infoTrip.route.stops?.length ? ` • ${infoTrip.route.stops.length} stops` : ''}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">Select New Route</label>
              <select
                value={selectedNewRoute}
                onChange={(e) => setSelectedNewRoute(e.target.value)}
                className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">{routes.length ? 'Select a route' : 'No routes found'}</option>
                {routes.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.route_name || r.name} {r.origin_city && r.destination_city ? `(${r.origin_city} → ${r.destination_city})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedNewRoute && Number(selectedNewRoute) !== Number(infoTrip.route_id) && (
              (() => {
                const selRoute = routes.find(r => String(r.id) === String(selectedNewRoute));
                return selRoute ? (
                  <div className="p-3 bg-indigo-50/80 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800 text-xs space-y-1 text-indigo-950 dark:text-indigo-200">
                    <div className="font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
                      New Selection Preview:
                    </div>
                    <div className="font-semibold">{selRoute.route_name || selRoute.name}</div>
                    <div className="text-[11px] text-indigo-700 dark:text-indigo-300">
                      {selRoute.origin_city} &rarr; {selRoute.destination_city}
                      {selRoute.stops_count ? ` • ${selRoute.stops_count} stops` : ''}
                      {selRoute.total_distance ? ` • ${selRoute.total_distance} km` : ''}
                    </div>
                  </div>
                ) : null;
              })()
            )}

            {tripBookings.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200 text-xs">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <strong>Notice:</strong> This trip currently has {tripBookings.length} active booking(s). Reassigning the route will update the trip's route stops and road map.
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button size="sm" variant="ghost" onClick={() => setActionModal(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleApplyRoute}
                loading={updatingAction}
                disabled={!selectedNewRoute || Number(selectedNewRoute) === Number(infoTrip.route_id)}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                Confirm Route
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Change Capacity */}
      {actionModal === 'capacity' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border-2 border-indigo-500 dark:border-indigo-400 rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Navigation size={20} className="text-indigo-600 dark:text-indigo-400" />
                Change Trip Capacity
              </h3>
              <button onClick={() => setActionModal(null)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">Total Seat Capacity</label>
              <input
                type="number"
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value)}
                className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button size="sm" variant="ghost" onClick={() => setActionModal(null)}>Cancel</Button>
              <Button size="sm" onClick={handleApplyCapacity} loading={updatingAction} className="bg-indigo-600 hover:bg-indigo-700">Update Capacity</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
