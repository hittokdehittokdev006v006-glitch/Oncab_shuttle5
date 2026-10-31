import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Search, Calendar, ChevronDown, Download, Info, CheckCircle2,
  Clock, AlertCircle, Eye, X, Filter, MapPin, Navigation, UserCheck,
  RotateCcw, Ban, User, Truck, ShieldAlert, Plus, Minus, Edit2, Zap, AlertTriangle,
  Compass, ArrowRight, Layers, Check, Copy, Activity, Gauge, Lock, Locate, Radio, Target, Phone
} from 'lucide-react';
import { tripsAPI, routesAPI, driversAPI, vehiclesAPI, bookingsAPI, locationsAPI, settingsAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, Button, LoadingState, ErrorState } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { hasRole } from '../utils/roles';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, CircleMarker, Circle } from 'react-leaflet';
import L from 'leaflet';
import { COMPLETION_RADIUS_METERS, checkProximityToStop, formatDistance } from '../utils/geoUtils';

type MapPosition = [number, number];

// Fix for default marker icon in Leaflet with React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  const brng = deg(Math.atan2(y, x));
  return Math.round((brng + 360) % 360);
};

const calculateDistanceKm = (points: MapPosition[]): number => {
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

const getCardinalDirection = (bearing: number): string => {
  const directions = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
};

const createStopPinIcon = (seq: number, isOrigin: boolean, isDest: boolean, isReached: boolean) => {
  const bg = isOrigin ? '#10b981' : isDest ? '#e11d48' : '#4f46e5';
  const label = isOrigin ? '1' : isDest ? (seq || '★') : seq;
  return L.divIcon({
    className: 'custom-stop-marker',
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
        <div style="background-color: ${bg}; width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid #ffffff; box-shadow: 0 3px 8px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 11px;">
          ${label}
        </div>
        ${isReached ? `<span style="position: absolute; top: -3px; right: -3px; width: 11px; height: 11px; background: #22c55e; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(34,197,94,0.8);"></span>` : ''}
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
};

const createDriverStartIcon = () =>
  L.divIcon({
    className: 'custom-driver-start',
    html: `
      <div style="background-color: #059669; color: white; padding: 3px 8px; border-radius: 9999px; font-weight: 800; font-size: 10px; border: 2px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
        <span>▶</span> START
      </div>
    `,
    iconSize: [64, 24],
    iconAnchor: [32, 12],
    popupAnchor: [0, -12],
  });

const createDriverEndIcon = (isCompleted: boolean) =>
  L.divIcon({
    className: 'custom-driver-end',
    html: `
      <div style="background-color: ${isCompleted ? '#e11d48' : '#0284c7'}; color: white; padding: 3px 8px; border-radius: 9999px; font-weight: 800; font-size: 10px; border: 2px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
        <span>${isCompleted ? '🏁' : '🚌'}</span> ${isCompleted ? 'COMPLETED' : 'LIVE'}
      </div>
    `,
    iconSize: [88, 24],
    iconAnchor: [44, 12],
    popupAnchor: [0, -12],
  });

const createDirectionIcon = (heading: number) =>
  L.divIcon({
    className: 'custom-direction-arrow',
    html: `
      <div style="transform: rotate(${heading}deg); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L19 21L12 17L5 21L12 2Z" fill="#10b981" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  });

const MapController: React.FC<{
  positions: MapPosition[];
  focusedPoint: MapPosition | null;
}> = ({ positions, focusedPoint }) => {
  const map = useMap();

  useEffect(() => {
    if (focusedPoint && Number.isFinite(focusedPoint[0]) && Number.isFinite(focusedPoint[1])) {
      map.setView(focusedPoint, Math.max(map.getZoom(), 16), { animate: true });
      return;
    }

    if (positions.length > 1) {
      const valid = positions.filter(
        ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      );
      if (valid.length > 1) {
        map.fitBounds(valid, { padding: [35, 35], maxZoom: 16 });
      } else if (valid.length === 1) {
        map.setView(valid[0], 14);
      }
    }
  }, [map, positions, focusedPoint]);

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

  // Driver GPS Tracking & Stoppage states
  const [driverLocations, setDriverLocations] = useState<any[]>([]);
  const [stopArrivals, setStopArrivals] = useState<any[]>([]);
  const [focusedPoint, setFocusedPoint] = useState<MapPosition | null>(null);
  const [showRoadRoute, setShowRoadRoute] = useState(true);
  const [showDriverTrail, setShowDriverTrail] = useState(true);
  const [showStoppagePins, setShowStoppagePins] = useState(true);
  const [copiedCoord, setCopiedCoord] = useState<string | null>(null);

  // ── Driver Live GPS & Dynamic Trip Completion Radius States ───────
  const [completionRadius, setCompletionRadius] = useState<number>(COMPLETION_RADIUS_METERS);
  const [liveLocation, setLiveLocation] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsTracking, setGpsTracking] = useState<boolean>(false);
  const [simulatedOffsetMeters, setSimulatedOffsetMeters] = useState<number | null>(null);
  const [showOverrideConfirm, setShowOverrideConfirm] = useState<boolean>(false);

  // Load configured trip completion radius from system settings
  useEffect(() => {
    settingsAPI.list().then((resp) => {
      const list = Array.isArray(resp.data?.data)
        ? resp.data.data
        : resp.data?.data?.settings || [];
      const found = list.find((s: any) => s.key === 'trip_completion_radius_meters');
      if (found && found.value) {
        const parsed = parseInt(found.value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          setCompletionRadius(parsed);
        }
      }
    }).catch(() => {
      // Keep default
    });
  }, []);

  // Watch live device GPS when an Active trip modal is open
  useEffect(() => {
    if (!infoTrip || infoTrip.status !== 'Active') {
      setLiveLocation(null);
      setGpsTracking(false);
      return;
    }

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser');
      return;
    }

    setGpsTracking(true);
    setGpsError(null);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLiveLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGpsTracking(false);
        setGpsError(null);
      },
      (err) => {
        setGpsTracking(false);
        if (err.code === 1) {
          setGpsError('Location permission denied. Please allow GPS access in your browser.');
        } else if (err.code === 2) {
          setGpsError('GPS position unavailable. Ensure device location is turned on.');
        } else if (err.code === 3) {
          setGpsError('GPS location request timed out. Retrying...');
        } else {
          setGpsError(err.message || 'Unable to retrieve GPS coordinates.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [infoTrip]);

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
      .sort((a: any, b: any) => Number(a.stop_sequence || 0) - Number(b.stop_sequence || 0));
  }, [infoTrip]);

  const finalStop = useMemo(() => {
    return routeStops.length > 0 ? routeStops[routeStops.length - 1] : null;
  }, [routeStops]);

  const driverPoints = useMemo(() => {
    const rawList = (infoTrip?.locations && infoTrip.locations.length > 0)
      ? infoTrip.locations
      : driverLocations;

    const parsed = (rawList || [])
      .map((loc: any, idx: number) => {
        const lat = Number(loc.latitude);
        const lng = Number(loc.longitude);
        const speed = loc.speed_kmh != null ? Number(loc.speed_kmh) : null;
        const heading = loc.heading != null ? Number(loc.heading) : null;
        return {
          ...loc,
          index: idx,
          latitude: lat,
          longitude: lng,
          speed,
          heading,
        };
      })
      .filter((loc: any) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)
        && Math.abs(loc.latitude) <= 90 && Math.abs(loc.longitude) <= 180);

    for (let i = 0; i < parsed.length - 1; i++) {
      if (parsed[i].heading === null || parsed[i].heading === undefined || parsed[i].heading === 0) {
        parsed[i].heading = calculateBearing(parsed[i].latitude, parsed[i].longitude, parsed[i + 1].latitude, parsed[i + 1].longitude);
      }
    }

    return parsed;
  }, [infoTrip, driverLocations]);

  const driverPositions = useMemo(() => {
    return driverPoints.map((p: any) => [p.latitude, p.longitude] as MapPosition);
  }, [driverPoints]);

  const driverDistanceKm = useMemo(() => {
    return calculateDistanceKm(driverPositions);
  }, [driverPositions]);

  const activeDriverCoord = useMemo(() => {
    if (!finalStop) return null;
    if (simulatedOffsetMeters !== null) {
      const offsetLat = finalStop.latitude + (simulatedOffsetMeters / 111111);
      return {
        latitude: offsetLat,
        longitude: finalStop.longitude,
        accuracy: 10,
        source: 'Simulator Test Position',
      };
    }
    if (liveLocation) {
      return {
        latitude: liveLocation.latitude,
        longitude: liveLocation.longitude,
        accuracy: liveLocation.accuracy,
        source: 'Live Device GPS',
      };
    }
    if (driverPoints.length > 0) {
      const latest = driverPoints[driverPoints.length - 1];
      return {
        latitude: latest.latitude,
        longitude: latest.longitude,
        accuracy: latest.accuracy || null,
        source: 'Driver GPS Telemetry (Server)',
      };
    }
    if (infoTrip?.driver?.details?.latitude && infoTrip?.driver?.details?.longitude) {
      return {
        latitude: Number(infoTrip.driver.details.latitude),
        longitude: Number(infoTrip.driver.details.longitude),
        accuracy: null,
        source: 'Driver Profile GPS',
      };
    }
    return null;
  }, [finalStop, simulatedOffsetMeters, liveLocation, driverPoints, infoTrip]);

  const completionProximity = useMemo(() => {
    if (!finalStop) return null;
    if (!activeDriverCoord) {
      return {
        hasLocation: false,
        isWithin: false,
        rawDistanceMeters: Infinity,
        effectiveDistanceMeters: Infinity,
        accuracyBuffer: 0,
        finalStop,
      };
    }

    const prox = checkProximityToStop(
      activeDriverCoord.latitude,
      activeDriverCoord.longitude,
      finalStop.latitude,
      finalStop.longitude,
      completionRadius,
      activeDriverCoord.accuracy
    );

    return {
      hasLocation: true,
      ...prox,
      driverLat: activeDriverCoord.latitude,
      driverLng: activeDriverCoord.longitude,
      accuracy: activeDriverCoord.accuracy,
      source: activeDriverCoord.source,
      finalStop,
      allowedRadius: completionRadius,
    };
  }, [finalStop, activeDriverCoord, completionRadius]);

  const allMapPositions = useMemo(() => {
    const stopCoords: MapPosition[] = routeStops.map((s: any) => [s.latitude, s.longitude]);
    const routeRoad = roadRoute || [];
    return [...stopCoords, ...routeRoad, ...driverPositions];
  }, [routeStops, roadRoute, driverPositions]);

  const arrivalMap = useMemo(() => {
    const map = new Map<number | string, any>();
    const arrivals = (infoTrip?.stop_arrivals && infoTrip.stop_arrivals.length > 0)
      ? infoTrip.stop_arrivals
      : stopArrivals;
    (arrivals || []).forEach((a: any) => {
      if (a.stop_id) map.set(Number(a.stop_id), a);
      if (a.stop_sequence) map.set(Number(a.stop_sequence), a);
    });
    return map;
  }, [infoTrip, stopArrivals]);

  // Sample arrows along the driver route (e.g. 8-12 points)
  const directionArrows = useMemo(() => {
    if (driverPoints.length < 2) return [];
    const step = Math.max(1, Math.floor(driverPoints.length / 10));
    const arrows = [];
    for (let i = 0; i < driverPoints.length - 1; i += step) {
      arrows.push(driverPoints[i]);
    }
    return arrows;
  }, [driverPoints]);

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

  const [summaryMetrics, setSummaryMetrics] = useState<{
    total_trips?: number;
    total_vehicles?: number;
    total_seats_booked?: number;
    total_capacity?: number;
    fill_rate?: string;
    net_revenue?: string;
  } | null>(null);

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
      if (resp.data.summary) {
        setSummaryMetrics(resp.data.summary);
      }
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
    setFocusedPoint(null);
    try {
      const [tripResp, bookingResp, locationResp] = await Promise.allSettled([
        tripsAPI.show(trip.id),
        bookingsAPI.list({ trip_id: trip.id, limit: 100 }),
        locationsAPI.getTripHistory(trip.id),
      ]);

      let tripData = trip;
      if (tripResp.status === 'fulfilled' && tripResp.value?.data?.data) {
        tripData = tripResp.value.data.data;
      }

      let fetchedLocations: any[] = tripData.locations || [];
      let fetchedStopArrivals: any[] = tripData.stop_arrivals || [];

      if (locationResp.status === 'fulfilled' && locationResp.value?.data?.data) {
        const locData = locationResp.value.data.data;
        if (locData.locations?.length > 0) {
          fetchedLocations = locData.locations;
          tripData.locations = locData.locations;
        }
        if (locData.stoppage_arrivals?.length > 0) {
          fetchedStopArrivals = locData.stoppage_arrivals;
          tripData.stop_arrivals = locData.stoppage_arrivals;
        }
        if ((!tripData.route?.stops || tripData.route.stops.length === 0) && locData.route?.stops?.length > 0) {
          tripData.route = { ...(tripData.route || {}), stops: locData.route.stops };
        }
      }

      // If stops are still missing, fallback to route API
      if ((!tripData.route?.stops || tripData.route.stops.length === 0) && tripData.route_id) {
        try {
          const rResp = await routesAPI.show(tripData.route_id);
          if (rResp.data?.data?.stops?.length > 0) {
            tripData.route = { ...(tripData.route || {}), stops: rResp.data.data.stops };
          }
        } catch {
          // Ignore fallback error
        }
      }

      setDriverLocations(fetchedLocations);
      setStopArrivals(fetchedStopArrivals);
      setInfoTrip(tripData);

      if (bookingResp.status === 'fulfilled' && bookingResp.value?.data?.data) {
        setTripBookings(bookingResp.value.data.data || []);
      } else {
        setTripBookings([]);
      }
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to load trip details', 'error');
      setInfoTrip(trip);
      setTripBookings([]);
      setDriverLocations([]);
      setStopArrivals([]);
    } finally {
      setLoadingBookings(false);
    }
  };

  // Refresh trip data
  const handleRefreshTrip = async () => {
    if (!infoTrip) return;
    setLoadingBookings(true);
    try {
      const [tripResp, bookingResp, locationResp] = await Promise.allSettled([
        tripsAPI.show(infoTrip.id),
        bookingsAPI.list({ trip_id: infoTrip.id, limit: 100 }),
        locationsAPI.getTripHistory(infoTrip.id),
      ]);

      let tripData = infoTrip;
      if (tripResp.status === 'fulfilled' && tripResp.value?.data?.data) {
        tripData = tripResp.value.data.data;
      }

      let fetchedLocations: any[] = tripData.locations || [];
      let fetchedStopArrivals: any[] = tripData.stop_arrivals || [];

      if (locationResp.status === 'fulfilled' && locationResp.value?.data?.data) {
        const locData = locationResp.value.data.data;
        if (locData.locations?.length > 0) {
          fetchedLocations = locData.locations;
          tripData.locations = locData.locations;
        }
        if (locData.stoppage_arrivals?.length > 0) {
          fetchedStopArrivals = locData.stoppage_arrivals;
          tripData.stop_arrivals = locData.stoppage_arrivals;
        }
        if ((!tripData.route?.stops || tripData.route.stops.length === 0) && locData.route?.stops?.length > 0) {
          tripData.route = { ...(tripData.route || {}), stops: locData.route.stops };
        }
      }

      setDriverLocations(fetchedLocations);
      setStopArrivals(fetchedStopArrivals);
      setInfoTrip(tripData);

      if (bookingResp.status === 'fulfilled' && bookingResp.value?.data?.data) {
        setTripBookings(bookingResp.value.data.data || []);
      }
      onNotify('Trip data refreshed successfully');
    } catch {
      onNotify('Failed to refresh trip data', 'error');
    } finally {
      setLoadingBookings(false);
    }
  };

  // Status change
  const handleStatusChange = async (tripId: number, newStatus: string, overridePayload?: object) => {
    // Dynamic radius restriction check when attempting to complete an Active trip
    if (newStatus === 'Completed') {
      const isOverride = (overridePayload as any)?.admin_override;
      if (!isOverride && completionProximity && completionProximity.finalStop) {
        if (!completionProximity.hasLocation) {
          onNotify(`You must reach within ${completionRadius} meters of the final destination to complete this trip.`, 'error');
          return;
        }

        if (!completionProximity.isWithin) {
          onNotify(`You must reach within ${completionRadius} meters of the final destination to complete this trip.`, 'error');
          return;
        }
      }
    }

    try {
      const payload = {
        ...(overridePayload || {}),
        ...(activeDriverCoord ? {
          latitude: activeDriverCoord.latitude,
          longitude: activeDriverCoord.longitude,
          accuracy: activeDriverCoord.accuracy,
        } : {}),
      };

      await tripsAPI.updateStatus(tripId, newStatus, payload);
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
    const headers = [
      'Trip ID',
      'Schedule Code',
      'Route',
      'Driver',
      'Vehicle',
      'Date',
      'Departure Time',
      'Scheduled Arrival (Last Stop)',
      'Completed Time (Driver Clicked)',
      'Last Stop Reach Time',
      'Audit Status',
      'Booked Seats',
      'Capacity',
      'Status'
    ];
    const rows = trips.map(t => [
      t.id,
      t.schedule_code,
      t.route?.route_name || '',
      t.driver?.name || '',
      t.vehicle?.registration_number || '',
      t.trip_date || '',
      t.departure_time || '',
      t.scheduled_last_stop_time || t.arrival_time || '',
      t.completed_at ? new Date(t.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      t.actual_last_stop_arrival?.arrived_at ? new Date(t.actual_last_stop_arrival.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      t.completion_audit?.audit_flag || '',
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

  // Calculate metrics: prioritize summary totals for all matching trips from API over single-page calculations
  const totalTripsCount = summaryMetrics?.total_trips ?? pagination.total ?? trips.length;
  const uniqueVehiclesCount = useMemo(() => {
    if (summaryMetrics?.total_vehicles !== undefined) {
      return summaryMetrics.total_vehicles;
    }
    const vSet = new Set(trips.map(t => t.vehicle_id).filter(Boolean));
    return vSet.size;
  }, [trips, summaryMetrics]);

  const totalSeatsBooked = summaryMetrics?.total_seats_booked ?? trips.reduce((acc, t) => acc + (t.booked_seats || 0), 0);
  const totalCapacity = summaryMetrics?.total_capacity ?? trips.reduce((acc, t) => acc + (t.seat_capacity || 0), 0);
  const fillRate = summaryMetrics?.fill_rate ?? (totalCapacity > 0 ? ((totalSeatsBooked / totalCapacity) * 100).toFixed(2) : '0.00');
  const avgFare = 80.63;
  const grossRevenue = (totalSeatsBooked * avgFare).toFixed(2);
  const gstAmount = (parseFloat(grossRevenue) * 0.05).toFixed(2);
  const netRevenue = summaryMetrics?.net_revenue ?? (parseFloat(grossRevenue) - parseFloat(gstAmount)).toFixed(2);

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
                'COMPLETION & REACH TIME',
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

                const audit = trip.completion_audit || {};
                const completedTimeStr = trip.completed_at
                  ? new Date(trip.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : null;
                const lastReachTimeStr = trip.actual_last_stop_arrival?.arrived_at
                  ? new Date(trip.actual_last_stop_arrival.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : null;
                const scheduledLastTimeStr = trip.scheduled_last_stop_time || trip.arrival_time?.slice(0, 5) || null;

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

                    <Td className="text-xs">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {trip.driver?.name || 'Unassigned'}
                      </div>
                      {trip.driver?.mobile && (
                        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                          <Phone size={10} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
                          <span>{trip.driver.mobile}</span>
                        </div>
                      )}
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

                    {/* Completion & Reach Time Audit Column */}
                    <Td className="text-xs font-mono">
                      {trip.status === 'Completed' || trip.completed_at ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Completed:</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {completedTimeStr || 'Recorded'}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            <div className="flex items-center gap-1">
                              <span>Last Stop:</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                {lastReachTimeStr || scheduledLastTimeStr || '—'}
                              </span>
                              {scheduledLastTimeStr && (
                                <span className="text-[10px] text-slate-400">
                                  (Sched: {scheduledLastTimeStr})
                                </span>
                              )}
                            </div>
                            {trip.last_stop_name && (
                              <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-sans truncate">
                                📍 {trip.last_stop_name}
                              </div>
                            )}
                          </div>

                          {/* Audit Flag for Driver Fraud / Cheating Detection */}
                          {audit.audit_flag === 'Suspiciously Early' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                              <AlertTriangle size={11} className="text-rose-600" />
                              Early Complete ({Math.abs(audit.time_diff_minutes)}m early)
                            </span>
                          ) : audit.audit_flag === 'Delayed' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              <Clock size={11} className="text-amber-600" />
                              Delayed (+{audit.time_diff_minutes}m)
                            </span>
                          ) : completedTimeStr ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              <CheckCircle2 size={11} className="text-emerald-600" />
                              Verified Timing
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="text-slate-400 text-[11px]">
                          <div>Sched Arrival: {scheduledLastTimeStr || '—'}</div>
                          <span className="text-[10px] italic text-slate-400">Trip in progress / pending</span>
                        </div>
                      )}
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
          <div className="relative w-full max-w-6xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] animate-in fade-in zoom-in duration-200">

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
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => handleStatusChange(infoTrip.id, 'Active')}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Start
                  </button>

                  {/* ── Complete Trip Button with Dynamic Radius Validation ── */}
                  {infoTrip.status === 'Active' && completionProximity?.finalStop ? (
                    completionProximity.isWithin ? (
                      <button
                        onClick={() => handleStatusChange(infoTrip.id, 'Completed')}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1.5 ring-2 ring-emerald-400 ring-offset-1 dark:ring-offset-slate-900 transition-all hover:scale-105"
                        title={`Driver is within ${completionRadius}m of ${completionProximity.finalStop.stop_name} (${formatDistance(completionProximity.rawDistanceMeters)}). Trip completion is unlocked.`}
                      >
                        <CheckCircle2 size={13} className="text-emerald-200" />
                        Complete Trip ({formatDistance(completionProximity.rawDistanceMeters)})
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            onNotify(`You must reach within ${completionRadius} meters of the final destination to complete this trip.`, 'error');
                          }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-700/80 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-600 cursor-not-allowed flex items-center gap-1.5 opacity-90 hover:opacity-100"
                          title={`You must reach within ${completionRadius} meters of the final destination to complete this trip.`}
                        >
                          <Lock size={13} className="text-rose-500" />
                          Complete Trip ({completionProximity.hasLocation ? formatDistance(completionProximity.rawDistanceMeters) : 'No GPS'})
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowOverrideConfirm(true)}
                          className="px-2 py-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-800 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title="Admin Force Complete Override"
                        >
                          Override
                        </button>
                      </div>
                    )
                  ) : (
                    <button
                      onClick={() => handleStatusChange(infoTrip.id, 'Completed')}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      Complete
                    </button>
                  )}

                  <button
                    onClick={() => handleStatusChange(infoTrip.id, 'Cancelled')}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    Cancel
                  </button>
                </div>}
              </div>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto p-4 sm:p-5 space-y-5 flex-1">
              {/* ── Destination Proximity Verification Card (when Active) ── */}
              {infoTrip.status === 'Active' && completionProximity?.finalStop && (
                <div className={`p-4 rounded-xl border transition-all ${
                  completionProximity.isWithin
                    ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                    : 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${completionProximity.isWithin ? 'bg-emerald-500 animate-ping' : 'bg-rose-500 animate-pulse'}`} />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <Target size={14} className={completionProximity.isWithin ? 'text-emerald-600' : 'text-rose-600'} />
                          Trip Completion {completionRadius}m Radius Rule
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                          completionProximity.isWithin
                            ? 'bg-emerald-200 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200'
                            : 'bg-rose-200 dark:bg-rose-900/80 text-rose-800 dark:text-rose-200'
                        }`}>
                          {completionProximity.isWithin ? '✓ Ready to Complete' : `⛔ Outside ${completionRadius}m Radius`}
                        </span>
                      </div>

                      <div className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                        Final Destination: <strong className="text-slate-900 dark:text-white">{completionProximity.finalStop.stop_name}</strong>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 ml-2">
                          ({Number(completionProximity.finalStop.latitude).toFixed(5)}, {Number(completionProximity.finalStop.longitude).toFixed(5)})
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                        <span>Driver GPS:</span>
                        {activeDriverCoord ? (
                          <span className="font-mono text-slate-800 dark:text-slate-200">
                            {activeDriverCoord.latitude.toFixed(5)}, {activeDriverCoord.longitude.toFixed(5)} ({activeDriverCoord.source})
                          </span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400 font-medium">No live GPS signal acquired</span>
                        )}
                        {activeDriverCoord?.accuracy && (
                          <span className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                            Accuracy: ±{Math.round(activeDriverCoord.accuracy)}m
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="sm:text-right shrink-0">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Distance to Destination</div>
                      <div className={`text-2xl font-black font-mono tracking-tight ${
                        completionProximity.isWithin ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {completionProximity.hasLocation ? formatDistance(completionProximity.rawDistanceMeters) : '—'}
                      </div>
                      <div className="text-[10px] text-slate-500 font-medium">
                        Permitted Threshold: <strong>≤ {completionRadius} meters</strong>
                      </div>
                    </div>
                  </div>

                  {/* Distance Meter Bar */}
                  <div className="mt-3">
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden relative">
                      {/* Radius marker tick */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-slate-400 dark:bg-slate-500 z-10"
                        style={{ left: `${Math.min(90, Math.max(10, (completionRadius / Math.max(500, completionRadius * 2)) * 100))}%` }}
                        title={`${completionRadius}m Radius Threshold`}
                      />
                      <div
                        className={`h-full transition-all duration-500 ${completionProximity.isWithin ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        style={{
                          width: `${Math.min(100, Math.max(5, (1 - (completionProximity.rawDistanceMeters || Math.max(500, completionRadius * 2)) / Math.max(500, completionRadius * 2)) * 100))}%`
                        }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono mt-1">
                      <span>0m (At Destination)</span>
                      <span className="font-bold text-slate-600 dark:text-slate-300">{completionRadius}m Completion Boundary</span>
                      <span>{Math.max(500, completionRadius * 2)}m+</span>
                    </div>
                  </div>

                  {/* Location Permission / Accuracy Warning */}
                  {gpsError && (
                    <div className="mt-2.5 p-2 rounded-lg bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                        <span>{gpsError}</span>
                      </div>
                      {navigator.geolocation && (
                        <button
                          type="button"
                          onClick={() => {
                            setGpsError(null);
                            navigator.geolocation.getCurrentPosition(
                              (pos) => setLiveLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
                              (err) => setGpsError(err.message)
                            );
                          }}
                          className="text-[10px] font-bold text-amber-800 dark:text-amber-300 underline ml-2 hover:opacity-80"
                        >
                          Retry GPS
                        </button>
                      )}
                    </div>
                  )}

                  {/* Quick Testing Simulator Bar */}
                  <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                      <Radio size={11} className="text-indigo-500" />
                      <span>GPS Distance Simulator:</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setSimulatedOffsetMeters(0)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          simulatedOffsetMeters === 0
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300'
                        }`}
                      >
                        0m (At Destination)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimulatedOffsetMeters(90)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          simulatedOffsetMeters === 90
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300'
                        }`}
                      >
                        90m (In Radius)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimulatedOffsetMeters(380)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          simulatedOffsetMeters === 380
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300'
                        }`}
                      >
                        380m (Outside Radius)
                      </button>
                      {simulatedOffsetMeters !== null && (
                        <button
                          type="button"
                          onClick={() => setSimulatedOffsetMeters(null)}
                          className="px-2 py-0.5 rounded text-[10px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline"
                        >
                          Reset to Real GPS
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

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
                      {infoTrip.driver?.mobile && (
                        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                          <Phone size={10} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
                          <span>{infoTrip.driver.mobile}</span>
                        </div>
                      )}
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

                  {/* Driver Completion & Stoppage Timing Audit Card */}
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Clock size={12} className="text-indigo-600 dark:text-indigo-400" />
                        TRIP COMPLETION & LAST STOPPAGE AUDIT
                      </span>
                      {infoTrip.completion_audit?.audit_flag === 'Suspiciously Early' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800 flex items-center gap-1">
                          <AlertTriangle size={11} /> Flagged: Early Complete
                        </span>
                      ) : infoTrip.status === 'Completed' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                          <CheckCircle2 size={11} /> Verified
                        </span>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                        <div className="text-[10px] text-slate-400">Driver Completed At:</div>
                        <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                          {infoTrip.completed_at
                            ? new Date(infoTrip.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                            : 'Not yet completed'}
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                        <div className="text-[10px] text-slate-400">Scheduled Last Stop Time:</div>
                        <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                          {infoTrip.scheduled_last_stop_time
                            || finalStop?.pickup_time
                            || finalStop?.scheduled_arrival_time
                            || finalStop?.arrival_time
                            || infoTrip.arrival_time?.slice(0, 5)
                            || '—'}
                          {(infoTrip.last_stop_name || finalStop?.stop_name || finalStop?.name) && (
                            <span className="block text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 font-sans truncate">
                              📍 {infoTrip.last_stop_name || finalStop?.stop_name || finalStop?.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {infoTrip.actual_last_stop_arrival && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                        Actual Arrival at Last Stop ({infoTrip.actual_last_stop_arrival.stop_name || 'Terminal'}):{' '}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {new Date(infoTrip.actual_last_stop_arrival.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </strong>
                      </div>
                    )}
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

                {/* Trajectory & Overview Summary Card */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-3.5 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Compass size={13} className="text-emerald-600 dark:text-emerald-400" />
                      DRIVER TRAJECTORY & ROUTE SUMMARY
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      infoTrip.status === 'Completed'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                        : infoTrip.status === 'Active'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    }`}>
                      {infoTrip.status || 'SCHEDULED'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80">
                      <div className="text-[10px] text-slate-400 uppercase font-sans font-bold">Route Stoppages</div>
                      <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1.5">
                        <MapPin size={15} className="text-indigo-600 dark:text-indigo-400" />
                        {routeStops.length} stops
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                        With valid GPS coordinates
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80">
                      <div className="text-[10px] text-slate-400 uppercase font-sans font-bold">Driver GPS Breadcrumbs</div>
                      <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1.5">
                        <Activity size={15} className="text-emerald-600 dark:text-emerald-400" />
                        {driverPoints.length} pings
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans mt-0.5 font-mono">
                        {driverDistanceKm > 0 ? `${driverDistanceKm} km driven` : 'Path recorded'}
                      </div>
                    </div>
                  </div>

                  {driverPoints.length > 0 ? (
                    <div className="space-y-2 p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1">
                          <Navigation size={12} className="text-emerald-600" />
                          Direction of Driver Travel:
                        </span>
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                          {getCardinalDirection(directionArrows[0]?.heading || 0)} ({directionArrows[0]?.heading || 0}°)
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 border-t border-emerald-200/60 dark:border-emerald-800/40">
                        <div>
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-sans block">Start Ping:</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {new Date(driverPoints[0].recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className="block text-[10px] text-slate-500 truncate">
                            {driverPoints[0].latitude.toFixed(5)}, {driverPoints[0].longitude.toFixed(5)}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-sans block">
                            {infoTrip.status === 'Completed' ? 'Completed Ping:' : 'Latest Ping:'}
                          </span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {new Date(driverPoints[driverPoints.length - 1].recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className="block text-[10px] text-slate-500 truncate">
                            {driverPoints[driverPoints.length - 1].latitude.toFixed(5)}, {driverPoints[driverPoints.length - 1].longitude.toFixed(5)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                      <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                      <div>
                        <strong>No Driver GPS Breadcrumbs:</strong> Location coordinates were not uploaded by driver for this trip instance (Driver was offline or manual completion). Route stops and planned road route are displayed.
                      </div>
                    </div>
                  )}

                  {/* Map Layer Toggles */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[10px] font-bold uppercase text-slate-400">Map Layers:</span>
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={showStoppagePins}
                          onChange={(e) => setShowStoppagePins(e.target.checked)}
                          className="rounded text-indigo-600 focus:ring-0"
                        />
                        <span>Stops ({routeStops.length})</span>
                      </label>

                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={showRoadRoute}
                          onChange={(e) => setShowRoadRoute(e.target.checked)}
                          className="rounded text-indigo-600 focus:ring-0"
                        />
                        <span>Road Route</span>
                      </label>

                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={showDriverTrail}
                          onChange={(e) => setShowDriverTrail(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-0"
                        />
                        <span>Driver Trail ({driverPoints.length})</span>
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() => setFocusedPoint(null)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 transition-colors"
                    >
                      Reset View
                    </button>
                  </div>
                </div>
              </div>

              {/* Full-Width Interactive Map & GPS Trail Section */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <MapPin size={16} className="text-indigo-600 dark:text-indigo-400" />
                      Trip Route & Driver GPS Trajectory Map
                    </h3>
                    <span className="text-[11px] text-slate-500 font-mono">
                      (OSRM Road Route & Actual Driver Path with Direction Indicators)
                    </span>
                  </div>

                  {driverDistanceKm > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                      Driver Distance: {driverDistanceKm} km
                    </span>
                  )}
                </div>

                <div className="relative rounded-2xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden h-[400px] sm:h-[460px] shadow-inner bg-slate-100 dark:bg-slate-800">
                  {allMapPositions.length > 0 ? (
                    <>
                      <MapContainer
                        center={allMapPositions[0]}
                        zoom={12}
                        style={{ height: '100%', width: '100%' }}
                        className="z-0"
                      >
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                          url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
                        />
                        <MapController positions={allMapPositions} focusedPoint={focusedPoint} />

                        {/* Planned OSRM Road Route Line (Indigo dashed) */}
                        {showRoadRoute && roadRoute.length > 1 && (
                          <Polyline
                            positions={roadRoute}
                            color="#6366f1"
                            weight={4}
                            dashArray="8, 8"
                            opacity={0.8}
                          />
                        )}

                        {/* Actual Driver GPS Trajectory Line (Emerald solid) */}
                        {showDriverTrail && driverPositions.length > 1 && (
                          <Polyline
                            positions={driverPositions}
                            color="#10b981"
                            weight={5}
                            opacity={0.95}
                          />
                        )}

                        {/* Directional Waypoint Arrows along Driver Path */}
                        {showDriverTrail && directionArrows.map((pt: any) => (
                          <Marker
                            key={`arrow-${pt.id || pt.index}`}
                            position={[pt.latitude, pt.longitude]}
                            icon={createDirectionIcon(pt.heading || 0)}
                          >
                            <Popup>
                              <div className="text-xs space-y-1 font-sans">
                                <div className="font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                  <Navigation size={12} />
                                  Driver Waypoint #{pt.index + 1}
                                </div>
                                <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                  <div><b>Lat:</b> {pt.latitude.toFixed(6)}</div>
                                  <div><b>Long:</b> {pt.longitude.toFixed(6)}</div>
                                  {pt.speed !== null && <div><b>Speed:</b> {pt.speed} km/h</div>}
                                  {pt.heading !== null && <div><b>Heading:</b> {pt.heading}° ({getCardinalDirection(pt.heading)})</div>}
                                  <div className="text-[10px] text-slate-400 mt-1">
                                    {new Date(pt.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </div>
                                </div>
                              </div>
                            </Popup>
                          </Marker>
                        ))}

                        {/* Driver Start Marker */}
                        {showDriverTrail && driverPositions.length > 0 && (
                          <Marker position={driverPositions[0]} icon={createDriverStartIcon()}>
                            <Popup>
                              <div className="text-xs space-y-1 font-sans">
                                <div className="font-bold text-emerald-700">Driver Start Location</div>
                                <div className="font-mono text-[11px]">
                                  <div><b>Lat:</b> {driverPoints[0].latitude.toFixed(6)}</div>
                                  <div><b>Long:</b> {driverPoints[0].longitude.toFixed(6)}</div>
                                  <div className="text-slate-500">
                                    Time: {new Date(driverPoints[0].recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </div>
                                </div>
                              </div>
                            </Popup>
                          </Marker>
                        )}

                        {/* Driver End / Completed Marker */}
                        {showDriverTrail && driverPositions.length > 1 && (
                          <Marker position={driverPositions[driverPositions.length - 1]} icon={createDriverEndIcon(infoTrip.status === 'Completed')}>
                            <Popup>
                              <div className="text-xs space-y-1 font-sans">
                                <div className="font-bold text-rose-700">
                                  {infoTrip.status === 'Completed' ? 'Trip Completed Location' : 'Latest Driver Ping Location'}
                                </div>
                                <div className="font-mono text-[11px]">
                                  <div><b>Lat:</b> {driverPoints[driverPoints.length - 1].latitude.toFixed(6)}</div>
                                  <div><b>Long:</b> {driverPoints[driverPoints.length - 1].longitude.toFixed(6)}</div>
                                  <div className="text-slate-500">
                                    Time: {new Date(driverPoints[driverPoints.length - 1].recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </div>
                                </div>
                              </div>
                            </Popup>
                          </Marker>
                        )}

                        {/* Route Stoppages Markers */}
                        {showStoppagePins && routeStops.map((stop: any, index: number) => {
                          const arrival = arrivalMap.get(Number(stop.id)) || arrivalMap.get(Number(stop.stop_sequence));
                          const isOrigin = index === 0;
                          const isDest = index === routeStops.length - 1;
                          const isReached = !!arrival;

                          return (
                            <React.Fragment key={stop.id || `${stop.stop_sequence}-${index}`}>
                              <Marker
                                position={[stop.latitude, stop.longitude]}
                                icon={createStopPinIcon(stop.stop_sequence || index + 1, isOrigin, isDest, isReached)}
                              >
                                <Popup>
                                  <div className="text-xs space-y-2 font-sans min-w-[200px] text-slate-800 dark:text-slate-100">
                                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-1.5">
                                      <span className="font-bold text-slate-900 dark:text-white">
                                        {isOrigin ? 'Origin' : isDest ? 'Destination' : `Stop #${stop.stop_sequence || index + 1}`}
                                      </span>
                                      {isReached ? (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                          Reached
                                        </span>
                                      ) : (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                          Pending
                                        </span>
                                      )}
                                    </div>

                                    <div className="font-bold text-sm text-slate-900 dark:text-white">
                                      {stop.stop_name || `Stop ${index + 1}`}
                                    </div>

                                    {isDest && (
                                      <div className={`p-1.5 rounded text-[10px] font-bold border ${
                                        completionProximity?.isWithin
                                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                          : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                                      }`}>
                                        🎯 {completionRadius}m Radius Zone: {completionProximity?.isWithin ? '✓ In Range' : '⛔ Outside'} ({formatDistance(completionProximity?.rawDistanceMeters)})
                                      </div>
                                    )}

                                    <div className="p-2 rounded bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700/80 font-mono text-[11px] space-y-0.5">
                                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Coordinates:</div>
                                      <div className="text-slate-850 dark:text-slate-200 font-semibold">
                                        Lat: {Number(stop.latitude).toFixed(6)}
                                      </div>
                                      <div className="text-slate-850 dark:text-slate-200 font-semibold">
                                        Long: {Number(stop.longitude).toFixed(6)}
                                      </div>
                                    </div>

                                    <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 pt-0.5">
                                      <div>
                                        <b className="text-slate-700 dark:text-slate-200">Scheduled:</b> {stop.pickup_time || stop.scheduled_arrival_time || stop.arrival_time || '—'}
                                      </div>
                                      {arrival?.arrived_at && (
                                        <div className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                          <b>Driver Reached:</b> {new Date(arrival.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </Popup>
                              </Marker>

                              {/* Destination Radius Zone Circle on Map */}
                              {isDest && (
                                <Circle
                                  center={[stop.latitude, stop.longitude]}
                                  radius={completionRadius}
                                  pathOptions={{
                                    color: completionProximity?.isWithin ? '#10b981' : '#f43f5e',
                                    fillColor: completionProximity?.isWithin ? '#10b981' : '#f43f5e',
                                    fillOpacity: 0.18,
                                    weight: 2,
                                    dashArray: completionProximity?.isWithin ? undefined : '5, 5',
                                  }}
                                >
                                  <Popup>
                                    <div className="text-xs p-1 font-sans space-y-1.5 text-slate-800 dark:text-slate-100">
                                      <div className="font-bold flex items-center gap-1 text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-1">
                                        🎯 {completionRadius}m Destination Radius Zone
                                      </div>
                                      <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                        <b className="text-slate-700 dark:text-slate-200">Final Destination:</b> {stop.stop_name}
                                      </div>
                                      <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                        <b className="text-slate-700 dark:text-slate-200">Proximity:</b> {formatDistance(completionProximity?.rawDistanceMeters)}
                                      </div>
                                      <div className="font-semibold text-[11px] pt-1" style={{ color: completionProximity?.isWithin ? '#10b981' : '#f43f5e' }}>
                                        {completionProximity?.isWithin
                                          ? `✓ Driver is within ${completionRadius}m radius. Trip completion is permitted.`
                                          : `⛔ Driver is outside ${completionRadius}m radius. Must reach within ${completionRadius}m.`}
                                      </div>
                                    </div>
                                  </Popup>
                                </Circle>
                              )}
                            </React.Fragment>
                          );
                        })}

                        {/* Simulated Driver Marker when using location simulator */}
                        {simulatedOffsetMeters !== null && activeDriverCoord && (
                          <Marker
                            position={[activeDriverCoord.latitude, activeDriverCoord.longitude]}
                            icon={L.divIcon({
                              className: 'simulated-driver-marker',
                              html: `
                                <div style="background-color: ${completionProximity?.isWithin ? '#10b981' : '#f43f5e'}; color: white; padding: 3px 8px; border-radius: 9999px; font-weight: 800; font-size: 10px; border: 2px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
                                  <span>📍</span> SIMULATOR (${formatDistance(completionProximity?.rawDistanceMeters)})
                                </div>
                              `,
                              iconSize: [130, 26],
                              iconAnchor: [65, 13],
                            })}
                          >
                            <Popup>
                              <div className="text-xs font-sans">
                                <b>Location Simulator Position</b>
                                <div>Distance: {formatDistance(completionProximity?.rawDistanceMeters)}</div>
                                <div>Status: {completionProximity?.isWithin ? `In Range (<= ${completionRadius}m)` : `Outside Range (> ${completionRadius}m)`}</div>
                              </div>
                            </Popup>
                          </Marker>
                        )}
                      </MapContainer>

                      {/* Map Status and Legend Overlay */}
                      <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap items-center gap-2 p-2 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-lg border border-slate-200 dark:border-slate-700 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-1 rounded bg-[#6366f1]"></span>
                          <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">Planned Road Route</span>
                        </div>

                        <div className="w-px h-3 bg-slate-300 dark:bg-slate-700"></div>

                        <div className="flex items-center gap-1.5">
                          <span className="w-3.5 h-1.5 rounded bg-[#10b981]"></span>
                          <span className="text-[11px] text-slate-800 dark:text-slate-200 font-bold">Driver Trajectory Path</span>
                        </div>

                        <div className="w-px h-3 bg-slate-300 dark:bg-slate-700"></div>

                        <div className="flex items-center gap-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="#10b981">
                            <path d="M12 2L19 21L12 17L5 21L12 2Z" />
                          </svg>
                          <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">Direction of Travel</span>
                        </div>

                        {loadingRoadRoute && (
                          <div className="text-[10px] text-indigo-600 font-semibold animate-pulse ml-2">
                            Loading OSRM Road Route...
                          </div>
                        )}
                        {routeMapError && (
                          <div className="text-[10px] text-amber-600 ml-2">
                            {routeMapError}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-slate-500 dark:text-slate-400">
                      {routeMapError || 'Route stops with coordinates or driver trajectory are not available.'}
                    </div>
                  )}
                </div>

                {/* Stoppages & Lat / Long Coordinates Table */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <MapPin size={15} className="text-indigo-600 dark:text-indigo-400" />
                        Route Stoppages & GPS Coordinates List ({routeStops.length} stops)
                      </h4>
                      <span className="text-xs text-slate-500">
                        (Origin, Intermediates, Destination)
                      </span>
                    </div>

                    {copiedCoord && (
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1 animate-in fade-in">
                        <Check size={12} /> Copied {copiedCoord}
                      </span>
                    )}
                  </div>

                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase text-[10px] bg-slate-50 dark:bg-slate-800/50">
                          <th className="p-2.5"># SEQ</th>
                          <th className="p-2.5">STOPPAGE NAME</th>
                          <th className="p-2.5">LATITUDE</th>
                          <th className="p-2.5">LONGITUDE</th>
                          <th className="p-2.5">SCHEDULED TIME</th>
                          <th className="p-2.5">DRIVER ARRIVAL</th>
                          <th className="p-2.5 text-right">ACTION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {routeStops.length > 0 ? routeStops.map((stop: any, idx: number) => {
                          const arrival = arrivalMap.get(Number(stop.id)) || arrivalMap.get(Number(stop.stop_sequence));
                          const isOrigin = idx === 0;
                          const isDest = idx === routeStops.length - 1;
                          const latStr = Number(stop.latitude).toFixed(6);
                          const lngStr = Number(stop.longitude).toFixed(6);
                          const coordPair = `${latStr}, ${lngStr}`;

                          return (
                            <tr key={stop.id || idx} className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                              <td className="p-2.5 font-bold font-mono">
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-bold ${
                                  isOrigin ? 'bg-emerald-600' : isDest ? 'bg-rose-600' : 'bg-indigo-600'
                                }`}>
                                  {isOrigin ? '1' : isDest ? '★' : (stop.stop_sequence || idx + 1)}
                                </span>
                              </td>

                              <td className="p-2.5">
                                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                  {stop.stop_name}
                                  {isOrigin && <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-semibold">Origin</span>}
                                  {isDest && <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 font-semibold">Destination</span>}
                                </div>
                                {stop.address && <div className="text-[10px] text-slate-400 truncate max-w-xs">{stop.address}</div>}
                              </td>

                              <td className="p-2.5 font-mono font-semibold text-slate-700 dark:text-slate-300">
                                {latStr}
                              </td>

                              <td className="p-2.5 font-mono font-semibold text-slate-700 dark:text-slate-300">
                                {lngStr}
                              </td>

                              <td className="p-2.5 font-mono text-slate-600 dark:text-slate-400">
                                {stop.pickup_time || stop.scheduled_arrival_time || stop.arrival_time || '—'}
                              </td>

                              <td className="p-2.5">
                                {arrival?.arrived_at ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-mono font-bold text-[11px]">
                                    <CheckCircle2 size={12} className="text-emerald-600" />
                                    {new Date(arrival.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-[11px] italic">
                                    Not reached
                                  </span>
                                )}
                              </td>

                              <td className="p-2.5 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(coordPair);
                                      setCopiedCoord(coordPair);
                                      setTimeout(() => setCopiedCoord(null), 2000);
                                    }}
                                    title="Copy Lat, Long"
                                    className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                                  >
                                    <Copy size={12} />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setFocusedPoint([Number(stop.latitude), Number(stop.longitude)])}
                                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 transition-colors"
                                  >
                                    Focus
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        }) : (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-500 dark:text-slate-400">
                              No route stoppages configured with coordinates for this trip.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
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

      {/* Admin Force Complete Override Modal */}
      {showOverrideConfirm && infoTrip && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border-2 border-rose-500 rounded-2xl shadow-2xl p-6 space-y-4 animate-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                <AlertTriangle size={20} />
                Admin Emergency Override
              </h3>
              <button
                type="button"
                onClick={() => setShowOverrideConfirm(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              The driver is currently <strong>outside the required {completionRadius}-meter destination radius</strong>
              {completionProximity?.rawDistanceMeters && Number.isFinite(completionProximity.rawDistanceMeters)
                ? ` (${formatDistance(completionProximity.rawDistanceMeters)} from ${completionProximity.finalStop?.stop_name || 'destination'})`
                : ' (live GPS coordinates unavailable)'}.
              <br /><br />
              Normal rule requires drivers to physically reach within {completionRadius}m of the final stop. Are you sure you want to forcibly complete this trip as Administrator?
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button size="sm" variant="ghost" onClick={() => setShowOverrideConfirm(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-rose-600 hover:bg-rose-700 text-white"
                onClick={() => {
                  setShowOverrideConfirm(false);
                  handleStatusChange(infoTrip.id, 'Completed', { admin_override: true });
                }}
              >
                Confirm Force Complete
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
