import React, { useState, useEffect, useCallback } from 'react';
import { bookingsAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, SearchInput, Button, Select, StatusBadge, Modal, ConfirmDialog, ErrorState, Badge } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { hasRole } from '../utils/roles';
import {
  XCircle,
  Eye,
  Calendar,
  MapPin,
  User,
  CreditCard,
  Ticket,
  Phone,
  ArrowRight,
  CheckCircle2,
  Tag,
  RefreshCw,
  Navigation,
  Compass,
  Radio,
  Loader2,
  ShieldCheck,
  Bus,
  Check,
  Copy,
  CheckCheck,
  Gauge,
  Route,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

// Fix for default marker icon in Leaflet with React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom DivIcons for Bus and Stop Pins
const createBusDivIcon = (speed?: number) =>
  L.divIcon({
    className: 'custom-bus-marker',
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px;">
        <div style="position: absolute; width: 44px; height: 44px; border-radius: 9999px; background-color: #6366f1; opacity: 0.45; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
        <div style="position: relative; width: 36px; height: 36px; border-radius: 9999px; background: linear-gradient(135deg, #4f46e5, #3730a3); border: 2.5px solid #ffffff; box-shadow: 0 10px 20px -3px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; color: white;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M16 6v6"/><path d="M2 12h20"/><path d="M18 18h2a1 1 0 0 0 1-1V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
        </div>
        ${speed && Number(speed) > 0 ? `<div style="position: absolute; bottom: -7px; background: #0f172a; color: #38bdf8; font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 4px; border: 1px solid #0284c7; white-space: nowrap;">${Math.round(Number(speed))} km/h</div>` : ''}
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });

const createStopMarkerIcon = (
  seq: number | string,
  isPickup = false,
  isDropoff = false,
  isReached = false
) => {
  let bgColor = '#334155';
  let ringStyle = 'box-shadow: 0 4px 10px rgba(0,0,0,0.4);';
  let label = String(seq);
  let size = 26;
  let fontSize = 11;

  if (isPickup) {
    bgColor = '#059669'; // emerald-600
    ringStyle = 'box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.45), 0 8px 16px rgba(0,0,0,0.5);';
    label = 'P';
    size = 34;
    fontSize = 13;
  } else if (isDropoff) {
    bgColor = '#e11d48'; // rose-600
    ringStyle = 'box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.45), 0 8px 16px rgba(0,0,0,0.5);';
    label = 'D';
    size = 34;
    fontSize = 13;
  } else if (isReached) {
    bgColor = '#10b981'; // emerald-500
    label = '✓';
    size = 28;
    fontSize = 12;
  }

  return L.divIcon({
    className: 'custom-stop-marker',
    html: `
      <div style="width: ${size}px; height: ${size}px; border-radius: 9999px; background-color: ${bgColor}; border: 2px solid #ffffff; ${ringStyle} display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: ${fontSize}px; font-family: ui-monospace, monospace; cursor: pointer;">
        ${label}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const createStopDivIcon = (bgColor: string, textLabel: string) =>
  L.divIcon({
    className: 'custom-stop-marker',
    html: `
      <div style="width: 32px; height: 32px; border-radius: 9999px; background-color: ${bgColor}; border: 2.5px solid white; box-shadow: 0 8px 12px -2px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 11px; font-family: monospace;">
        ${textLabel}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

// Dynamic Map Bounds Handler
const MapBoundsHandler: React.FC<{
  busPos?: [number, number] | null;
  boardingPos?: [number, number] | null;
  destPos?: [number, number] | null;
  routeStops?: any[];
}> = ({ busPos, boardingPos, destPos, routeStops }) => {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];
    if (busPos && !isNaN(busPos[0]) && !isNaN(busPos[1]) && busPos[0] !== 0) points.push(busPos);
    if (boardingPos && !isNaN(boardingPos[0]) && !isNaN(boardingPos[1]) && boardingPos[0] !== 0) points.push(boardingPos);
    if (destPos && !isNaN(destPos[0]) && !isNaN(destPos[1]) && destPos[0] !== 0) points.push(destPos);

    if (routeStops && Array.isArray(routeStops)) {
      routeStops.forEach((s) => {
        const lat = Number(s.latitude);
        const lng = Number(s.longitude);
        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
          points.push([lat, lng]);
        }
      });
    }

    if (points.length > 1) {
      try {
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      } catch (e) {
        console.error('Fit bounds error:', e);
      }
    } else if (points.length === 1) {
      map.setView(points[0], 14);
    }
  }, [map, busPos, boardingPos, destPos, routeStops]);

  return null;
};

interface BookingsPageProps {
  onNotify: (msg: string, type?: any) => void;
}

export const BookingsPage: React.FC<BookingsPageProps> = ({ onNotify }) => {
  const { user } = useAuth();
  const isOwner = hasRole(user, 'owner');
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });

  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [cancelling, setCancelling] = useState(false);

  // Detail Modal State
  const [viewBooking, setViewBooking] = useState<any>(null);
  const [fullBookingDetail, setFullBookingDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Live Tracking Modal State
  const [trackTarget, setTrackTarget] = useState<any>(null);
  const [trackingData, setTrackingData] = useState<any>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copiedCoords, setCopiedCoords] = useState<string | null>(null);

  const copyCoords = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedCoords(id);
    setTimeout(() => setCopiedCoords(null), 2000);
  };

  const fetchBookings = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const resp = await bookingsAPI.list({
        page,
        limit: 15,
        search,
        booking_status: bookingStatusFilter,
        payment_status: paymentStatusFilter,
      });
      setBookings(resp.data.data);
      setPagination(resp.data.pagination);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [page, search, bookingStatusFilter, paymentStatusFilter]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  useEffect(() => {
    setPage(1);
  }, [search, bookingStatusFilter, paymentStatusFilter]);

  const fetchTracking = useCallback(async (bookingId: number) => {
    try {
      setLoadingTrack(true);
      const resp = await bookingsAPI.track(bookingId);
      if (resp.data?.data) {
        setTrackingData(resp.data.data);
      }
    } catch (err: any) {
      console.error('Failed to load tracking data:', err);
    } finally {
      setLoadingTrack(false);
    }
  }, []);

  const handleOpenTrack = (b: any) => {
    setTrackTarget(b);
    setTrackingData(null);
    fetchTracking(b.id);
  };

  useEffect(() => {
    if (!trackTarget || !autoRefresh) return;
    const interval = setInterval(() => {
      fetchTracking(trackTarget.id);
    }, 8000);
    return () => clearInterval(interval);
  }, [trackTarget, autoRefresh, fetchTracking]);

  const handleOpenDetail = async (b: any) => {
    setViewBooking(b);
    setFullBookingDetail(b);
    setLoadingDetail(true);
    try {
      const resp = await bookingsAPI.show(b.id);
      if (resp.data?.data) {
        setFullBookingDetail(resp.data.data);
      }
    } catch (err: any) {
      console.error('Failed to load full booking details:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await bookingsAPI.cancel(cancelTarget.id, 'Cancelled by admin');
      onNotify('Booking cancelled successfully');
      setCancelTarget(null);
      if (viewBooking?.id === cancelTarget.id) {
        setViewBooking(null);
      }
      fetchBookings();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Cancel failed', 'error');
    } finally {
      setCancelling(false);
    }
  };

  const parseSeats = (seatVal: any) => {
    if (!seatVal) return [];
    if (Array.isArray(seatVal)) return [...new Set(seatVal)];
    if (typeof seatVal === 'string') {
      try {
        const parsed = JSON.parse(seatVal);
        if (Array.isArray(parsed)) return [...new Set(parsed)];
      } catch {
        return [...new Set(seatVal.split(',').map((s) => s.trim()).filter(Boolean))];
      }
      return [seatVal];
    }
    return [String(seatVal)];
  };

  const HEADERS = [
    'Booking Reference',
    'Passenger Details',
    'Trip & Route',
    'Pickup → Dropoff',
    'Date & Seats',
    ...(!isOwner ? ['Fare Amount', 'Payment'] : []),
    'Status',
    ...(!isOwner ? ['Actions'] : []),
  ];

  const detail = fullBookingDetail || viewBooking;
  const seatList = detail ? parseSeats(detail.seat_numbers) : [];

  // Positions for map rendering inside tracking modal
  const busPos: [number, number] | null =
    trackingData?.bus_location?.latitude && trackingData?.bus_location?.longitude
      ? [Number(trackingData.bus_location.latitude), Number(trackingData.bus_location.longitude)]
      : null;

  const boardingPos: [number, number] | null =
    trackingData?.boarding_stop?.latitude && trackingData?.boarding_stop?.longitude
      ? [Number(trackingData.boarding_stop.latitude), Number(trackingData.boarding_stop.longitude)]
      : null;

  const destPos: [number, number] | null =
    trackingData?.destination_stop?.latitude && trackingData?.destination_stop?.longitude
      ? [Number(trackingData.destination_stop.latitude), Number(trackingData.destination_stop.longitude)]
      : null;

  const tripStops: any[] = Array.isArray(trackingData?.trip_stops) ? trackingData.trip_stops : [];

  const routePolylineCoords: [number, number][] = tripStops
    .filter((s: any) => s.latitude && s.longitude && !isNaN(Number(s.latitude)) && !isNaN(Number(s.longitude)) && Number(s.latitude) !== 0)
    .sort((a: any, b: any) => (Number(a.stop_sequence) || 0) - (Number(b.stop_sequence) || 0))
    .map((s: any) => [Number(s.latitude), Number(s.longitude)] as [number, number]);

  const polylineCoords: [number, number][] = routePolylineCoords.length >= 2
    ? routePolylineCoords
    : [
        ...(busPos ? [busPos] : []),
        ...(boardingPos ? [boardingPos] : []),
        ...(destPos ? [destPos] : []),
      ];

  // Guaranteed Driver & Vehicle Resolution (fixes "Not Assigned" bug)
  const resolvedDriverName =
    trackingData?.driver?.name ||
    trackingData?.bus_location?.driver_name ||
    trackTarget?.trip?.driver?.name ||
    trackTarget?.trip?.vehicle?.driver?.name ||
    'Not Assigned';

  const resolvedDriverMobile =
    trackingData?.driver?.mobile ||
    trackingData?.bus_location?.driver_mobile ||
    trackTarget?.trip?.driver?.mobile ||
    trackTarget?.trip?.vehicle?.driver?.mobile ||
    null;

  const isDriverOnline =
    trackingData?.driver?.is_online ??
    (trackTarget?.trip?.driver?.online_status === 'online');

  const resolvedVehicleReg =
    trackingData?.vehicle?.registration_number ||
    trackingData?.bus_location?.vehicle_registration ||
    trackTarget?.trip?.vehicle?.registration_number ||
    '—';

  const resolvedVehicleModel =
    trackingData?.vehicle?.model ||
    trackingData?.bus_location?.vehicle_model ||
    trackTarget?.trip?.vehicle?.model ||
    trackTarget?.trip?.vehicle?.company_model ||
    '';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-xl flex items-center gap-2">
            <Ticket className="text-indigo-400" size={22} />
            Booking Management
          </h2>
          <p className="text-slate-400 text-sm">
            View complete booking details, ticket info, boarding passes, and live bus pickup tracking
          </p>
        </div>
        <div className="text-slate-400 text-xs font-mono bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
          Total: {pagination.total} bookings
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search reference, pass code, name, mobile, email..."
        />
        <Select
          value={bookingStatusFilter}
          onChange={setBookingStatusFilter}
          options={[
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'completed', label: 'Completed' },
            { value: 'pending', label: 'Pending' },
            ...(!isOwner ? [{ value: 'cancelled', label: 'Cancelled' }] : []),
          ]}
          placeholder="All Booking Statuses"
        />
        {!isOwner && <Select
          value={paymentStatusFilter}
          onChange={setPaymentStatusFilter}
          options={[
            { value: 'paid', label: 'Paid' },
            { value: 'pending', label: 'Pending' },
            { value: 'failed', label: 'Failed' },
            { value: 'refunded', label: 'Refunded' },
          ]}
          placeholder="Payment Status"
        />}
        {(search || bookingStatusFilter || paymentStatusFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setBookingStatusFilter('');
              setPaymentStatusFilter('');
            }}
          >
            Reset Filters
          </Button>
        )}
      </div>

      <Card padding={false}>
        {error ? (
          <ErrorState message={error} onRetry={fetchBookings} />
        ) : (
          <>
            <Table
              headers={HEADERS}
              loading={loading}
              empty={!loading && bookings.length === 0}
              emptyMessage="No bookings found"
            >
              {bookings.map((b) => {
                const seats = parseSeats(b.seat_numbers);
                return (
                  <Tr key={b.id}>
                    <Td>
                      <div className="text-white text-sm font-mono font-bold flex items-center gap-1.5">
                        <Ticket size={14} className="text-indigo-400 shrink-0" />
                        {b.booking_reference}
                      </div>
                      {b.boarding_pass_code && (
                        <div className="text-slate-400 text-xs font-mono mt-0.5">
                          Pass: <span className="text-slate-200">{b.boarding_pass_code}</span>
                          {b.boarding_pin && <span className="ml-1 text-indigo-400">(PIN: {b.boarding_pin})</span>}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="text-white text-sm font-medium flex items-center gap-1">
                        <User size={13} className="text-slate-400" />
                        {b.passenger_name}
                      </div>
                      <div className="text-slate-400 text-xs flex items-center gap-1 mt-0.5">
                        <Phone size={11} className="text-slate-500" />
                        {b.passenger_mobile}
                      </div>
                      {b.passenger_email && (
                        <div className="text-slate-500 text-xs truncate max-w-[140px]">{b.passenger_email}</div>
                      )}
                    </Td>
                    <Td>
                      <div className="text-white text-xs font-semibold">
                        {b.trip?.route?.route_name || b.trip?.schedule_code || `Trip #${b.trip_id}`}
                      </div>
                      <div className="text-slate-400 text-xs mt-0.5">{b.trip?.schedule_code || '—'}</div>
                    </Td>
                    <Td>
                      <div className="text-slate-200 text-xs font-medium flex items-center gap-1">
                        <MapPin size={12} className="text-emerald-400 shrink-0" />
                        <span className="truncate max-w-[110px]">{b.origin_stop?.stop_name || 'Pickup'}</span>
                      </div>
                      <div className="text-slate-400 text-xs flex items-center gap-1 mt-0.5">
                        <ArrowRight size={10} className="text-slate-500 shrink-0" />
                        <span className="truncate max-w-[110px]">{b.destination_stop?.stop_name || 'Dropoff'}</span>
                      </div>
                    </Td>
                    <Td>
                      <div className="text-white text-xs font-medium flex items-center gap-1">
                        <Calendar size={12} className="text-indigo-400" />
                        {b.travel_date}
                      </div>
                      <div className="text-slate-400 text-xs mt-0.5 flex items-center gap-1">
                        <span>
                          {seats.length > 0 ? `Seats: ${seats.join(', ')}` : `${b.total_seats || 1} seat(s)`}
                        </span>
                      </div>
                    </Td>
                    {!isOwner && <Td>
                      <div className="text-emerald-400 text-sm font-bold">₹{b.final_amount}</div>
                      {b.discount_amount > 0 && (
                        <div className="text-slate-400 text-xs">
                          <span className="line-through">₹{b.total_fare}</span> (-₹{b.discount_amount})
                        </div>
                      )}
                    </Td>}
                    {!isOwner && <Td>
                      <div className="space-y-1">
                        <StatusBadge status={b.payment_status} />
                        {b.payment_method && (
                          <div className="text-slate-400 text-[11px] capitalize">{b.payment_method}</div>
                        )}
                      </div>
                    </Td>}
                    <Td>
                      <div className="space-y-1">
                        <StatusBadge status={b.booking_status} />
                        {b.boarding_status && (
                          <div className="text-[11px]">
                            <Badge
                              color={
                                b.boarding_status === 'boarded'
                                  ? 'green'
                                  : b.boarding_status === 'no_show'
                                  ? 'red'
                                  : 'gray'
                              }
                            >
                              {b.boarding_status.replace('_', ' ')}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </Td>
                    {!isOwner && <Td>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleOpenTrack(b)}
                          title="Track Assigned Bus & Pickup Location"
                        >
                          <Navigation size={13} className="text-emerald-400 mr-1" /> Track
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDetail(b)}
                          title="View Complete Details"
                        >
                          <Eye size={13} />
                        </Button>
                        {b.booking_status !== 'cancelled' && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setCancelTarget(b)}
                            title="Cancel Booking"
                          >
                            <XCircle size={13} />
                          </Button>
                        )}
                      </div>
                    </Td>}
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

      {/* ── LIVE BUS & PICKUP LOCATION TRACKING MODAL ────────────────────────── */}
      {trackTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md overflow-hidden">
          <div className="relative w-full max-w-[98vw] 2xl:max-w-[1600px] h-[95vh] max-h-[96vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            
            {/* 1. Modal Top Bar */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-lg shadow-emerald-950/50">
                  <Navigation size={22} className="animate-pulse" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white tracking-wide">
                      Live Bus & Boarding Location Tracking
                    </h3>
                    <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-950/90 border border-emerald-700/70 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-sm">
                      <Radio size={12} className="animate-ping" /> LIVE TRACKING
                    </span>
                    {trackingData?.bus_location?.has_live_gps ? (
                      <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded-full">
                        GPS Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-amber-400 bg-amber-950/80 border border-amber-800/60 px-2 py-0.5 rounded-full">
                        Base / Stored GPS
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-slate-300 font-semibold">#{trackTarget.booking_reference}</span>
                    <span>•</span>
                    <span className="text-white font-medium">{trackTarget.passenger_name}</span>
                    {trackTarget.passenger_mobile && (
                      <span className="text-slate-400 font-mono">({trackTarget.passenger_mobile})</span>
                    )}
                    <span>•</span>
                    <span>Route: <strong className="text-indigo-300">{trackingData?.route?.route_name || trackTarget.trip?.route?.route_name || trackTarget.trip?.route_name || 'Shuttle Route'}</strong></span>
                  </p>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 shrink-0">
                <label className="hidden sm:flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-lg hover:border-slate-700">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-slate-800 border-slate-700 text-emerald-600 focus:ring-0"
                  />
                  <span className="flex items-center gap-1 font-medium text-[11px]">
                    <RefreshCw size={11} className={autoRefresh ? 'text-emerald-400 animate-spin' : 'text-slate-500'} />
                    Auto (8s)
                  </span>
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => trackTarget && fetchTracking(trackTarget.id)}
                  loading={loadingTrack}
                  icon={RefreshCw}
                >
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setTrackTarget(null)}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <XCircle size={22} />
                </button>
              </div>
            </div>

            {/* 2. Admin Telemetry & Status Strip */}
            <div className="px-5 py-3 border-b border-slate-800/80 bg-slate-950/60 shrink-0">
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
                
                {/* Proximity Card */}
                <div className={`p-2.5 rounded-xl border flex items-center gap-2.5 shadow-sm ${
                  trackingData?.tracking_status === 'ARRIVED'
                    ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                    : trackingData?.tracking_status === 'ARRIVING_SOON'
                    ? 'bg-amber-950/70 border-amber-500/50 text-amber-200'
                    : trackingData?.tracking_status === 'EN_ROUTE'
                    ? 'bg-indigo-950/70 border-indigo-500/50 text-indigo-200'
                    : 'bg-slate-900/90 border-slate-800 text-slate-300'
                }`}>
                  <div className="w-8 h-8 rounded-lg bg-black/40 flex items-center justify-center shrink-0">
                    {trackingData?.tracking_status === 'ARRIVED' ? (
                      <CheckCircle2 size={18} className="text-emerald-400" />
                    ) : trackingData?.tracking_status === 'ARRIVING_SOON' ? (
                      <Compass size={18} className="text-amber-400 animate-spin" />
                    ) : (
                      <Bus size={18} className="text-indigo-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">Pickup Proximity</div>
                    <div className="text-xs font-bold text-white truncate" title={trackingData?.tracking_status_message || 'Calculating...'}>
                      {trackingData?.tracking_status_message || 'Tracking bus...'}
                    </div>
                    {trackingData?.distance_text && trackingData.distance_text !== 'N/A' && (
                      <div className="text-[11px] font-mono text-emerald-400 font-bold">
                        {trackingData.distance_text} away
                      </div>
                    )}
                  </div>
                </div>

                {/* Assigned Driver Card */}
                <div className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <User size={11} className="text-indigo-400" /> Assigned Driver
                    </span>
                    {resolvedDriverName !== 'Not Assigned' && (
                      <span className={`w-2 h-2 rounded-full ${isDriverOnline ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : 'bg-slate-500'}`} title={isDriverOnline ? 'Driver Online' : 'Driver Offline'} />
                    )}
                  </div>
                  <div className="font-bold text-white text-xs truncate">
                    {resolvedDriverName}
                  </div>
                  {resolvedDriverMobile ? (
                    <a
                      href={`tel:${resolvedDriverMobile}`}
                      className="text-[11px] text-emerald-400 font-mono font-semibold flex items-center gap-1 hover:underline truncate"
                    >
                      <Phone size={10} /> {resolvedDriverMobile}
                    </a>
                  ) : (
                    <span className="text-[11px] text-slate-500 block">—</span>
                  )}
                </div>

                {/* Assigned Bus Vehicle */}
                <div className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-0.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Bus size={11} className="text-cyan-400" /> Bus Vehicle
                  </span>
                  <div className="font-mono font-bold text-cyan-400 text-xs truncate">
                    {resolvedVehicleReg}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                    <span>{resolvedVehicleModel || 'Shuttle Bus'}</span>
                    <span>•</span>
                    <span className="text-slate-300 font-mono">{trackingData?.bus_location?.speed_kmh || 0} km/h</span>
                  </div>
                </div>

                {/* Passenger Pickup Stop */}
                <div className="p-2.5 bg-slate-900/90 border border-emerald-900/40 rounded-xl space-y-0.5">
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <MapPin size={11} /> Passenger Pickup
                  </span>
                  <div className="font-bold text-white text-xs truncate" title={trackingData?.boarding_stop?.stop_name}>
                    {trackingData?.boarding_stop?.stop_name || trackTarget?.origin_stop?.stop_name || 'Pickup Stop'}
                  </div>
                  <div className="text-[11px] text-emerald-300/80 font-mono truncate">
                    {trackingData?.boarding_stop?.pickup_time ? `Time: ${trackingData.boarding_stop.pickup_time}` : (trackTarget?.pickup_time ? `Time: ${trackTarget.pickup_time}` : 'Seq: ' + (trackingData?.boarding_stop?.sequence || '—'))}
                  </div>
                </div>

                {/* Passenger Dropoff Stop */}
                <div className="p-2.5 bg-slate-900/90 border border-rose-900/40 rounded-xl space-y-0.5">
                  <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <MapPin size={11} /> Passenger Dropoff
                  </span>
                  <div className="font-bold text-white text-xs truncate" title={trackingData?.destination_stop?.stop_name}>
                    {trackingData?.destination_stop?.stop_name || trackTarget?.destination_stop?.stop_name || 'Dropoff Stop'}
                  </div>
                  <div className="text-[11px] text-rose-300/80 font-mono truncate">
                    {trackingData?.destination_stop?.dropoff_time ? `Time: ${trackingData.destination_stop.dropoff_time}` : (trackTarget?.dropoff_time ? `Time: ${trackTarget.dropoff_time}` : 'Seq: ' + (trackingData?.destination_stop?.sequence || '—'))}
                  </div>
                </div>

                {/* Travel Schedule & Boarding */}
                <div className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-0.5">
                  <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Calendar size={11} /> Date & Boarding
                  </span>
                  <div className="font-medium text-white text-xs truncate flex items-center gap-1">
                    <span>{trackTarget.travel_date}</span>
                    {trackingData?.trip?.departure_time && (
                      <span className="text-slate-400 font-mono text-[11px]">({trackingData.trip.departure_time})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-slate-400">Boarding:</span>
                    <span className={`font-bold uppercase text-[10px] px-1.5 py-0.2 rounded ${
                      trackTarget.boarding_status === 'boarded' ? 'bg-emerald-950 text-emerald-400' :
                      trackTarget.boarding_status === 'no_show' ? 'bg-rose-950 text-rose-400' :
                      'bg-slate-800 text-slate-300'
                    }`}>
                      {trackTarget.boarding_status || 'Pending'}
                    </span>
                  </div>
                </div>

              </div>
            </div>

            {/* 3. Modal Body: Split Map & Stoppage Timeline */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 overflow-hidden">
              
              {/* LEFT / MAP CONTAINER (7 cols on lg, 8 on xl) */}
              <div className="lg:col-span-7 xl:col-span-8 flex flex-col h-full min-h-[460px] rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950 relative shadow-inner">
                {loadingTrack && !trackingData ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                    <Loader2 size={36} className="animate-spin text-emerald-400" />
                    <p className="text-sm font-medium">Connecting to bus GPS & plotting route stops...</p>
                  </div>
                ) : (
                  <>
                    <MapContainer
                      center={busPos || boardingPos || destPos || [22.4824724, 88.3508133]}
                      zoom={14}
                      style={{ height: '100%', width: '100%' }}
                    >
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
                      />

                      {/* 1. All Route Stops Markers */}
                      {tripStops.map((stop: any, idx: number) => {
                        const lat = Number(stop.latitude);
                        const lng = Number(stop.longitude);
                        if (!lat || !lng || isNaN(lat) || isNaN(lng) || lat === 0) return null;

                        const isPickup = Boolean(stop.is_user_boarding_stop || stop.id === trackingData?.boarding_stop?.id);
                        const isDropoff = Boolean(stop.is_user_destination_stop || stop.id === trackingData?.destination_stop?.id);
                        const isReached = Boolean(stop.is_reached);
                        const seq = stop.stop_sequence || idx + 1;

                        return (
                          <Marker
                            key={`stop-${stop.id || idx}`}
                            position={[lat, lng]}
                            icon={createStopMarkerIcon(seq, isPickup, isDropoff, isReached)}
                          >
                            <Popup>
                              <div className="text-xs p-1 max-w-[240px]">
                                <div className="flex items-center gap-1.5 font-bold mb-1">
                                  {isPickup ? (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">PICKUP POINT</span>
                                  ) : isDropoff ? (
                                    <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">DROPOFF POINT</span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold font-mono">STOP #{seq}</span>
                                  )}
                                  <span className="text-slate-900 font-bold truncate">{stop.stop_name}</span>
                                </div>
                                {stop.address && (
                                  <p className="text-slate-600 text-[11px] mb-1">{stop.address}</p>
                                )}
                                <div className="space-y-0.5 border-t border-slate-200 pt-1 text-[11px] text-slate-700">
                                  <div>
                                    <strong className="text-slate-900">Coordinates:</strong>{' '}
                                    <span className="font-mono text-slate-600">{lat.toFixed(6)}, {lng.toFixed(6)}</span>
                                  </div>
                                  {(stop.pickup_time || stop.dropoff_time) && (
                                    <div>
                                      <strong className="text-slate-900">Scheduled:</strong>{' '}
                                      <span className="font-mono">{stop.pickup_time || stop.dropoff_time}</span>
                                    </div>
                                  )}
                                  {isReached && (
                                    <div className="text-emerald-700 font-semibold flex items-center gap-1">
                                      <Check size={12} /> Reached {stop.arrived_at ? `at ${new Date(stop.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                                      {stop.passengers_boarded > 0 && ` (${stop.passengers_boarded} boarded)`}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </Popup>
                          </Marker>
                        );
                      })}

                      {/* 2. Fallback Passenger Pickup Marker if not in tripStops */}
                      {boardingPos && !tripStops.some((s) => s.is_user_boarding_stop) && (
                        <Marker position={boardingPos} icon={createStopMarkerIcon('P', true, false, false)}>
                          <Popup>
                            <div className="text-xs p-1">
                              <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold block mb-1">PASSENGER PICKUP</span>
                              <strong className="text-emerald-900 font-bold">{trackingData?.boarding_stop?.stop_name}</strong>
                              <div className="font-mono text-slate-600 text-[11px] mt-1">{boardingPos[0]}, {boardingPos[1]}</div>
                            </div>
                          </Popup>
                        </Marker>
                      )}

                      {/* 3. Fallback Passenger Dropoff Marker if not in tripStops */}
                      {destPos && !tripStops.some((s) => s.is_user_destination_stop) && (
                        <Marker position={destPos} icon={createStopMarkerIcon('D', false, true, false)}>
                          <Popup>
                            <div className="text-xs p-1">
                              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold block mb-1">PASSENGER DROPOFF</span>
                              <strong className="text-rose-900 font-bold">{trackingData?.destination_stop?.stop_name}</strong>
                              <div className="font-mono text-slate-600 text-[11px] mt-1">{destPos[0]}, {destPos[1]}</div>
                            </div>
                          </Popup>
                        </Marker>
                      )}

                      {/* 4. Live Bus / Driver Marker */}
                      {busPos && (
                        <Marker position={busPos} icon={createBusDivIcon(trackingData?.bus_location?.speed_kmh)}>
                          <Popup>
                            <div className="text-xs p-1 max-w-[240px]">
                              <strong className="text-indigo-900 block font-bold text-sm">
                                🚌 {resolvedVehicleReg} ({resolvedDriverName})
                              </strong>
                              <div className="space-y-0.5 mt-1 text-slate-600 text-[11px]">
                                <div><strong className="text-slate-800">Speed:</strong> {trackingData?.bus_location?.speed_kmh || 0} km/h</div>
                                <div><strong className="text-slate-800">Coordinates:</strong> <span className="font-mono">{busPos[0].toFixed(6)}, {busPos[1].toFixed(6)}</span></div>
                                {resolvedDriverMobile && <div><strong className="text-slate-800">Mobile:</strong> {resolvedDriverMobile}</div>}
                                {trackingData?.bus_location?.recorded_at && (
                                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-200">
                                    Last Ping: {new Date(trackingData.bus_location.recorded_at).toLocaleTimeString()}
                                  </div>
                                )}
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      )}

                      {/* 5. Route Polyline connecting all stops */}
                      {polylineCoords.length >= 2 && (
                        <Polyline
                          positions={polylineCoords}
                          pathOptions={{ color: '#6366f1', weight: 4.5, opacity: 0.85, lineJoin: 'round' }}
                        />
                      )}

                      <MapBoundsHandler
                        busPos={busPos}
                        boardingPos={boardingPos}
                        destPos={destPos}
                        routeStops={tripStops}
                      />
                    </MapContainer>

                    {/* Overlay: Map Legend */}
                    <div className="absolute bottom-3 left-3 z-[1000] bg-slate-900/90 border border-slate-700/80 rounded-xl p-2.5 shadow-xl backdrop-blur-md text-[11px] text-slate-300 space-y-1.5 hidden sm:block">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1">
                        Map Legend
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full bg-indigo-600 border border-white flex items-center justify-center text-[9px] text-white">🚌</span>
                        <span>Live Bus Location</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full bg-emerald-600 border border-white flex items-center justify-center text-[9px] font-bold text-white">P</span>
                        <span>Passenger Pickup Point</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full bg-rose-600 border border-white flex items-center justify-center text-[9px] font-bold text-white">D</span>
                        <span>Passenger Dropoff Point</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 border border-white flex items-center justify-center text-[9px] font-bold text-white">✓</span>
                        <span>Stoppage Reached</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full bg-slate-700 border border-white flex items-center justify-center text-[9px] font-mono text-white">#</span>
                        <span>Upcoming Route Stop</span>
                      </div>
                    </div>

                    {/* Overlay: Live Telemetry HUD */}
                    {busPos && (
                      <div className="absolute top-3 left-3 z-[1000] bg-slate-900/90 border border-slate-700/80 rounded-xl px-3 py-2 shadow-xl backdrop-blur-md text-xs text-white flex items-center gap-3">
                        <div className="flex items-center gap-1.5 font-mono text-cyan-400 font-bold">
                          <Gauge size={14} className="text-cyan-400" />
                          <span>{trackingData?.bus_location?.speed_kmh || 0} km/h</span>
                        </div>
                        <div className="h-3 w-px bg-slate-700" />
                        <div className="font-mono text-slate-300 text-[11px]">
                          Lat: {busPos[0].toFixed(5)}, Lng: {busPos[1].toFixed(5)}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* RIGHT / STOPPAGE TRACK RECORD & COORDINATES DRAWER (5 cols on lg, 4 on xl) */}
              <div className="lg:col-span-5 xl:col-span-4 flex flex-col h-full overflow-hidden bg-slate-950/70 border border-slate-800 rounded-xl shadow-lg">
                
                {/* Header */}
                <div className="p-3.5 border-b border-slate-800 bg-slate-900/60 shrink-0 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                      <Route size={14} className="text-indigo-400" /> Route Stoppage Track Record
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Live stop sequence, arrival status & exact Lat/Long
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">
                    {tripStops.length} Stops
                  </span>
                </div>

                {/* Key Passenger Coordinates Box */}
                <div className="p-3 border-b border-slate-800/80 bg-slate-900/30 space-y-2 shrink-0">
                  {/* Pickup Stop Card */}
                  <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30">
                    <div className="flex items-center justify-between text-xs font-bold text-emerald-300 mb-1">
                      <span className="flex items-center gap-1">
                        <MapPin size={12} className="text-emerald-400" /> Passenger Pickup Coordinates
                      </span>
                      {boardingPos && (
                        <button
                          type="button"
                          onClick={() => copyCoords(`${boardingPos[0]}, ${boardingPos[1]}`, 'pickup')}
                          className="text-[10px] font-mono text-emerald-400 hover:text-white flex items-center gap-1 bg-emerald-900/40 px-1.5 py-0.5 rounded transition-colors"
                          title="Copy Latitude & Longitude"
                        >
                          {copiedCoords === 'pickup' ? <CheckCheck size={11} className="text-emerald-300" /> : <Copy size={11} />}
                          {copiedCoords === 'pickup' ? 'Copied' : 'Copy Lat/Lng'}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-white font-medium truncate">
                      {trackingData?.boarding_stop?.stop_name || 'Pickup Stop'}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="font-mono text-emerald-300 font-semibold">
                        {boardingPos ? `${boardingPos[0].toFixed(6)}, ${boardingPos[1].toFixed(6)}` : 'No GPS coords'}
                      </span>
                      {trackingData?.boarding_stop?.pickup_time && (
                        <span className="text-slate-400 font-mono">Time: {trackingData.boarding_stop.pickup_time}</span>
                      )}
                    </div>
                  </div>

                  {/* Destination Stop Card */}
                  <div className="p-2.5 rounded-lg bg-rose-950/20 border border-rose-500/30">
                    <div className="flex items-center justify-between text-xs font-bold text-rose-300 mb-1">
                      <span className="flex items-center gap-1">
                        <MapPin size={12} className="text-rose-400" /> Passenger Dropoff Coordinates
                      </span>
                      {destPos && (
                        <button
                          type="button"
                          onClick={() => copyCoords(`${destPos[0]}, ${destPos[1]}`, 'dest')}
                          className="text-[10px] font-mono text-rose-400 hover:text-white flex items-center gap-1 bg-rose-900/40 px-1.5 py-0.5 rounded transition-colors"
                          title="Copy Latitude & Longitude"
                        >
                          {copiedCoords === 'dest' ? <CheckCheck size={11} className="text-rose-300" /> : <Copy size={11} />}
                          {copiedCoords === 'dest' ? 'Copied' : 'Copy Lat/Lng'}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-white font-medium truncate">
                      {trackingData?.destination_stop?.stop_name || 'Destination Stop'}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="font-mono text-rose-300 font-semibold">
                        {destPos ? `${destPos[0].toFixed(6)}, ${destPos[1].toFixed(6)}` : 'No GPS coords'}
                      </span>
                      {trackingData?.destination_stop?.dropoff_time && (
                        <span className="text-slate-400 font-mono">Time: {trackingData.destination_stop.dropoff_time}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stoppages Scrollable Timeline */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {tripStops.length === 0 ? (
                    <div className="py-10 text-center text-slate-500 text-xs">
                      No route stoppages loaded. Check route configuration.
                    </div>
                  ) : (
                    tripStops.map((s: any, idx: number) => {
                      const isPickup = Boolean(s.is_user_boarding_stop || s.id === trackingData?.boarding_stop?.id);
                      const isDropoff = Boolean(s.is_user_destination_stop || s.id === trackingData?.destination_stop?.id);
                      const isReached = Boolean(s.is_reached);
                      const lat = Number(s.latitude);
                      const lng = Number(s.longitude);
                      const hasCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0;

                      return (
                        <div
                          key={`timeline-stop-${s.id || idx}`}
                          className={`relative p-3 rounded-xl border transition-all ${
                            isPickup
                              ? 'bg-emerald-950/40 border-emerald-500/60 shadow-md shadow-emerald-950/30'
                              : isDropoff
                              ? 'bg-rose-950/40 border-rose-500/60 shadow-md shadow-rose-950/30'
                              : isReached
                              ? 'bg-slate-900/80 border-emerald-800/40'
                              : 'bg-slate-900/50 border-slate-800'
                          }`}
                        >
                          {/* Top Row: Sequence Badge & Stop Name & Tags */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                                isPickup
                                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500'
                                  : isDropoff
                                  ? 'bg-rose-600 text-white shadow-sm shadow-rose-500'
                                  : isReached
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                                  : 'bg-slate-800 text-slate-300 font-mono border border-slate-700'
                              }`}>
                                {isReached ? <Check size={12} /> : (s.stop_sequence || idx + 1)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                                  <span>{s.stop_name}</span>
                                </div>
                                {s.address && (
                                  <div className="text-[11px] text-slate-400 truncate max-w-[200px]" title={s.address}>
                                    {s.address}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Tags */}
                            <div className="shrink-0 flex flex-col items-end gap-1">
                              {isPickup && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase">
                                  Pickup
                                </span>
                              )}
                              {isDropoff && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 uppercase">
                                  Dropoff
                                </span>
                              )}
                              {isReached && !isPickup && !isDropoff && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                                  <Check size={10} /> Reached
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Coordinates & Times Row */}
                          <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                            <div className="flex items-center gap-1 font-mono text-slate-300">
                              <span className="text-slate-500">📍</span>
                              {hasCoords ? (
                                <span className="text-cyan-300/90 font-medium">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
                              ) : (
                                <span className="text-slate-500">No Lat/Long</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {(s.pickup_time || s.dropoff_time) && (
                                <span className="font-mono text-slate-400">
                                  🕒 {s.pickup_time || s.dropoff_time}
                                </span>
                              )}
                              {hasCoords && (
                                <button
                                  type="button"
                                  onClick={() => copyCoords(`${lat}, ${lng}`, `stop-${idx}`)}
                                  className="text-slate-400 hover:text-white p-0.5"
                                  title="Copy Coordinates"
                                >
                                  {copiedCoords === `stop-${idx}` ? (
                                    <CheckCheck size={12} className="text-emerald-400" />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Live Arrival info if reached */}
                          {isReached && s.arrived_at && (
                            <div className="mt-1 text-[10px] text-emerald-400 font-mono">
                              Arrived at {new Date(s.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {s.passengers_boarded > 0 && ` • ${s.passengers_boarded} passenger(s) boarded`}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

              </div>
            </div>

            {/* 4. Modal Footer: Admin summary bar */}
            <div className="px-5 py-2.5 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-slate-400 flex items-center gap-3">
                <span>Trip ID: <strong className="text-slate-200">#{trackingData?.trip?.id || trackTarget.trip_id}</strong></span>
                <span>•</span>
                <span>Schedule: <strong className="text-slate-200">{trackingData?.trip?.schedule_code || trackTarget.trip?.schedule_code || '—'}</strong></span>
                <span>•</span>
                <span>Seats: <strong className="text-slate-200">{trackTarget.seat_numbers || `${trackTarget.total_seats || 1} seat(s)`}</strong></span>
                <span>•</span>
                <span>Fare: <strong className="text-emerald-400">₹{trackTarget.final_amount}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setTrackTarget(null)}>
                  Close
                </Button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── COMPLETE BOOKING DETAILS MODAL ────────────────────────── */}
      <Modal
        open={!!viewBooking}
        onClose={() => setViewBooking(null)}
        title={`Booking Details — ${detail?.booking_reference || ''}`}
        size="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <div>
              {detail && detail.booking_status !== 'cancelled' && (
                <Button variant="danger" size="sm" onClick={() => setCancelTarget(detail)}>
                  <XCircle size={14} className="mr-1.5" /> Cancel Booking
                </Button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setViewBooking(null)}>
              Close
            </Button>
          </div>
        }
      >
        {loadingDetail && !fullBookingDetail ? (
          <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
            <RefreshCw size={24} className="animate-spin text-indigo-400" />
            <p className="text-sm">Fetching full booking parameters & payment details...</p>
          </div>
        ) : detail ? (
          <div className="space-y-6">
            {/* Status & Pass Banner */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800">
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase font-semibold tracking-wider">
                  Booking Status
                </span>
                <div>
                  <StatusBadge status={detail.booking_status} />
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase font-semibold tracking-wider">
                  Payment Status
                </span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={detail.payment_status} />
                  {detail.payment_method && (
                    <span className="text-xs text-slate-300 capitalize">({detail.payment_method})</span>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase font-semibold tracking-wider">
                  Boarding Status
                </span>
                <div>
                  <Badge
                    color={
                      detail.boarding_status === 'boarded'
                        ? 'green'
                        : detail.boarding_status === 'no_show'
                        ? 'red'
                        : 'gray'
                    }
                  >
                    {detail.boarding_status ? detail.boarding_status.replace('_', ' ').toUpperCase() : 'NOT BOARDED'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Boarding Pass & Codes Box */}
            <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/20 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs text-indigo-400 font-semibold uppercase tracking-wider">
                  Boarding Pass & Token
                </div>
                <div className="text-lg font-mono font-bold text-white mt-0.5">
                  {detail.boarding_pass_code || 'N/A'}
                </div>
              </div>
              {detail.boarding_pin && (
                <div className="bg-indigo-900/40 px-3 py-1.5 rounded-lg border border-indigo-500/30">
                  <div className="text-[11px] text-indigo-300">Boarding PIN</div>
                  <div className="text-base font-mono font-bold text-indigo-200">{detail.boarding_pin}</div>
                </div>
              )}
              {detail.qr_token && (
                <div className="text-xs font-mono text-slate-400 max-w-xs truncate" title={detail.qr_token}>
                  QR Token: <span className="text-slate-200">{detail.qr_token}</span>
                </div>
              )}
            </div>

            {/* Grid 1: Passenger, Trip & Driver Information */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Passenger Box */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                  <User size={14} className="text-indigo-400" /> Passenger Details
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Name:</span>
                    <span className="font-semibold text-white">{detail.passenger_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Mobile:</span>
                    <span className="font-mono text-slate-200">{detail.passenger_mobile}</span>
                  </div>
                  {detail.passenger_email && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email:</span>
                      <span className="text-slate-200">{detail.passenger_email}</span>
                    </div>
                  )}
                  {detail.passenger_id && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Passenger ID:</span>
                      <span className="font-mono text-slate-400">#{detail.passenger_id}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Trip & Route Box */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                  <Ticket size={14} className="text-indigo-400" /> Trip & Route Details
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Route Name:</span>
                    <span className="font-semibold text-indigo-300">
                      {detail.trip?.route?.route_name || detail.trip?.route_name || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Schedule Code:</span>
                    <span className="font-mono text-slate-200">
                      {detail.trip?.schedule_code || `Trip #${detail.trip_id}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Travel Date:</span>
                    <span className="font-medium text-white">{detail.travel_date}</span>
                  </div>
                  {detail.trip?.departure_time && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Departure Time:</span>
                      <span className="font-mono text-slate-300">{detail.trip.departure_time}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Driver & Bus Box */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                  <Bus size={14} className="text-indigo-400" /> Assigned Driver & Bus
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Driver Name:</span>
                    <span className="font-semibold text-white">
                      {detail.trip?.driver?.name || 'Unassigned'}
                    </span>
                  </div>
                  {detail.trip?.driver?.mobile && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Driver Phone:</span>
                      <a href={`tel:${detail.trip.driver.mobile}`} className="font-mono text-indigo-400 hover:underline">
                        {detail.trip.driver.mobile}
                      </a>
                    </div>
                  )}
                  {detail.trip?.driver?.online_status && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Driver Status:</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${detail.trip.driver.online_status === 'online' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'}`}>
                        {detail.trip.driver.online_status}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Vehicle Bus:</span>
                    <span className="font-mono font-semibold text-slate-200">
                      {detail.trip?.vehicle?.registration_number || 'Unassigned'}
                    </span>
                  </div>
                  {detail.trip?.vehicle?.company_model && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Bus Model:</span>
                      <span className="text-slate-300">{detail.trip.vehicle.company_model}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Stop Pair Details & Live Tracking Button */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <MapPin size={14} className="text-emerald-400" /> Boarding & Alighting Stops
                </h4>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const b = detail;
                    setViewBooking(null);
                    handleOpenTrack(b);
                  }}
                >
                  <Navigation size={13} className="mr-1.5" /> Track Live Bus Location
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                  <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 size={12} /> Pickup / Boarding Stop
                  </div>
                  <div className="text-sm font-semibold text-white">
                    {detail.origin_stop?.stop_name || 'Default Origin'}
                  </div>
                  {detail.boarding_time && (
                    <div className="text-xs text-slate-400">Boarding Time: {detail.boarding_time}</div>
                  )}
                  {detail.boarded_at && (
                    <div className="text-xs text-emerald-300">
                      Boarded At: {new Date(detail.boarded_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                  <div className="text-xs text-rose-400 font-semibold flex items-center gap-1">
                    <MapPin size={12} /> Dropoff / Alighting Stop
                  </div>
                  <div className="text-sm font-semibold text-white">
                    {detail.destination_stop?.stop_name || 'Default Destination'}
                  </div>
                  {detail.dropped_at && (
                    <div className="text-xs text-rose-300">
                      Dropped At: {new Date(detail.dropped_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Seats & Fare Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Seat Details */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                  <Ticket size={14} className="text-indigo-400" /> Seat Reservation
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total Seats Booked:</span>
                    <span className="font-bold text-white">
                      {detail.total_seats || seatList.length || 1}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block mb-1.5">Seat Numbers:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {seatList.length > 0 ? (
                        seatList.map((st: any, i: number) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-md bg-indigo-950 text-indigo-300 border border-indigo-500/30 text-xs font-mono font-bold"
                          >
                            Seat {st}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 text-xs italic">
                          No specific seat numbers assigned
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Financial Breakdown */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                  <CreditCard size={14} className="text-emerald-400" /> Payment & Fare Breakdown
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Base Fare:</span>
                    <span className="font-mono text-slate-200">₹{detail.total_fare || 0}</span>
                  </div>
                  {detail.discount_amount > 0 && (
                    <div className="flex justify-between text-rose-400">
                      <span className="flex items-center gap-1">
                        <Tag size={12} /> Coupon Discount{' '}
                        {detail.coupon?.code ? `(${detail.coupon.code})` : ''}:
                      </span>
                      <span className="font-mono">-₹{detail.discount_amount}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-800 pt-2 text-base font-bold">
                    <span className="text-white">Final Amount Paid:</span>
                    <span className="text-emerald-400 font-mono">₹{detail.final_amount}</span>
                  </div>
                  {detail.transaction_id && (
                    <div className="flex justify-between text-xs text-slate-400 pt-1">
                      <span>Txn ID:</span>
                      <span className="font-mono text-slate-300">{detail.transaction_id}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Cancellation Details if Cancelled */}
            {detail.booking_status === 'cancelled' && (
              <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/20 space-y-2">
                <div className="text-xs text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <XCircle size={14} /> Cancellation Record
                </div>
                <div className="text-sm text-rose-200">
                  <span className="text-slate-400">Reason: </span>
                  {detail.cancellation_reason || 'No cancellation reason specified'}
                </div>
                {detail.cancelled_at && (
                  <div className="text-xs text-slate-400">
                    Cancelled on: {new Date(detail.cancelled_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            {/* Special Requests */}
            {detail.special_requests && (
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                  Special Requests / Notes
                </div>
                <div className="text-sm text-slate-200 italic">{detail.special_requests}</div>
              </div>
            )}

            {/* Payment Transactions & Refunds History */}
            {((detail.payments && detail.payments.length > 0) ||
              (detail.refunds && detail.refunds.length > 0)) && (
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
                  Transaction & Refund History
                </h4>
                {detail.payments && detail.payments.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs text-slate-400 font-semibold">Payment Attempts:</span>
                    {detail.payments.map((p: any) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs p-2 rounded bg-slate-950 border border-slate-800"
                      >
                        <div>
                          <span className="font-mono text-slate-200">
                            {p.transaction_reference || p.gateway_order_id}
                          </span>
                          <span className="text-slate-500 ml-2">({p.payment_method || 'gateway'})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-emerald-400">₹{p.amount}</span>
                          <Badge color={p.status === 'success' ? 'green' : 'red'}>{p.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {detail.refunds && detail.refunds.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <span className="text-xs text-slate-400 font-semibold">Refunds:</span>
                    {detail.refunds.map((r: any) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between text-xs p-2 rounded bg-slate-950 border border-slate-800"
                      >
                        <div>
                          <span className="font-mono text-slate-200">{r.refund_reference}</span>
                          <span className="text-slate-400 ml-2">({r.reason})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-rose-400">₹{r.refund_amount}</span>
                          <Badge color={r.status === 'processed' ? 'green' : 'yellow'}>
                            {r.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
        title="Cancel Booking"
        message={`Cancel booking "${cancelTarget?.booking_reference}" for passenger ${cancelTarget?.passenger_name}? A refund transaction will be initiated if payment was completed.`}
        confirmLabel="Cancel Booking"
        loading={cancelling}
      />
    </div>
  );
};
