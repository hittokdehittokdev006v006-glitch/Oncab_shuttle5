import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Download, Upload, Eye, FileSpreadsheet, X, CheckCircle2, Clock, Calendar, RefreshCw, Zap, Copy, ArrowRight, Filter, Search, RotateCcw, CalendarDays, Phone } from 'lucide-react';
import { tripsAPI, routesAPI, driversAPI, vehiclesAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { hasRole } from '../utils/roles';
import { Card, Table, Tr, Td, Pagination, Button, StatusBadge, ConfirmDialog, ErrorState, Modal } from '../components/ui';

interface ScheduledTripsPageProps {
  onNotify: (msg: string, type?: any) => void;
}

const DAYS_OF_WEEK = [
  { id: '1', label: 'Mon', full: 'Monday' },
  { id: '2', label: 'Tue', full: 'Tuesday' },
  { id: '3', label: 'Wed', full: 'Wednesday' },
  { id: '4', label: 'Thu', full: 'Thursday' },
  { id: '5', label: 'Fri', full: 'Friday' },
  { id: '6', label: 'Sat', full: 'Saturday' },
  { id: '7', label: 'Sun', full: 'Sunday' },
];

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getTomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const ScheduledTripsPage: React.FC<ScheduledTripsPageProps> = ({ onNotify }) => {
  const { user, hasPermission } = useAuth();
  const isOwner = hasRole(user, 'owner');
  const canRequestAssignment = !isOwner || hasPermission('bookings.read');
  const [schedules, setSchedules] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });

  // Table Date & Search Filter State
  const [filterDate, setFilterDate] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [routeFilter, setRouteFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Replicate / Duplicate Trips State
  const [copyForm, setCopyForm] = useState({
    source_date: getTodayStr(),
    target_date: getTomorrowStr(),
    include_driver_vehicle: true,
    overwrite_existing: true,
  });
  const [copying, setCopying] = useState(false);

  // Single Trip Copy Modal State
  const [singleCopyTarget, setSingleCopyTarget] = useState<any | null>(null);
  const [singleCopyDate, setSingleCopyDate] = useState<string>(getTomorrowStr());
  const [singleCopyIncludeFleet, setSingleCopyIncludeFleet] = useState(true);
  const [copyingSingle, setCopyingSingle] = useState(false);

  // Single / Recurring Master Schedule Creation Form
  const [singleForm, setSingleForm] = useState({
    route_id: '',
    driver_id: '',
    vehicle_id: '',
    bus_type_id: '',
    trip_date: '',
    valid_from: new Date().toISOString().split('T')[0],
    valid_until: '',
    departure_time: '',
    seat_capacity: '',
    operating_days: ['1', '2', '3', '4', '5'], // Default: Mon-Fri
  });
  const [creatingSingle, setCreatingSingle] = useState(false);

  // Future Trip Generator State
  const [genForm, setGenForm] = useState({
    days_ahead: 14,
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
  });
  const [generatingFuture, setGeneratingFuture] = useState(false);

  // Bulk CSV Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvPreviewData, setCsvPreviewData] = useState<any[] | null>(null);
  const [uploadingBulk, setUploadingBulk] = useState(false);

  // Edit / Delete State
  const [editSchedule, setEditSchedule] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params: any = { page, limit: 15 };
      if (filterDate) params.trip_date = filterDate;
      if (search) params.search = search;
      if (routeFilter) params.route_id = routeFilter;
      if (statusFilter) params.status = statusFilter;

      const resp = await tripsAPI.list(params);
      setSchedules(resp.data.data || []);
      setPagination(resp.data.pagination || { total: 0, pages: 1, limit: 15 });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load scheduled trips');
    } finally {
      setLoading(false);
    }
  }, [page, filterDate, search, routeFilter, statusFilter]);

  const loadDropdowns = async () => {
    try {
      const [dRes, vRes] = await Promise.all([
        driversAPI.list({ limit: 100 }),
        vehiclesAPI.list({ limit: 100 }),
      ]);
      setDrivers(dRes.data.data || []);
      setVehicles(vRes.data.data || []);
    } catch {
      // ignore
    }
    if (!isOwner) {
      try {
        const routeResponse = await routesAPI.list({ limit: 100 });
        setRoutes(routeResponse.data.data || []);
      } catch {
        setRoutes([]);
      }
    }
  };

  useEffect(() => {
    fetchSchedules();
    loadDropdowns();
  }, [fetchSchedules, isOwner]);

  // Operating Days helpers
  const handleToggleDay = (dayId: string) => {
    setSingleForm((prev) => {
      const exists = prev.operating_days.includes(dayId);
      const nextDays = exists
        ? prev.operating_days.filter((d) => d !== dayId)
        : [...prev.operating_days, dayId];
      return { ...prev, operating_days: nextDays.sort() };
    });
  };

  const handleApplyDayPreset = (preset: 'weekdays' | 'weekends' | 'daily') => {
    if (preset === 'weekdays') {
      setSingleForm((prev) => ({ ...prev, operating_days: ['1', '2', '3', '4', '5'] }));
    } else if (preset === 'weekends') {
      setSingleForm((prev) => ({ ...prev, operating_days: ['6', '7'] }));
    } else if (preset === 'daily') {
      setSingleForm((prev) => ({ ...prev, operating_days: ['1', '2', '3', '4', '5', '6', '7'] }));
    }
  };

  const formatOperatingDays = (opDays: any) => {
    if (!opDays) return 'Daily';
    const str = String(opDays).toLowerCase().trim();
    if (str === 'daily' || str === '1,2,3,4,5,6,7') return 'Daily (Mon-Sun)';
    if (str === '1,2,3,4,5' || str === 'weekdays') return 'Weekdays (Mon-Fri)';
    if (str === '6,7' || str === 'weekends') return 'Weekends (Sat-Sun)';

    const tokens = str.split(/[,;\s]+/);
    const mapped = tokens
      .map((t) => DAYS_OF_WEEK.find((d) => d.id === t || d.label.toLowerCase() === t.toLowerCase())?.label || t)
      .join(', ');
    return mapped || str;
  };

  // Handle Single / Master Schedule Creation
  const handleCreateSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleForm.route_id || !singleForm.departure_time) {
      onNotify('Route and Departure Time are required', 'error');
      return;
    }

    setCreatingSingle(true);
    try {
      const scheduleCode = `SCH-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const payload: any = {
        schedule_code: scheduleCode,
        route_id: parseInt(singleForm.route_id),
        driver_id: singleForm.driver_id ? parseInt(singleForm.driver_id) : null,
        vehicle_id: singleForm.vehicle_id ? parseInt(singleForm.vehicle_id) : null,
        bus_type_id: singleForm.bus_type_id
          ? parseInt(singleForm.bus_type_id)
          : (vehicles.find((vehicle) => String(vehicle.id) === singleForm.vehicle_id)?.bus_type_id
            || vehicles.find((vehicle) => String(vehicle.id) === singleForm.vehicle_id)?.bus_type?.id
            || null),
        trip_date: singleForm.trip_date || singleForm.valid_from || new Date().toISOString().split('T')[0],
        valid_from: singleForm.valid_from || null,
        valid_until: singleForm.valid_until || null,
        operating_days: singleForm.operating_days.join(','),
        departure_time: singleForm.departure_time,
        seat_capacity: singleForm.seat_capacity ? parseInt(singleForm.seat_capacity) : 40,
        status: 'Scheduled',
      };

      await tripsAPI.create(payload);
      onNotify('Master Schedule created successfully');
      setSingleForm({
        route_id: '',
        driver_id: '',
        vehicle_id: '',
        bus_type_id: '',
        trip_date: '',
        valid_from: new Date().toISOString().split('T')[0],
        valid_until: '',
        departure_time: '',
        seat_capacity: '',
        operating_days: ['1', '2', '3', '4', '5'],
      });
      fetchSchedules();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to create schedule', 'error');
    } finally {
      setCreatingSingle(false);
    }
  };

  // Quick Time Selector
  const handleQuickTimeChange = (timeValue: string) => {
    if (timeValue) {
      setSingleForm((prev) => ({ ...prev, departure_time: timeValue }));
    }
  };

  // Replicate / Duplicate Day's Trips
  const handleCopyTrips = async (customSource?: string, customTarget?: string) => {
    const src = customSource || copyForm.source_date;
    const tgt = customTarget || copyForm.target_date;

    if (!src || !tgt) {
      onNotify('Source date and Target date are required', 'error');
      return;
    }
    if (src === tgt) {
      onNotify('Target date must be different from source date', 'error');
      return;
    }

    setCopying(true);
    try {
      const resp = await tripsAPI.copyTrips({
        source_date: src,
        target_date: tgt,
        include_driver_vehicle: copyForm.include_driver_vehicle,
        overwrite_existing: copyForm.overwrite_existing,
      });

      const message = resp.data?.message || `Successfully replicated trips to ${tgt}!`;
      onNotify(message);

      // Automatically switch table view to target date so operator can inspect the newly copied trips
      setFilterDate(tgt);
      setPage(1);
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to replicate trips', 'error');
    } finally {
      setCopying(false);
    }
  };

  const handleCopySingleTrip = async () => {
    if (!singleCopyTarget || !singleCopyDate) {
      onNotify('Target date is required', 'error');
      return;
    }

    setCopyingSingle(true);
    try {
      const srcDate = singleCopyTarget.trip_date || filterDate || copyForm.source_date || getTodayStr();
      const resp = await tripsAPI.copyTrips({
        source_date: srcDate,
        target_date: singleCopyDate,
        trip_ids: [singleCopyTarget.id],
        include_driver_vehicle: singleCopyIncludeFleet,
        overwrite_existing: true,
      });

      onNotify(resp.data?.message || `Trip replicated to ${singleCopyDate}`);
      setSingleCopyTarget(null);
      setFilterDate(singleCopyDate);
      setPage(1);
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to replicate trip', 'error');
    } finally {
      setCopyingSingle(false);
    }
  };

  const handleDateFilterChange = (date: string) => {
    setFilterDate(date);
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilterDate('');
    setSearch('');
    setRouteFilter('');
    setStatusFilter('');
    setPage(1);
  };

  // Bulk Generate Future Trips Action
  const handleGenerateFutureTrips = async (daysAheadNum?: number) => {
    setGeneratingFuture(true);
    try {
      const payload: any = {
        days_ahead: daysAheadNum || genForm.days_ahead || 14,
        start_date: genForm.start_date || new Date().toISOString().split('T')[0],
      };
      if (genForm.end_date) payload.end_date = genForm.end_date;

      const resp = await tripsAPI.generateFuture(payload);
      const { created_count, skipped_count, message } = resp.data?.data || resp.data || {};
      onNotify(message || `Generated ${created_count || 0} future trips (${skipped_count || 0} skipped)`);
      fetchSchedules();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Future trip generation failed', 'error');
    } finally {
      setGeneratingFuture(false);
    }
  };

  // Download Sample Template CSV
  const handleDownloadTemplate = () => {
    const csvContent = 'schedule_code,route_id,driver_id,vehicle_id,operating_days,valid_from,valid_until,departure_time,seat_capacity\nSCH-2026-101,1,1,1,"1,2,3,4,5",2026-10-01,2026-12-31,06:30,40\nSCH-2026-102,2,2,2,"6,7",2026-10-01,2026-12-31,08:00,35';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'bulk_trip_creation_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onNotify('Sample CSV Template downloaded');
  };

  // Handle CSV File Selection & Preview
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handlePreviewCSV = () => {
    if (!selectedFile) {
      onNotify('Please choose a CSV file first', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(Boolean);
      if (lines.length <= 1) {
        onNotify('CSV file is empty or has only headers', 'error');
        return;
      }
      const headers = lines[0].split(',').map((h) => h.trim());
      const dataRows = lines.slice(1).map((line) => {
        const values = line.split(',').map((v) => v.trim());
        const rowObj: any = {};
        headers.forEach((h, i) => {
          rowObj[h] = values[i] || '';
        });
        return rowObj;
      });
      setCsvPreviewData(dataRows);
    };
    reader.readAsText(selectedFile);
  };

  const handleUploadBulk = async () => {
    if (!selectedFile) {
      onNotify('Please select a CSV file to upload', 'error');
      return;
    }

    setUploadingBulk(true);
    try {
      if (csvPreviewData && csvPreviewData.length > 0) {
        for (const item of csvPreviewData) {
          try {
            await tripsAPI.create({
              schedule_code: item.schedule_code || `SCH-${Date.now().toString().slice(-4)}`,
              route_id: parseInt(item.route_id || '1'),
              driver_id: item.driver_id ? parseInt(item.driver_id) : null,
              vehicle_id: item.vehicle_id ? parseInt(item.vehicle_id) : null,
              operating_days: item.operating_days || '1,2,3,4,5',
              valid_from: item.valid_from || new Date().toISOString().split('T')[0],
              valid_until: item.valid_until || null,
              departure_time: item.departure_time || '08:00',
              seat_capacity: item.seat_capacity ? parseInt(item.seat_capacity) : 40,
              status: 'Scheduled',
            });
          } catch {
            // continue
          }
        }
      }
      onNotify('Bulk trips processed successfully');
      setSelectedFile(null);
      setCsvPreviewData(null);
      fetchSchedules();
    } catch (err: any) {
      onNotify('Bulk upload encountered errors', 'error');
    } finally {
      setUploadingBulk(false);
    }
  };

  // Edit schedule
  const handleOpenEdit = (schedule: any) => {
    setEditSchedule(schedule);
    const opArr = schedule.operating_days ? String(schedule.operating_days).split(/[,;\s]+/) : ['1', '2', '3', '4', '5'];
    setEditForm({
      driver_id: String(schedule.driver_id || ''),
      vehicle_id: String(schedule.vehicle_id || ''),
      ...(!isOwner ? {
        schedule_code: schedule.schedule_code,
        route_id: String(schedule.route_id || ''),
        departure_time: schedule.departure_time || '',
        valid_from: schedule.valid_from || '',
        valid_until: schedule.valid_until || '',
        operating_days: opArr,
        status: schedule.status || 'Scheduled',
      } : {}),
    });
  };

  const handleSaveEdit = async () => {
    if (!editSchedule) return;
    setSavingEdit(true);
    try {
      const payload = isOwner
        ? {
          driver_id: editForm.driver_id ? parseInt(editForm.driver_id) : null,
          vehicle_id: editForm.vehicle_id ? parseInt(editForm.vehicle_id) : null,
        }
        : {
          ...editForm,
          route_id: parseInt(editForm.route_id),
          driver_id: editForm.driver_id ? parseInt(editForm.driver_id) : null,
          vehicle_id: editForm.vehicle_id ? parseInt(editForm.vehicle_id) : null,
          operating_days: Array.isArray(editForm.operating_days) ? editForm.operating_days.join(',') : editForm.operating_days,
        };
      const response = await tripsAPI.update(editSchedule.id, payload);
      onNotify(response.data.message || (isOwner ? 'Assignment request sent for admin approval' : 'Schedule updated successfully'));
      setEditSchedule(null);
      fetchSchedules();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Update failed', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await tripsAPI.delete(deleteTarget.id);
      onNotify('Trip schedule deleted successfully');
      setDeleteTarget(null);
      fetchSchedules();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Card 1: 1-Click Replicate Day's Trips to Tomorrow / Target Date ── */}
      {!isOwner && (
        <div className="bg-gradient-to-r from-indigo-900/90 via-purple-900/90 to-slate-900 text-white p-5 rounded-2xl border border-indigo-500/40 shadow-xl space-y-4 relative overflow-hidden">
          {/* Subtle decorative glow */}
          <div className="absolute -right-10 -bottom-10 w-44 h-44 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-slate-950 mb-1.5">
                <Zap size={12} className="fill-slate-950" /> HIGH-PRIORITY OPERATOR TOOL
              </div>
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Copy size={18} className="text-indigo-400" />
                Replicate / Copy Day's Scheduled Trips
              </h3>
              <p className="text-xs text-indigo-200/80 mt-0.5">
                Duplicate all scheduled trips from today (e.g. 26 Oct) to tomorrow (27 Oct) or any target date with routes, timings, and fleet assignments intact.
              </p>
            </div>

            {/* Quick 1-Click Preset Button */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopyTrips(getTodayStr(), getTomorrowStr())}
                disabled={copying}
                className="px-4 py-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 text-xs font-extrabold rounded-xl shadow-lg transition-all transform active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {copying ? (
                  <RefreshCw size={14} className="animate-spin text-slate-950" />
                ) : (
                  <Zap size={14} className="fill-slate-950" />
                )}
                ⚡ Copy Today's Trips ({getTodayStr()}) to Tomorrow ({getTomorrowStr()})
              </button>
            </div>
          </div>

          <div className="p-4 bg-slate-950/40 backdrop-blur-md rounded-xl border border-indigo-400/20 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            {/* SOURCE DATE */}
            <div className="md:col-span-3">
              <label className="block text-[11px] font-bold text-indigo-200 mb-1 tracking-wider uppercase flex items-center gap-1">
                <Calendar size={13} className="text-indigo-400" />
                SOURCE DATE (FROM)
              </label>
              <input
                type="date"
                value={copyForm.source_date}
                onChange={(e) => setCopyForm({ ...copyForm, source_date: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-900/90 text-white border border-indigo-400/30 rounded-lg focus:outline-none focus:border-amber-400 font-medium"
              />
            </div>

            {/* ARROW */}
            <div className="hidden md:flex md:col-span-1 justify-center pb-2">
              <ArrowRight size={20} className="text-indigo-300 animate-pulse" />
            </div>

            {/* TARGET DATE */}
            <div className="md:col-span-3">
              <label className="block text-[11px] font-bold text-amber-300 mb-1 tracking-wider uppercase flex items-center gap-1">
                <Calendar size={13} className="text-amber-400" />
                TARGET DATE (TO)
              </label>
              <input
                type="date"
                value={copyForm.target_date}
                onChange={(e) => setCopyForm({ ...copyForm, target_date: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-900/90 text-white border border-amber-400/50 rounded-lg focus:outline-none focus:border-amber-400 font-medium ring-1 ring-amber-400/20"
              />
            </div>

            {/* OPTIONS */}
            <div className="md:col-span-2 flex flex-col justify-end space-y-1.5 pb-1">
              <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-slate-200 font-semibold select-none">
                <input
                  type="checkbox"
                  checked={copyForm.include_driver_vehicle}
                  onChange={(e) => setCopyForm({ ...copyForm, include_driver_vehicle: e.target.checked })}
                  className="rounded text-indigo-500 focus:ring-0 w-3.5 h-3.5 bg-slate-800 border-slate-600"
                />
                Include Drivers & Buses
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-slate-200 font-semibold select-none">
                <input
                  type="checkbox"
                  checked={copyForm.overwrite_existing}
                  onChange={(e) => setCopyForm({ ...copyForm, overwrite_existing: e.target.checked })}
                  className="rounded text-indigo-500 focus:ring-0 w-3.5 h-3.5 bg-slate-800 border-slate-600"
                />
                Update existing
              </label>
            </div>

            {/* ACTION BUTTON */}
            <div className="md:col-span-3">
              <button
                type="button"
                onClick={() => handleCopyTrips()}
                disabled={copying}
                className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {copying ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Replicating Trips...
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copy All Trips to {copyForm.target_date || 'Target Date'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Card 2: Create Master & Recurring Trip Schedule ── */}
      {!isOwner && <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Calendar size={18} className="text-indigo-600 dark:text-indigo-400" />
              Create Master & Recurring Trip Schedule
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Define route timetables, driver/bus assignments, repeat operating days, and validity ranges.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateSingle} className="space-y-4">
          {/* Row 1: Route, Driver, Vehicle, Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* ROUTE */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
                ROUTE <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={singleForm.route_id}
                onChange={(e) => setSingleForm({ ...singleForm, route_id: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="">Select a route</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.route_code || `R${r.id}`} - {r.route_name}
                  </option>
                ))}
              </select>
            </div>

            {/* DRIVER */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
                DRIVER
              </label>
              <select
                value={singleForm.driver_id}
                onChange={(e) => setSingleForm({ ...singleForm, driver_id: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="">Select a driver</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.driver_user_id || `D-${d.id}`})
                  </option>
                ))}
              </select>
            </div>

            {/* VEHICLE */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
                VEHICLE
              </label>
              <select
                value={singleForm.vehicle_id}
                onChange={(e) => {
                  const vehicleId = e.target.value;
                  const selectedVehicle = vehicles.find((vehicle) => String(vehicle.id) === vehicleId);
                  setSingleForm((prev) => ({
                    ...prev,
                    vehicle_id: vehicleId,
                    bus_type_id: selectedVehicle?.bus_type_id || selectedVehicle?.bus_type?.id
                      ? String(selectedVehicle.bus_type_id || selectedVehicle.bus_type.id)
                      : '',
                  }));
                }}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="">Select a vehicle</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration_number || v.vehicle_number} ({v.bus_type?.name || 'Bus'})
                  </option>
                ))}
              </select>
            </div>

            {/* DEPARTURE TIME */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
                DEPARTURE TIME <span className="text-rose-500">*</span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="time"
                  required
                  value={singleForm.departure_time}
                  onChange={(e) => setSingleForm({ ...singleForm, departure_time: e.target.value })}
                  className="w-1/2 px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
                />
                <select
                  onChange={(e) => handleQuickTimeChange(e.target.value)}
                  className="w-1/2 px-2 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
                  defaultValue=""
                >
                  <option value="" disabled>Quick Times</option>
                  <option value="06:00">06:00 AM</option>
                  <option value="07:30">07:30 AM</option>
                  <option value="08:00">08:00 AM</option>
                  <option value="09:30">09:30 AM</option>
                  <option value="17:30">05:30 PM</option>
                  <option value="18:30">06:30 PM</option>
                  <option value="20:00">08:00 PM</option>
                </select>
              </div>
            </div>
          </div>

          {/* Row 2: Repeat Operating Days & Presets */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <RefreshCw size={14} className="text-indigo-600 dark:text-indigo-400" />
                REPEAT OPERATING DAYS
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleApplyDayPreset('weekdays')}
                  className="px-2.5 py-1 text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-slate-700 transition-colors shadow-xs"
                >
                  Mon - Fri (Weekdays)
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyDayPreset('weekends')}
                  className="px-2.5 py-1 text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-slate-700 transition-colors shadow-xs"
                >
                  Sat - Sun (Weekends)
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyDayPreset('daily')}
                  className="px-2.5 py-1 text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-slate-700 transition-colors shadow-xs"
                >
                  Daily (7 Days)
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((d) => {
                const active = singleForm.operating_days.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handleToggleDay(d.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      active
                        ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-500/30'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: Validity Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
                VALID FROM (START DATE)
              </label>
              <input
                type="date"
                value={singleForm.valid_from}
                onChange={(e) => setSingleForm({ ...singleForm, valid_from: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
                VALID UNTIL (END DATE)
              </label>
              <input
                type="date"
                value={singleForm.valid_until}
                placeholder="Optional end date"
                onChange={(e) => setSingleForm({ ...singleForm, valid_until: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={creatingSingle}
                className="w-full px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow-sm transition-all disabled:opacity-50"
              >
                {creatingSingle ? 'Creating...' : 'Create Master Schedule'}
              </button>
            </div>
          </div>
        </form>
      </div>}

      {/* ── Card 2: Cityflo-Style Future Trip Instance Generator ── */}
      {!isOwner && <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-indigo-200/80 dark:border-indigo-800/40 text-slate-900 dark:text-white shadow-sm space-y-4 transition-colors">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap size={18} className="text-amber-500 fill-amber-500" />
              1-Click Future Trip Instance Generator
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Auto-generate daily future trips for all active schedules according to their repeat operating days & validity dates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleGenerateFutureTrips(7)}
              disabled={generatingFuture}
              className="px-3.5 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-slate-700 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 transition-all disabled:opacity-50 shadow-xs"
            >
              +7 Days Ahead
            </button>
            <button
              type="button"
              onClick={() => handleGenerateFutureTrips(14)}
              disabled={generatingFuture}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all disabled:opacity-50"
            >
              +14 Days Ahead
            </button>
            <button
              type="button"
              onClick={() => handleGenerateFutureTrips(30)}
              disabled={generatingFuture}
              className="px-3.5 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-slate-700 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 transition-all disabled:opacity-50 shadow-xs"
            >
              +30 Days Ahead
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
              GENERATION START DATE
            </label>
            <input
              type="date"
              value={genForm.start_date}
              onChange={(e) => setGenForm({ ...genForm, start_date: e.target.value })}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:border-amber-500 font-medium"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
              GENERATION END DATE (OPTIONAL)
            </label>
            <input
              type="date"
              value={genForm.end_date}
              onChange={(e) => setGenForm({ ...genForm, end_date: e.target.value })}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:border-amber-500 font-medium"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => handleGenerateFutureTrips()}
              disabled={generatingFuture}
              className="w-full px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {generatingFuture ? (
                <>
                  <RefreshCw size={14} className="animate-spin text-slate-950" />
                  Generating Future Trips...
                </>
              ) : (
                <>
                  <Zap size={14} className="fill-slate-950 text-slate-950" />
                  Generate Custom Range Trips
                </>
              )}
            </button>
          </div>
        </div>
      </div>}

      {/* ── Card 3: Bulk CSV Import ── */}
      {!isOwner && <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Bulk CSV Master Schedule Upload
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Upload CSV files to batch create recurring route schedules and daily trips.
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
            CSV FILE
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[280px]">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="w-full text-xs text-slate-700 dark:text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-800 dark:file:text-slate-200 hover:file:bg-slate-200 cursor-pointer border border-slate-300 dark:border-slate-700 rounded-lg p-1 bg-slate-50 dark:bg-slate-800/60"
              />
            </div>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 transition-colors shadow-xs"
            >
              Download Template
            </button>

            <button
              type="button"
              onClick={handlePreviewCSV}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 transition-colors shadow-xs"
            >
              Preview CSV
            </button>

            <button
              type="button"
              onClick={handleUploadBulk}
              disabled={uploadingBulk || !selectedFile}
              className="px-5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50 shadow-xs"
            >
              {uploadingBulk ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>

        {/* CSV Preview Table */}
        {csvPreviewData && (
          <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Preview ({csvPreviewData.length} records in CSV)
              </span>
              <button
                onClick={() => setCsvPreviewData(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-500 font-mono text-[11px] border-b border-slate-200 dark:border-slate-700">
                    <th className="p-1.5">Schedule Code</th>
                    <th className="p-1.5">Route ID</th>
                    <th className="p-1.5">Driver ID</th>
                    <th className="p-1.5">Repeat Days</th>
                    <th className="p-1.5">Time</th>
                    <th className="p-1.5">Validity</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreviewData.map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 font-mono">
                      <td className="p-1.5 text-slate-900 dark:text-white font-bold">{row.schedule_code || '—'}</td>
                      <td className="p-1.5 text-slate-700 dark:text-slate-300">{row.route_id || '—'}</td>
                      <td className="p-1.5 text-slate-700 dark:text-slate-300">{row.driver_id || '—'}</td>
                      <td className="p-1.5 text-slate-700 dark:text-slate-300">{row.operating_days || 'Mon-Fri'}</td>
                      <td className="p-1.5 text-slate-700 dark:text-slate-300">{row.departure_time || '—'}</td>
                      <td className="p-1.5 text-slate-700 dark:text-slate-300">{row.valid_from || '—'} to {row.valid_until || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>}

      {/* ── Table Filter & Search Bar ── */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              Scheduled Trips Explorer
            </span>
            <span className="px-2.5 py-0.5 text-xs font-extrabold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 rounded-full border border-indigo-200 dark:border-indigo-800">
              {pagination.total} Total Trips
            </span>
            {filterDate && (
              <span className="px-2.5 py-0.5 text-xs font-bold bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 rounded-full border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                <Calendar size={11} /> Date: {filterDate}
              </span>
            )}
          </div>

          {/* Quick Date Pills */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleDateFilterChange('')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                !filterDate
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              All Dates
            </button>
            <button
              type="button"
              onClick={() => handleDateFilterChange(getTodayStr())}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                filterDate === getTodayStr()
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Today ({getTodayStr()})
            </button>
            <button
              type="button"
              onClick={() => handleDateFilterChange(getTomorrowStr())}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                filterDate === getTomorrowStr()
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Tomorrow ({getTomorrowStr()})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 items-center">
          {/* Custom Date Input */}
          <div className="sm:col-span-3">
            <div className="relative">
              <input
                type="date"
                value={filterDate}
                onChange={(e) => handleDateFilterChange(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:border-indigo-500"
              />
              <Calendar size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Route filter */}
          <div className="sm:col-span-3">
            <select
              value={routeFilter}
              onChange={(e) => {
                setRouteFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Routes</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.route_name}
                </option>
              ))}
            </select>
          </div>

          {/* Search input */}
          <div className="sm:col-span-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search schedule code, route, driver..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:border-indigo-500"
              />
              <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Clear button */}
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="button"
              onClick={handleClearFilters}
              className="w-full sm:w-auto px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RotateCcw size={12} /> Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* ── Scheduled Trips Table ── */}
      <Card padding={false}>
        {error ? (
          <ErrorState message={error} onRetry={fetchSchedules} />
        ) : (
          <>
            <Table
              headers={[
                'ID',
                'SCHEDULE CODE',
                'ROUTE',
                'REPEAT DAYS',
                'DRIVER & BUS',
                'TIME & VALIDITY',
                'STATUS',
                'ACTIONS',
              ]}
              loading={loading}
              empty={!loading && schedules.length === 0}
              emptyMessage="No scheduled master trips found"
            >
              {schedules.map((schedule) => (
                <Tr key={schedule.id}>
                  <Td className="font-mono text-xs text-slate-500 dark:text-slate-400 font-bold">{schedule.id}</Td>
                  <Td className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                    {schedule.schedule_code}
                  </Td>
                  <Td className="text-xs">
                    {schedule.route ? (
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {schedule.route.route_name}
                        </div>
                        <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          {schedule.route.origin_city} → {schedule.route.destination_city}
                        </div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-xs">
                    <span className="inline-block px-2.5 py-1 text-[11px] font-bold bg-indigo-100 dark:bg-indigo-950/80 text-indigo-900 dark:text-indigo-300 rounded-md border border-indigo-200 dark:border-indigo-800">
                      {formatOperatingDays(schedule.operating_days)}
                    </span>
                  </Td>
                  <Td className="text-xs">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {schedule.driver?.name || 'No Driver'}
                    </div>
                    {schedule.driver?.mobile && (
                      <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                        <Phone size={10} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
                        <span>{schedule.driver.mobile}</span>
                      </div>
                    )}
                    <div className="text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
                      {schedule.vehicle?.registration_number || 'No Vehicle'}
                    </div>
                  </Td>
                  <Td className="text-xs font-mono">
                    <div className="font-bold text-indigo-700 dark:text-indigo-400">{schedule.departure_time}</div>
                    <div className="text-slate-600 dark:text-slate-400 text-[11px] font-medium">
                      {schedule.valid_from || schedule.trip_date || 'Ongoing'}
                      {schedule.valid_until ? ` to ${schedule.valid_until}` : ''}
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={schedule.status || 'Scheduled'} />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {!isOwner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Copy this trip to another date"
                          onClick={() => {
                            setSingleCopyTarget(schedule);
                            setSingleCopyDate(getTomorrowStr());
                          }}
                        >
                          <Copy size={13} className="text-indigo-600 dark:text-indigo-400" />
                        </Button>
                      )}
                      {canRequestAssignment && <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(schedule)}>
                        <Edit2 size={13} />
                      </Button>}
                      {!isOwner && <Button variant="danger" size="sm" onClick={() => setDeleteTarget(schedule)}>
                        <Trash2 size={13} />
                      </Button>}
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

      {/* Edit Schedule Modal */}
      {editSchedule && (
        <Modal
          open={!!editSchedule}
          onClose={() => setEditSchedule(null)}
          title={isOwner ? 'Request Assignment Change' : `Edit Master Schedule: ${editSchedule.schedule_code}`}
        >
          <div className="space-y-4">
            {!isOwner && (
              <div className="p-3 bg-indigo-950/60 border border-indigo-800/80 rounded-xl text-xs text-indigo-300 space-y-1">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Zap size={14} className="text-indigo-400" /> Versioning Enabled (New Database Row & ID)
                </div>
                <div className="text-[11px] text-indigo-200/90 leading-relaxed">
                  Saving changes will create a new Master Schedule row in the database with a <strong>brand new ID</strong>, while preserving history for schedule #{editSchedule.id}.
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!isOwner && <>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">ROUTE</label>
                <select
                  value={editForm.route_id}
                  onChange={(e) => setEditForm({ ...editForm, route_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium"
                >
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.route_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">DEPARTURE TIME</label>
                <input
                  type="time"
                  value={editForm.departure_time}
                  onChange={(e) => setEditForm({ ...editForm, departure_time: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">DRIVER</label>
                <select
                  value={editForm.driver_id}
                  onChange={(e) => setEditForm({ ...editForm, driver_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium"
                >
                  <option value="">Unassigned</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">VEHICLE</label>
                <select
                  value={editForm.vehicle_id}
                  onChange={(e) => setEditForm({ ...editForm, vehicle_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium"
                >
                  <option value="">Unassigned</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.registration_number}</option>
                  ))}
                </select>
              </div>

              {!isOwner && <>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">VALID FROM</label>
                <input
                  type="date"
                  value={editForm.valid_from}
                  onChange={(e) => setEditForm({ ...editForm, valid_from: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium"
                />
              </div>
              </>}
              </>}

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">VALID UNTIL</label>
                <input
                  type="date"
                  value={editForm.valid_until}
                  onChange={(e) => setEditForm({ ...editForm, valid_until: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <Button variant="ghost" onClick={() => setEditSchedule(null)}>Cancel</Button>
              <Button variant="primary" loading={savingEdit} onClick={handleSaveEdit}>{isOwner ? 'Request Approval' : 'Save Changes'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Single Trip Copy Modal */}
      {singleCopyTarget && (
        <Modal
          open={!!singleCopyTarget}
          onClose={() => setSingleCopyTarget(null)}
          title={`Copy Trip: ${singleCopyTarget.schedule_code}`}
        >
          <div className="space-y-4">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/80 rounded-xl text-xs space-y-1">
              <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Copy size={14} className="text-indigo-600 dark:text-indigo-400" />
                {singleCopyTarget.route?.route_name || 'Trip Schedule'} ({singleCopyTarget.departure_time})
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                Current Date: <strong>{singleCopyTarget.trip_date || filterDate || 'Not specified'}</strong>
                {singleCopyTarget.driver && ` • Driver: ${singleCopyTarget.driver.name}`}
                {singleCopyTarget.vehicle && ` • Vehicle: ${singleCopyTarget.vehicle.registration_number}`}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 tracking-wider uppercase">
                TARGET DATE (TO REPLICATE) <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={singleCopyDate}
                onChange={(e) => setSingleCopyDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-slate-800 dark:text-slate-200 font-semibold select-none">
                <input
                  type="checkbox"
                  checked={singleCopyIncludeFleet}
                  onChange={(e) => setSingleCopyIncludeFleet(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0 w-4 h-4 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                />
                Keep assigned driver ({singleCopyTarget.driver?.name || 'None'}) & vehicle ({singleCopyTarget.vehicle?.registration_number || 'None'})
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setSingleCopyTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={copyingSingle}
                onClick={handleCopySingleTrip}
              >
                Replicate Trip
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Trip Schedule"
        message={`Are you sure you want to delete trip schedule "${deleteTarget?.schedule_code}"?`}
        loading={deleting}
      />
    </div>
  );
};
