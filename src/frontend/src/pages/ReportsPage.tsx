import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { dashboardAPI, settlementsAPI } from '../services/api';
import { Card, Table, Tr, Td, Button, ErrorState, LoadingState, Select, Badge, StatusBadge, Modal, Input } from '../components/ui';
import {
  BarChart3,
  TrendingUp,
  Users,
  Calendar,
  DollarSign,
  Bus,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  RefreshCw,
  UserCheck,
  UserX,
  AlertTriangle,
  Layers,
  ChevronRight,
  ShieldCheck,
  RotateCcw,
  Car,
  Briefcase,
  Check,
  ArrowRight,
  Sparkles,
  Banknote,
  FileCheck,
  ArrowUpRight,
  FileText,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasRole } from '../utils/roles';

interface ReportsPageProps {
  onNotify: (msg: string, type?: any) => void;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({ onNotify }) => {
  const [period, setPeriod] = useState('monthly');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [busTypeFilter, setBusTypeFilter] = useState('');
  const [tripStatusFilter, setTripStatusFilter] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [tripSearch, setTripSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [activeOwnerTab, setActiveOwnerTab] = useState<'all' | 'drivers' | 'bustypes' | 'trips'>('all');

  const [revenueData, setRevenueData] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const isAdmin = hasRole(user, 'admin');

  // Previous Week Settlement state
  const [prevWeekSummary, setPrevWeekSummary] = useState<any>(null);
  const [prevWeekLoading, setPrevWeekLoading] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [ownerNote, setOwnerNote] = useState<string>('');

  const fetchPreviousWeekSummary = useCallback(async () => {
    const isOwner = hasRole(user, 'owner');
    const targetOwner = isOwner ? user?.id : (ownerFilter ? Number(ownerFilter) : null);
    if (!targetOwner) {
      setPrevWeekSummary(null);
      return;
    }
    try {
      setPrevWeekLoading(true);
      const resp = await settlementsAPI.getPreviousWeekSummary({ owner_id: targetOwner });
      const data = resp.data.data;
      setPrevWeekSummary(data);
      if (data?.default_vehicle) {
        setSelectedVehicleId((prev) => prev || String(data.default_vehicle.id));
      }
    } catch {
      setPrevWeekSummary(null);
    } finally {
      setPrevWeekLoading(false);
    }
  }, [ownerFilter, user]);

  useEffect(() => {
    fetchPreviousWeekSummary();
  }, [fetchPreviousWeekSummary]);

  const handleSubmitWeeklySettlement = async () => {
    if (!prevWeekSummary || !prevWeekSummary.can_request) return;
    if (!prevWeekSummary.kyc || !prevWeekSummary.kyc.account_number) {
      onNotify('Please complete your Owner KYC and bank details first before submitting a settlement request.', 'error');
      return;
    }
    const chosenVehicle = (prevWeekSummary.vehicles || []).find((v: any) => String(v.id) === selectedVehicleId) || prevWeekSummary.default_vehicle;
    if (!chosenVehicle) {
      onNotify('Please select a vehicle for this settlement request.', 'error');
      return;
    }
    try {
      setRequestSubmitting(true);
      await settlementsAPI.create({
        vehicle_id: chosenVehicle.id,
        vehicle_number: chosenVehicle.vehicle_number || chosenVehicle.registration_number,
        requested_amount: prevWeekSummary.total_earned_amount,
        account_number: prevWeekSummary.kyc.account_number,
        bank_name: prevWeekSummary.kyc.bank_name,
        ifsc_code: prevWeekSummary.kyc.ifsc_code,
        account_holder_name: prevWeekSummary.kyc.account_holder_name,
        upi_id: prevWeekSummary.kyc.upi_id,
        owner_notes: ownerNote.trim() || `Settlement request for previous week: ${prevWeekSummary.period.formatted} (${prevWeekSummary.period.tag}) - ${prevWeekSummary.total_completed_trips} trips`,
      });
      onNotify('Settlement request submitted successfully for previous week! Admin can now review and approve it.', 'success');
      setRequestModalOpen(false);
      fetchPreviousWeekSummary();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to submit settlement request', 'error');
    } finally {
      setRequestSubmitting(false);
    }
  };

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params: Record<string, string> = { period };
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      if (isAdmin && ownerFilter) params.owner_id = ownerFilter;
      if (busTypeFilter) params.bus_type_id = busTypeFilter;
      if (tripStatusFilter) params.trip_status = tripStatusFilter;
      if (routeFilter) params.route_id = routeFilter;

      const statsParams: Record<string, string> = {};
      if (fromDate) statsParams.from_date = fromDate;
      if (toDate) statsParams.to_date = toDate;
      if (isAdmin && ownerFilter) statsParams.owner_id = ownerFilter;

      const [revRes, statsRes] = await Promise.all([
        dashboardAPI.revenueReport(params),
        dashboardAPI.stats(Object.keys(statsParams).length ? statsParams : undefined),
      ]);
      setRevenueData(revRes.data.data || revRes.data);
      setStats(statsRes.data.data || statsRes.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load report analytics');
    } finally {
      setLoading(false);
    }
  }, [period, fromDate, toDate, ownerFilter, busTypeFilter, tripStatusFilter, routeFilter, isAdmin]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleResetFilters = () => {
    setPeriod('monthly');
    setFromDate('');
    setToDate('');
    setOwnerFilter('');
    setBusTypeFilter('');
    setTripStatusFilter('');
    setRouteFilter('');
    setTripSearch('');
    setDriverSearch('');
  };

  const hasActiveFilters = Boolean(
    fromDate || toDate || ownerFilter || busTypeFilter || tripStatusFilter || routeFilter || period !== 'monthly'
  );

  if (loading && !revenueData) return <LoadingState message="Loading revenue report..." />;

  const reportRows = revenueData?.report || [];
  const ownerRows = revenueData?.owner_breakdown || [];
  const routeRows = revenueData?.route_breakdown || [];
  const tripRows = revenueData?.trip_breakdown || [];
  const bookingRevenueRows = revenueData?.booking_revenue_breakdown || [];
  const bookingRevenueTotals = revenueData?.booking_revenue_totals || { bookings: 0, seats: 0, gross_revenue: 0, net_revenue: 0 };
  const ownerOptions = revenueData?.owner_options || [];
  const busTypeOptions = revenueData?.bus_type_options || [];
  const routeOptions = revenueData?.route_options || [];
  const statusOptions = revenueData?.status_options || [
    { value: 'Scheduled', label: 'Scheduled' },
    { value: 'Active', label: 'Active' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Cancelled', label: 'Cancelled' },
  ];
  const ownerNameById = new Map(ownerOptions.map((owner: any) => [String(owner.owner_id), owner.owner_name]));

  const selectedOwnerAnalytics = revenueData?.selected_owner_analytics || null;
  const isOwnerScope = Boolean(selectedOwnerAnalytics);

  // Filtered drivers for search
  const filteredDrivers = (selectedOwnerAnalytics?.driver_summary?.drivers || []).filter((d: any) => {
    if (!driverSearch) return true;
    const term = driverSearch.toLowerCase();
    return (
      (d.name && d.name.toLowerCase().includes(term)) ||
      (d.mobile && d.mobile.includes(term)) ||
      (d.assigned_vehicle?.registration_number && d.assigned_vehicle.registration_number.toLowerCase().includes(term)) ||
      (d.assigned_vehicle?.company_model && d.assigned_vehicle.company_model.toLowerCase().includes(term))
    );
  });

  // Filtered trips for search
  const filteredTrips = tripRows.filter((trip: any) => {
    if (!tripSearch) return true;
    const term = tripSearch.toLowerCase();
    return (
      (trip.schedule_code && trip.schedule_code.toLowerCase().includes(term)) ||
      (trip.route_name && trip.route_name.toLowerCase().includes(term)) ||
      (trip.vehicle?.registration_number && trip.vehicle.registration_number.toLowerCase().includes(term)) ||
      (trip.driver?.name && trip.driver.name.toLowerCase().includes(term)) ||
      (trip.bus_type_name && trip.bus_type_name.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header & Main Filters */}
      <div className="flex flex-col gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Reports & Analytics</h2>
              {isOwnerScope && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {selectedOwnerAnalytics.owner_name}
                </span>
              )}
            </div>
            <p className="text-slate-400 text-sm mt-0.5">
              {isAdmin
                ? 'Comprehensive operational analytics: filter by owner, bus type, status, and route.'
                : 'Owner revenue counts distinct seats from confirmed, paid, boarded bookings; coupons do not reduce it.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleResetFilters} className="text-slate-400 hover:text-white" icon={RotateCcw}>
                Reset Filters
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={fetchReports} icon={RefreshCw}>
              Refresh
            </Button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-slate-800/80">
          {/* Period Preset */}
          <div>
            <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Time Horizon</label>
            <Select
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'daily', label: 'Last 7 days' },
                { value: 'weekly', label: 'Last 4 weeks' },
                { value: 'monthly', label: 'Last 6 months' },
              ]}
              className="w-full"
            />
          </div>

          {/* Date From */}
          <div>
            <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">From Date</label>
            <div className="relative">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Date To */}
          <div>
            <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">To Date</label>
            <div className="relative">
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Owner Filter (Admin only) */}
          {isAdmin && (
            <div>
              <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Bus Operator / Owner</label>
              <Select
                value={ownerFilter}
                onChange={setOwnerFilter}
                placeholder="All Owners"
                options={[
                  { value: '', label: 'All Owners' },
                  ...ownerOptions.map((o: any) => ({ value: String(o.owner_id), label: o.owner_name })),
                ]}
                className="w-full"
              />
            </div>
          )}

          {/* Bus Type Filter */}
          <div>
            <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Bus Type</label>
            <Select
              value={busTypeFilter}
              onChange={setBusTypeFilter}
              placeholder="All Bus Types"
              options={[
                { value: '', label: 'All Bus Types' },
                ...busTypeOptions.map((bt: any) => ({ value: String(bt.value), label: bt.label })),
              ]}
              className="w-full"
            />
          </div>

          {/* Trip Status Filter */}
          <div>
            <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Trip Status</label>
            <Select
              value={tripStatusFilter}
              onChange={setTripStatusFilter}
              placeholder="All Statuses"
              options={[
                { value: '', label: 'All Statuses' },
                ...statusOptions.map((st: any) => ({ value: st.value, label: st.label })),
              ]}
              className="w-full"
            />
          </div>

          {/* Route Filter */}
          <div className={isAdmin ? 'sm:col-span-2 md:col-span-3 lg:col-span-6' : 'sm:col-span-2 md:col-span-3 lg:col-span-2'}>
            <label className="block text-[11px] font-semibold uppercase text-slate-400 mb-1">Operational Route</label>
            <Select
              value={routeFilter}
              onChange={setRouteFilter}
              placeholder="All Routes"
              options={[
                { value: '', label: 'All Routes' },
                ...routeOptions.map((r: any) => ({ value: String(r.value), label: r.label })),
              ]}
              className="w-full"
            />
          </div>
        </div>

        {/* Active Filter Badges */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-slate-400">
            <span className="font-medium flex items-center gap-1">
              <Filter size={12} className="text-indigo-400" /> Active Filters:
            </span>
            {ownerFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                Owner: {ownerNameById.get(ownerFilter) || `Owner #${ownerFilter}`}
                <button onClick={() => setOwnerFilter('')} className="hover:text-rose-400 font-bold ml-1">×</button>
              </span>
            )}
            {busTypeFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                Bus Type: {busTypeOptions.find((b: any) => b.value === busTypeFilter)?.label || busTypeFilter}
                <button onClick={() => setBusTypeFilter('')} className="hover:text-rose-400 font-bold ml-1">×</button>
              </span>
            )}
            {tripStatusFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                Status: {tripStatusFilter}
                <button onClick={() => setTripStatusFilter('')} className="hover:text-rose-400 font-bold ml-1">×</button>
              </span>
            )}
            {routeFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                Route: {routeOptions.find((r: any) => r.value === routeFilter)?.label || routeFilter}
                <button onClick={() => setRouteFilter('')} className="hover:text-rose-400 font-bold ml-1">×</button>
              </span>
            )}
            {(fromDate || toDate) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                Date: {fromDate || 'Start'} → {toDate || 'Present'}
                <button onClick={() => { setFromDate(''); setToDate(''); }} className="hover:text-rose-400 font-bold ml-1">×</button>
              </span>
            )}
          </div>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={fetchReports} />
      ) : (
        <>
          {/* Top High-level KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Revenue Card */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {isAdmin ? 'Revenue before coupons' : 'Revenue earned'}
                </span>
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                  <DollarSign size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-white tracking-tight">
                ₹{Number((isAdmin ? revenueData?.gross_revenue : revenueData?.total) || 0).toLocaleString('en-IN')}
              </div>
              <div className="text-xs text-emerald-400 flex items-center gap-1.5 mt-2">
                {isAdmin ? (
                  `After coupons: ₹${Number(revenueData?.net_revenue || 0).toLocaleString('en-IN')}`
                ) : (
                  <>
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>{Number(revenueData?.distinct_seats || 0).toLocaleString('en-IN')} distinct booked seats</span>
                  </>
                )}
              </div>
            </div>

            {/* Total Trips Card */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Total Operational Trips</span>
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                  <Bus size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-white tracking-tight">
                {isOwnerScope
                  ? selectedOwnerAnalytics?.trip_summary?.total_trips || tripRows.length
                  : stats?.summary?.trips?.total || tripRows.length}
              </div>
              <div className="text-xs text-slate-400 mt-2 flex items-center gap-2">
                {isOwnerScope ? (
                  <>
                    <span className="text-emerald-400 font-medium">{selectedOwnerAnalytics?.trip_summary?.completed_trips || 0} done</span>
                    <span>·</span>
                    <span className="text-sky-400 font-medium">{selectedOwnerAnalytics?.trip_summary?.scheduled_trips || 0} scheduled</span>
                  </>
                ) : (
                  <span>Scheduled, Active & Completed</span>
                )}
              </div>
            </div>

            {/* Drivers & Vehicle Assignment Card */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Driver Assignment</span>
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                  <UserCheck size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-white tracking-tight flex items-baseline gap-2">
                <span>
                  {isOwnerScope
                    ? selectedOwnerAnalytics?.driver_summary?.assigned_drivers_count || 0
                    : stats?.summary?.drivers?.active || 0}
                </span>
                <span className="text-sm font-normal text-slate-400">
                  / {isOwnerScope ? selectedOwnerAnalytics?.driver_summary?.total_drivers || 0 : stats?.summary?.drivers?.total || 0} Drivers
                </span>
              </div>
              <div className="text-xs text-indigo-300 mt-2 flex items-center gap-1.5">
                {isOwnerScope ? (
                  <>
                    <span className="font-semibold">{selectedOwnerAnalytics?.driver_summary?.assignment_rate_percentage || 0}%</span>
                    <span>fleet assignment rate</span>
                  </>
                ) : (
                  <span>Assigned active driver roster</span>
                )}
              </div>
            </div>

            {/* Fleet & Bus Types Card */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Fleet & Bus Types</span>
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
                  <Layers size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-white tracking-tight flex items-baseline gap-2">
                <span>
                  {isOwnerScope
                    ? selectedOwnerAnalytics?.vehicle_summary?.total_vehicles || 0
                    : stats?.summary?.vehicles?.total || 0}
                </span>
                <span className="text-sm font-normal text-slate-400">Vehicles</span>
              </div>
              <div className="text-xs text-amber-300 mt-2 flex items-center gap-1.5">
                {isOwnerScope ? (
                  <span>Across {selectedOwnerAnalytics?.bus_type_summary?.total_bus_types || 0} Bus Types</span>
                ) : (
                  <span>Registered operational vehicles</span>
                )}
              </div>
            </div>
          </div>

          {/* OWNER DEEP DIVE SECTION (Shown when Owner is selected or for logged in Owner) */}
          {isOwnerScope && selectedOwnerAnalytics && (
            <div className="space-y-6">
              {/* Owner Overview Card with Quick Tabs */}
              <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                        <Bus size={24} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white tracking-tight">
                          {selectedOwnerAnalytics.owner_name}
                        </h3>
                        <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                          <span>Owner ID: #{selectedOwnerAnalytics.owner_id}</span>
                          <span>·</span>
                          <span className="text-emerald-400">
                            {selectedOwnerAnalytics.vehicle_summary?.active_vehicles || 0} Active Buses
                          </span>
                          <span>·</span>
                          <span className="text-cyan-400">
                            {selectedOwnerAnalytics.driver_summary?.assigned_drivers_count || 0} Assigned Drivers
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Navigation Tabs for Owner Detail */}
                  <div className="flex flex-wrap gap-1.5 bg-slate-950/60 p-1.5 rounded-xl border border-slate-800 self-start md:self-auto">
                    <button
                      onClick={() => setActiveOwnerTab('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        activeOwnerTab === 'all'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      All Breakdowns
                    </button>
                    <button
                      onClick={() => setActiveOwnerTab('drivers')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        activeOwnerTab === 'drivers'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      <UserCheck size={13} />
                      Drivers ({selectedOwnerAnalytics.driver_summary?.total_drivers || 0})
                    </button>
                    <button
                      onClick={() => setActiveOwnerTab('bustypes')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        activeOwnerTab === 'bustypes'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      <Layers size={13} />
                      Bus Types ({selectedOwnerAnalytics.bus_type_summary?.total_bus_types || 0})
                    </button>
                    <button
                      onClick={() => setActiveOwnerTab('trips')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        activeOwnerTab === 'trips'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                      }`}
                    >
                      <Clock size={13} />
                      Trips ({selectedOwnerAnalytics.trip_summary?.total_trips || tripRows.length})
                    </button>
                  </div>
                </div>

                {/* KPI Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 pt-5">
                  <div>
                    <span className="text-[11px] font-semibold uppercase text-slate-400 block">Total Drivers</span>
                    <div className="text-xl font-bold text-white mt-0.5">
                      {selectedOwnerAnalytics.driver_summary?.total_drivers || 0}
                    </div>
                    <span className="text-[11px] text-emerald-400">
                      {selectedOwnerAnalytics.driver_summary?.assigned_drivers_count || 0} assigned
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold uppercase text-slate-400 block">Unassigned Drivers</span>
                    <div className="text-xl font-bold text-amber-300 mt-0.5">
                      {selectedOwnerAnalytics.driver_summary?.unassigned_drivers_count || 0}
                    </div>
                    <span className="text-[11px] text-slate-400">Available for assignment</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold uppercase text-slate-400 block">Fleet Capacity</span>
                    <div className="text-xl font-bold text-white mt-0.5">
                      {selectedOwnerAnalytics.vehicle_summary?.total_vehicles || 0} Buses
                    </div>
                    <span className="text-[11px] text-indigo-400">
                      {selectedOwnerAnalytics.vehicle_summary?.vehicles_with_driver || 0} with driver
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold uppercase text-slate-400 block">Total Trips Run</span>
                    <div className="text-xl font-bold text-white mt-0.5">
                      {selectedOwnerAnalytics.trip_summary?.total_trips || tripRows.length}
                    </div>
                    <span className="text-[11px] text-cyan-400">
                      {selectedOwnerAnalytics.trip_summary?.completed_trips || 0} completed
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold uppercase text-slate-400 block">Scheduled Trips</span>
                    <div className="text-xl font-bold text-sky-400 mt-0.5">
                      {selectedOwnerAnalytics.trip_summary?.scheduled_trips || 0}
                    </div>
                    <span className="text-[11px] text-slate-400">Upcoming departures</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold uppercase text-slate-400 block">Distinct Seats Booked</span>
                    <div className="text-xl font-bold text-emerald-400 mt-0.5">
                      {Number(selectedOwnerAnalytics.trip_summary?.total_distinct_seats || 0).toLocaleString('en-IN')}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {selectedOwnerAnalytics.trip_summary?.total_bookings || 0} total bookings
                    </span>
                  </div>
                </div>
              </div>

              {/* PREVIOUS WEEK SETTLEMENT REQUEST CARD */}
              {prevWeekSummary && (
                <div className="rounded-2xl border border-indigo-500/40 bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-900 p-6 shadow-xl relative overflow-hidden">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                          <Banknote size={22} />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-bold text-white tracking-tight">
                              Previous Week Trip Payout & Settlement
                            </h4>
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              {prevWeekSummary.period?.formatted}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Settlement payout requests can only be submitted for completed trips in the previous calendar week.
                          </p>
                        </div>
                      </div>

                      {/* Breakdown Pills */}
                      <div className="flex flex-wrap items-center gap-2.5 pt-1">
                        <div className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
                          <span className="text-slate-400">Completed Trips: </span>
                          <span className="font-bold text-white">{prevWeekSummary.total_completed_trips || 0}</span>
                        </div>

                        {(prevWeekSummary.bus_type_breakdown || []).map((bt: any, i: number) => (
                          <div key={i} className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs flex items-center gap-1.5">
                            <span className="text-slate-400">{bt.label}:</span>
                            <span className="font-semibold text-white">{bt.count} trips</span>
                            <span className="text-indigo-400">(@ ₹{Number(bt.rate_per_trip || 0).toLocaleString('en-IN')})</span>
                            <span className="font-bold text-emerald-400">= ₹{Number(bt.total_amount || 0).toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right Amount & Action Box */}
                    <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between gap-4 p-4 rounded-xl bg-slate-950/70 border border-slate-800 shrink-0">
                      <div className="text-left sm:text-right">
                        <div className="text-[11px] font-semibold uppercase text-slate-400 tracking-wider">
                          Net Receivable (After {prevWeekSummary.tds_percentage}% TDS)
                        </div>
                        <div className="text-2xl font-black text-emerald-400 tracking-tight mt-0.5">
                          ₹{Number(prevWeekSummary.net_payable_amount || 0).toLocaleString('en-IN')}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Gross: ₹{Number(prevWeekSummary.total_earned_amount || 0).toLocaleString('en-IN')} · TDS: -₹{Number(prevWeekSummary.tds_amount || 0).toLocaleString('en-IN')}
                        </div>
                      </div>

                      {/* Action status */}
                      {prevWeekSummary.existing_settlement ? (
                        <div className="flex items-center gap-2.5">
                          <StatusBadge status={prevWeekSummary.existing_settlement.status} />
                          <a
                            href="/bus-operator-dev/owner-settlements"
                            onClick={(e) => {
                              e.preventDefault();
                              window.history.pushState({}, '', '/bus-operator-dev/owner-settlements');
                              window.dispatchEvent(new PopStateEvent('popstate'));
                            }}
                            className="px-3 py-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                          >
                            View in Settlements ({prevWeekSummary.existing_settlement.settlement_code}) <ArrowUpRight size={13} />
                          </a>
                        </div>
                      ) : prevWeekSummary.can_request ? (
                        <Button
                          variant="primary"
                          size="md"
                          icon={Banknote}
                          onClick={() => setRequestModalOpen(true)}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-950/50"
                        >
                          Request Previous Week Settlement
                        </Button>
                      ) : (
                        <div className="text-xs text-amber-300 flex items-center gap-1.5 font-medium">
                          <Clock size={14} />
                          <span>No completed trips found for previous week</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION: DRIVER ASSIGNMENT BREAKDOWN */}
              {(activeOwnerTab === 'all' || activeOwnerTab === 'drivers') && (
                <Card>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-5 h-5 text-indigo-400" />
                        <h3 className="text-base font-bold text-white">Driver Assignment & Operational Status</h3>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Shows assigned vs unassigned drivers, their designated vehicle, trips completed, and revenue earned.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={driverSearch}
                          onChange={(e) => setDriverSearch(e.target.value)}
                          placeholder="Search drivers or vehicle reg..."
                          className="pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-56"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Driver Assignment Progress Indicator */}
                  <div className="mb-4 p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-slate-400 font-medium">Driver Assignment Rate</span>
                      <span className="text-white font-bold">
                        {selectedOwnerAnalytics.driver_summary?.assigned_drivers_count || 0} of {selectedOwnerAnalytics.driver_summary?.total_drivers || 0} drivers assigned ({selectedOwnerAnalytics.driver_summary?.assignment_rate_percentage || 0}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden flex">
                      <div
                        className="bg-emerald-500 transition-all duration-500"
                        style={{ width: `${selectedOwnerAnalytics.driver_summary?.assignment_rate_percentage || 0}%` }}
                        title="Assigned Drivers"
                      />
                      <div
                        className="bg-amber-500/80 transition-all duration-500"
                        style={{ width: `${100 - (selectedOwnerAnalytics.driver_summary?.assignment_rate_percentage || 0)}%` }}
                        title="Unassigned Drivers"
                      />
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" /> Assigned ({selectedOwnerAnalytics.driver_summary?.assigned_drivers_count || 0})
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500" /> Unassigned / Standby ({selectedOwnerAnalytics.driver_summary?.unassigned_drivers_count || 0})
                      </span>
                    </div>
                  </div>

                  <Table
                    headers={[
                      'Driver Name',
                      'Contact & Status',
                      'Assignment Status',
                      'Assigned Bus / Vehicle',
                      'Total Trips',
                      'Completed Trips',
                      'Seats Booked',
                      isAdmin ? 'Revenue Generated' : 'Revenue Earned',
                    ]}
                    loading={loading}
                    empty={filteredDrivers.length === 0}
                    emptyMessage="No drivers registered under this operator"
                  >
                    {filteredDrivers.map((driver: any) => (
                      <Tr key={driver.id}>
                        <Td>
                          <div className="font-semibold text-white flex items-center gap-2">
                            <span>{driver.name}</span>
                            {driver.online_status === 'Online' && (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                Live
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400">ID #{driver.id}</div>
                        </Td>
                        <Td>
                          <div className="text-sm text-slate-300">{driver.mobile || '—'}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            <StatusBadge status={driver.status || 'Active'} />
                          </div>
                        </Td>
                        <Td>
                          {driver.is_assigned ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <UserCheck size={12} /> Assigned
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              <UserX size={12} /> Unassigned
                            </span>
                          )}
                        </Td>
                        <Td>
                          {driver.assigned_vehicle ? (
                            <div>
                              <div className="font-medium text-white flex items-center gap-1.5">
                                <Car size={13} className="text-indigo-400" />
                                {driver.assigned_vehicle.registration_number}
                              </div>
                              <div className="text-xs text-slate-400">
                                {driver.assigned_vehicle.company_model || driver.assigned_vehicle.bus_type_name} · {driver.assigned_vehicle.total_seats} seats
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 italic">No bus assigned</span>
                          )}
                        </Td>
                        <Td className="font-semibold text-white">{driver.total_trips || 0}</Td>
                        <Td>
                          <span className="text-emerald-400 font-semibold">{driver.completed_trips || 0}</span>
                          {driver.scheduled_trips > 0 && (
                            <span className="text-xs text-slate-400 ml-1">({driver.scheduled_trips} sched)</span>
                          )}
                        </Td>
                        <Td>{driver.distinct_seats || 0}</Td>
                        <Td className="font-semibold text-emerald-300">
                          ₹{Number((isAdmin ? driver.gross_revenue : driver.net_revenue) || 0).toLocaleString('en-IN')}
                        </Td>
                      </Tr>
                    ))}
                  </Table>
                </Card>
              )}

              {/* SECTION: BUS TYPE WISE BREAKDOWN */}
              {(activeOwnerTab === 'all' || activeOwnerTab === 'bustypes') && (
                <Card>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Layers className="w-5 h-5 text-indigo-400" />
                        <h3 className="text-base font-bold text-white">Bus Type Wise Breakdown</h3>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Operational distribution, seat configurations, trip frequencies, and revenue per bus model.
                      </p>
                    </div>
                  </div>

                  <Table
                    headers={[
                      'Bus Type',
                      'Configuration',
                      'Vehicles in Fleet',
                      'Trips Run',
                      'Trip Status Details',
                      'Distinct Seats Booked',
                      'Total Bookings',
                      isAdmin ? 'Gross Revenue' : 'Revenue Earned',
                      ...(isAdmin ? ['Net Revenue (After Coupons)'] : []),
                    ]}
                    loading={loading}
                    empty={(selectedOwnerAnalytics.bus_type_summary?.bus_types || []).length === 0}
                    emptyMessage="No bus type data found for this operator"
                  >
                    {(selectedOwnerAnalytics.bus_type_summary?.bus_types || []).map((bt: any, idx: number) => (
                      <Tr key={bt.bus_type_id || idx}>
                        <Td>
                          <div className="font-semibold text-white">{bt.name}</div>
                          {bt.code && <div className="text-xs text-slate-400">Code: {bt.code}</div>}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                              {bt.seat_type || 'seater'}
                            </span>
                            {bt.has_ac ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                                AC
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                                Non-AC
                              </span>
                            )}
                            {bt.total_seats > 0 && (
                              <span className="text-xs text-slate-400">{bt.total_seats} seats</span>
                            )}
                          </div>
                        </Td>
                        <Td className="font-bold text-white">
                          <span className="px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold text-xs">
                            {bt.vehicles_count || 0} {bt.vehicles_count === 1 ? 'Bus' : 'Buses'}
                          </span>
                        </Td>
                        <Td className="font-semibold text-white">{bt.trips_count || 0}</Td>
                        <Td>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-emerald-400 font-medium">{bt.completed_trips || 0} done</span>
                            <span>·</span>
                            <span className="text-sky-400 font-medium">{bt.scheduled_trips || 0} sched</span>
                            {bt.active_trips > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-amber-400 font-medium">{bt.active_trips} active</span>
                              </>
                            )}
                          </div>
                        </Td>
                        <Td>{bt.distinct_seats || 0}</Td>
                        <Td>{bt.bookings_count || 0}</Td>
                        <Td className="font-semibold text-emerald-300">
                          ₹{Number((isAdmin ? bt.gross_revenue : bt.net_revenue) || 0).toLocaleString('en-IN')}
                        </Td>
                        {isAdmin && (
                          <Td className="font-semibold text-emerald-400">
                            ₹{Number(bt.net_revenue || 0).toLocaleString('en-IN')}
                          </Td>
                        )}
                      </Tr>
                    ))}
                  </Table>
                </Card>
              )}

              {/* SECTION: ALL TRIPS BY OWNER */}
              {(activeOwnerTab === 'all' || activeOwnerTab === 'trips') && (
                <Card>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-indigo-400" />
                        <h3 className="text-base font-bold text-white">All Trips by {selectedOwnerAnalytics.owner_name}</h3>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Comprehensive trip-level breakdown: schedule code, route, assigned bus, driver, boarding status, and earnings.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={tripSearch}
                          onChange={(e) => setTripSearch(e.target.value)}
                          placeholder="Search schedule, route, driver..."
                          className="pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-60"
                        />
                      </div>
                    </div>
                  </div>

                  <Table
                    headers={[
                      'Trip / Schedule Code',
                      'Route',
                      'Vehicle & Bus Type',
                      'Driver Assigned',
                      'Status',
                      'Seats',
                      'Bookings',
                      'Trip Rate',
                      'Earned Payout',
                      ...(isAdmin ? ['Ticket Revenue'] : []),
                    ]}
                    loading={loading}
                    empty={filteredTrips.length === 0}
                    emptyMessage="No trips found matching the selected criteria"
                  >
                    {filteredTrips.map((trip: any) => (
                      <Tr key={`${trip.trip_id}-${trip.travel_date}`}>
                        <Td>
                          <div className="font-semibold text-white">{trip.schedule_code || `Trip #${trip.trip_id}`}</div>
                          <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <Calendar size={12} />
                            <span>{trip.travel_date || trip.trip_date || 'Date not set'}</span>
                            <span>·</span>
                            <span>{String(trip.departure_time || '').slice(0, 5) || '—'}</span>
                          </div>
                        </Td>
                        <Td>
                          <div className="font-medium text-white">{trip.route_name}</div>
                          <div className="text-xs text-slate-400">
                            {trip.origin_city && trip.destination_city ? `${trip.origin_city} → ${trip.destination_city}` : trip.route_code || '—'}
                          </div>
                        </Td>
                        <Td>
                          <div className="font-medium text-white flex items-center gap-1.5">
                            <Car size={13} className="text-indigo-400" />
                            {trip.vehicle?.registration_number || 'Not assigned'}
                          </div>
                          <div className="text-xs text-slate-400">
                            {trip.bus_type_name || trip.vehicle?.model || 'Standard Bus'}
                          </div>
                        </Td>
                        <Td>
                          <div className="font-medium text-white flex items-center gap-1.5">
                            <UserCheck size={13} className={trip.driver ? 'text-emerald-400' : 'text-slate-500'} />
                            {trip.driver?.name || <span className="text-slate-500 italic">Unassigned</span>}
                          </div>
                          {trip.driver?.mobile && (
                            <div className="text-xs text-slate-400">{trip.driver.mobile}</div>
                          )}
                        </Td>
                        <Td>
                          <StatusBadge status={trip.status || 'Scheduled'} />
                        </Td>
                        <Td className="font-medium text-white">{trip.distinct_seats || 0}</Td>
                        <Td>{trip.booking_count || 0}</Td>
                        <Td>
                          <div className="font-semibold text-white">
                            ₹{Number(trip.trip_rate || (trip.bus_type_name?.toLowerCase().includes('traveller') ? 1900 : 3000)).toLocaleString('en-IN')}
                          </div>
                          <div className="text-[10px] text-slate-400">per trip</div>
                        </Td>
                        <Td>
                          {trip.status === 'Completed' ? (
                            <div>
                              <span className="font-bold text-emerald-400">
                                ₹{Number(trip.earned_amount || trip.trip_rate || 3000).toLocaleString('en-IN')}
                              </span>
                              <div className="text-[10px] text-emerald-400/80 font-medium">Completed</div>
                            </div>
                          ) : (
                            <div>
                              <span className="text-slate-500 font-medium">—</span>
                              <div className="text-[10px] text-slate-500 italic">Not completed</div>
                            </div>
                          )}
                        </Td>
                        {isAdmin && (
                          <Td className="font-semibold text-cyan-300">
                            ₹{Number(trip.net_revenue || 0).toLocaleString('en-IN')}
                          </Td>
                        )}
                      </Tr>
                    ))}
                  </Table>
                </Card>
              )}
            </div>
          )}

          {/* REVENUE BREAKDOWN & TREND CHART (Always displayed) */}
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">Revenue Breakdown & Trend</h3>
                <p className="text-xs text-slate-400 mt-0.5">Periodic revenue comparison over chosen time horizon.</p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-cyan-600" />
                    Gross Revenue (Before coupons)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                    Net Revenue (After coupons)
                  </span>
                </div>
              )}
            </div>

            {reportRows.length > 0 ? (
              <div className="space-y-4">
                <div className="h-64 flex items-end gap-3 pt-6 pb-2 px-4 border-b border-slate-700/50">
                  {reportRows.map((item: any, idx: number) => {
                    const grossRevenue = Number(item.gross_revenue ?? item.revenue ?? item.total_amount ?? 0);
                    const netRevenue = Number(item.net_revenue ?? item.revenue ?? item.total_amount ?? 0);
                    const maxRev = Math.max(
                      ...reportRows.flatMap((row: any) => [
                        Number(row.gross_revenue ?? row.revenue ?? row.total_amount ?? 0),
                        Number(row.net_revenue ?? row.revenue ?? row.total_amount ?? 0),
                      ]),
                      1
                    );
                    const primaryHeight = Math.max(12, Math.round((grossRevenue / maxRev) * 100));
                    const netHeight = Math.max(12, Math.round((netRevenue / maxRev) * 100));
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                        <div className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isAdmin ? `₹${grossRevenue} / ₹${netRevenue}` : `₹${grossRevenue}`}
                        </div>
                        <div className="flex w-full items-end justify-center gap-1" style={{ height: '100%' }}>
                          <div
                            className="flex-1 bg-cyan-600 rounded-t-sm transition-all duration-300 group-hover:brightness-125"
                            style={{ height: `${primaryHeight}%` }}
                            title={`Gross: ₹${grossRevenue}`}
                          />
                          {isAdmin && (
                            <div
                              className="flex-1 bg-emerald-500 rounded-t-sm transition-all duration-300 group-hover:brightness-125"
                              style={{ height: `${netHeight}%` }}
                              title={`Net: ₹${netRevenue}`}
                            />
                          )}
                        </div>
                        <div className="text-xs text-slate-400 truncate w-full text-center">
                          {item.period || item.label || item.date || `P${idx + 1}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-500 text-sm">
                No revenue trend data available for the chosen timeframe.
              </div>
            )}
          </Card>

          {/* ALL OWNERS SUMMARY TABLE (Admin view when no specific owner is selected) */}
          {isAdmin && !ownerFilter && (
            <Card>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">Revenue & Operations by Owner</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Click any owner to drill down into their assigned drivers, bus type distribution, and full operational trip data.
                  </p>
                </div>
              </div>

              <Table
                headers={[
                  'Owner / Operator',
                  'Fleet Size',
                  'Driver Assignment',
                  'Bus Types Operated',
                  'Total Trips Run',
                  'Distinct Seats',
                  'Before Coupons',
                  'After Coupons',
                  'Action',
                ]}
                loading={loading}
                empty={ownerRows.length === 0}
                emptyMessage="No booked seats match these filters"
              >
                {ownerRows.map((owner: any) => (
                  <Tr key={owner.owner_id} onClick={() => setOwnerFilter(String(owner.owner_id))}>
                    <Td className="font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span>{owner.owner_name}</span>
                        <ChevronRight size={14} className="text-slate-500 group-hover:text-indigo-400" />
                      </div>
                      <div className="text-xs text-slate-400">ID #{owner.owner_id}</div>
                    </Td>
                    <Td>
                      <span className="font-semibold text-white">{owner.vehicles_count || 0}</span>
                      <span className="text-xs text-slate-400 ml-1">buses</span>
                    </Td>
                    <Td>
                      <div className="text-sm font-medium text-white">
                        {owner.assigned_drivers_count || 0} / {owner.total_drivers || 0} Assigned
                      </div>
                      <div className="text-xs text-emerald-400 mt-0.5">
                        {owner.total_drivers ? Math.round(((owner.assigned_drivers_count || 0) / owner.total_drivers) * 100) : 0}% rate
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {(owner.bus_types || []).slice(0, 3).map((bt: string, i: number) => (
                          <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            {bt}
                          </span>
                        ))}
                        {(owner.bus_types || []).length > 3 && (
                          <span className="text-[10px] text-slate-400">+{owner.bus_types.length - 3} more</span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <span className="font-semibold text-white">{owner.trips || 0}</span>
                      <div className="text-xs text-emerald-400">{owner.completed_trips || 0} completed</div>
                    </Td>
                    <Td>{owner.distinct_seats || 0}</Td>
                    <Td>₹{Number(owner.gross_revenue || 0).toLocaleString('en-IN')}</Td>
                    <Td className="font-semibold text-emerald-300">₹{Number(owner.net_revenue || 0).toLocaleString('en-IN')}</Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e?.stopPropagation();
                          setOwnerFilter(String(owner.owner_id));
                        }}
                      >
                        Deep Dive
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Table>
            </Card>
          )}

          {/* ROUTE REVENUE BREAKDOWN */}
          <Card>
            <div className="mb-4">
              <h3 className="text-base font-bold text-white tracking-tight">
                {isAdmin ? 'Revenue by Route' : 'My Revenue by Route'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Route-level volume, seats booked, and total fares.</p>
            </div>

            <Table
              headers={
                isAdmin
                  ? ['Owner', 'Route', 'Trips', 'Distinct Seats', 'Avg. Historical Fare', 'Before Coupons', 'After Coupons']
                  : ['Route', 'Trips', 'Distinct Seats', 'Avg. Historical Fare', 'Revenue Earned']
              }
              loading={loading}
              empty={routeRows.length === 0}
              emptyMessage="No route revenue matches these filters"
            >
              {routeRows.map((route: any) => (
                <Tr key={`${route.owner_id}-${route.route_id}`}>
                  {isAdmin && <Td>{ownerNameById.get(String(route.owner_id)) || `Owner #${route.owner_id}`}</Td>}
                  <Td className="font-medium text-white">{route.route_name}</Td>
                  <Td>{route.trips}</Td>
                  <Td>{route.distinct_seats}</Td>
                  <Td>₹{Number(route.fare_per_seat || 0).toLocaleString('en-IN')}</Td>
                  {isAdmin ? (
                    <>
                      <Td>₹{Number(route.revenue || 0).toLocaleString('en-IN')}</Td>
                      <Td className="font-semibold text-emerald-300">₹{Number(route.net_revenue || 0).toLocaleString('en-IN')}</Td>
                    </>
                  ) : (
                    <Td className="font-semibold text-emerald-300">₹{Number(route.revenue || 0).toLocaleString('en-IN')}</Td>
                  )}
                </Tr>
              ))}
            </Table>
          </Card>

          {/* GENERAL TRIP, VEHICLE & DRIVER ANALYSIS (When not drilled into single owner) */}
          {!isOwnerScope && (
            <Card>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">Trip, Vehicle & Driver Analysis</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Operational trips across all vehicles and drivers.</p>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={tripSearch}
                    onChange={(e) => setTripSearch(e.target.value)}
                    placeholder="Search trips, vehicles, routes..."
                    className="pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-60"
                  />
                </div>
              </div>

              <Table
                headers={[
                  ...(isAdmin ? ['Owner'] : []),
                  'Trip / Date',
                  'Route',
                  'Vehicle & Bus Type',
                  'Driver Assigned',
                  'Distinct Seats',
                  'Bookings',
                  'Trip Status',
                  ...(isAdmin ? ['Before Coupons', 'After Coupons'] : ['Revenue Earned']),
                ]}
                loading={loading}
                empty={filteredTrips.length === 0}
                emptyMessage="No trip, vehicle, or driver details match this period"
              >
                {filteredTrips.map((trip: any) => (
                  <Tr key={`${trip.trip_id}-${trip.travel_date}`}>
                    {isAdmin && <Td>{ownerNameById.get(String(trip.owner_id)) || `Owner #${trip.owner_id}`}</Td>}
                    <Td>
                      <div className="font-medium text-white">{trip.schedule_code || `Trip #${trip.trip_id}`}</div>
                      <div className="text-xs text-slate-400">
                        {trip.travel_date || trip.trip_date || 'Date not set'} · {String(trip.departure_time || '').slice(0, 5) || 'Time not set'}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium text-white">{trip.route_name}</div>
                      <div className="text-xs text-slate-400">
                        {trip.route_code || '—'} · {trip.origin_city || '—'} → {trip.destination_city || '—'}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium text-white">{trip.vehicle?.registration_number || 'Not assigned'}</div>
                      <div className="text-xs text-slate-400">
                        {trip.bus_type_name || trip.vehicle?.model || 'Model not set'} · {trip.vehicle?.status || '—'}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium text-white">{trip.driver?.name || 'Not assigned'}</div>
                      <div className="text-xs text-slate-400">
                        {trip.driver?.mobile || 'No phone'} · {trip.driver?.status || '—'}
                      </div>
                    </Td>
                    <Td>{trip.distinct_seats}</Td>
                    <Td>{trip.booking_count}</Td>
                    <Td>
                      <StatusBadge status={trip.status || 'Scheduled'} />
                    </Td>
                    {isAdmin ? (
                      <>
                        <Td>₹{Number(trip.gross_revenue || 0).toLocaleString('en-IN')}</Td>
                        <Td className="font-semibold text-emerald-300">
                          ₹{Number(trip.net_revenue || 0).toLocaleString('en-IN')}
                        </Td>
                      </>
                    ) : (
                      <Td className="font-semibold text-emerald-300">
                        ₹{Number(trip.revenue || 0).toLocaleString('en-IN')}
                      </Td>
                    )}
                  </Tr>
                ))}
              </Table>
            </Card>
          )}

          {/* SUPER ADMIN BOOKING REVENUE */}
          {isAdmin && (
            <Card>
              <div className="mb-4">
                <h3 className="text-base font-bold text-white tracking-tight">Super Admin Booking Revenue</h3>
                <p className="text-xs text-slate-400 mt-0.5">Granular booking-level financial summary.</p>
              </div>

              <Table
                headers={['Owner', 'Trip / Date', 'Seats Booked', 'Total Bookings', 'Before Coupons', 'After Coupons']}
                loading={loading}
                empty={bookingRevenueRows.length === 0}
                emptyMessage="No bookings match this report period"
              >
                {bookingRevenueRows.map((row: any) => (
                  <Tr key={`${row.owner_id}-${row.trip_id}-${row.travel_date}`}>
                    <Td className="font-medium text-white">
                      {row.owner_id ? ownerNameById.get(String(row.owner_id)) || `Owner #${row.owner_id}` : 'Unassigned'}
                    </Td>
                    <Td>
                      <div className="font-medium text-white">{row.schedule_code || `Trip #${row.trip_id}`}</div>
                      <div className="text-xs text-slate-400">{row.route_name} · {row.travel_date}</div>
                    </Td>
                    <Td>{row.seats.toLocaleString('en-IN')}</Td>
                    <Td>{row.bookings.toLocaleString('en-IN')}</Td>
                    <Td>₹{Number(row.gross_revenue || 0).toLocaleString('en-IN')}</Td>
                    <Td className="font-semibold text-emerald-300">₹{Number(row.net_revenue || 0).toLocaleString('en-IN')}</Td>
                  </Tr>
                ))}
                <Tr>
                  <Td className="font-bold text-white">Total</Td>
                  <Td>All matching trips</Td>
                  <Td className="font-bold text-white">{Number(bookingRevenueTotals.seats || 0).toLocaleString('en-IN')}</Td>
                  <Td className="font-bold text-white">{Number(bookingRevenueTotals.bookings || 0).toLocaleString('en-IN')}</Td>
                  <Td className="font-bold text-white">₹{Number(bookingRevenueTotals.gross_revenue || 0).toLocaleString('en-IN')}</Td>
                  <Td className="font-bold text-emerald-300">₹{Number(bookingRevenueTotals.net_revenue || 0).toLocaleString('en-IN')}</Td>
                </Tr>
              </Table>
            </Card>
          )}

          {/* REQUEST SETTLEMENT FOR PREVIOUS WEEK MODAL */}
          <Modal
            open={requestModalOpen}
            isOpen={requestModalOpen}
            onClose={() => setRequestModalOpen(false)}
            title="Request Settlement — Previous Week"
            size="lg"
          >
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-800/40">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Target Period</span>
                    <div className="text-sm font-semibold text-white mt-0.5">{prevWeekSummary?.period?.formatted}</div>
                  </div>
                  <Badge color="blue">
                    Previous Week Only
                  </Badge>
                </div>
              </div>

              {/* Breakdown summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-xs text-slate-400">Completed Trips</span>
                  <div className="text-lg font-bold text-white mt-1">{prevWeekSummary?.total_completed_trips || 0}</div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {(prevWeekSummary?.bus_type_breakdown || []).map((b: any) => `${b.count} ${b.label}`).join(' + ')}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-xs text-slate-400">Gross Earned</span>
                  <div className="text-lg font-bold text-white mt-1">
                    ₹{Number(prevWeekSummary?.total_earned_amount || 0).toLocaleString('en-IN')}
                  </div>
                  <div className="text-[11px] text-amber-400 mt-1">
                    -₹{Number(prevWeekSummary?.tds_amount || 0).toLocaleString('en-IN')} ({prevWeekSummary?.tds_percentage || 0}% TDS)
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
                  <span className="text-xs text-emerald-400">Net Payable</span>
                  <div className="text-lg font-bold text-emerald-300 mt-1">
                    ₹{Number(prevWeekSummary?.net_payable_amount || 0).toLocaleString('en-IN')}
                  </div>
                  <div className="text-[11px] text-emerald-400/80 mt-1">Direct to Bank</div>
                </div>
              </div>

              {/* Bus Type Rates breakdown */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs font-semibold text-slate-300 block mb-2">Trip Rates Breakdown</span>
                <div className="space-y-1.5">
                  {(prevWeekSummary?.bus_type_breakdown || []).map((b: any) => (
                    <div key={b.key} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-800/60">
                      <span className="text-slate-300">
                        {b.label} ({b.count} trips @ ₹{Number(b.rate_per_trip).toLocaleString('en-IN')}/trip)
                      </span>
                      <span className="font-semibold text-white">₹{Number(b.total_amount).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Vehicle Selection */}
              {(prevWeekSummary?.vehicles || []).length > 1 ? (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Claim Settlement For Vehicle</label>
                  <Select
                    value={selectedVehicleId}
                    onChange={(val: any) => setSelectedVehicleId(typeof val === 'string' ? val : val?.target?.value || '')}
                    options={(prevWeekSummary?.vehicles || []).map((v: any) => ({
                      value: String(v.id),
                      label: `${v.registration_number || v.vehicle_number} — ${v.company_model || v.model || 'Bus'}`,
                    }))}
                  />
                </div>
              ) : (
                <div className="text-xs text-slate-400 flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                  <span>Selected Vehicle:</span>
                  <span className="font-semibold text-white">
                    {prevWeekSummary?.default_vehicle?.registration_number || prevWeekSummary?.default_vehicle?.vehicle_number || 'Primary Vehicle'}
                  </span>
                </div>
              )}

              {/* KYC Banking Info */}
              {prevWeekSummary?.kyc?.account_number ? (
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Bank Account</span>
                    <span className="font-medium text-white">{prevWeekSummary.kyc.account_number}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Bank Name & IFSC</span>
                    <span className="text-slate-300">
                      {prevWeekSummary.kyc.bank_name || 'Bank'} ({prevWeekSummary.kyc.ifsc_code})
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Beneficiary Name</span>
                    <span className="text-slate-300">{prevWeekSummary.kyc.account_holder_name || 'Owner'}</span>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-xs text-rose-300 flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5 text-rose-400" />
                    <div>
                      <span className="font-semibold">KYC & Bank Details Missing</span>
                      <p className="text-slate-400 mt-0.5">
                        Please update your Bank Account and KYC details in the Owner KYC section before requesting settlements.
                      </p>
                    </div>
                  </div>
                  <a
                    href="/bus-operator-dev/owner-kyc"
                    onClick={(e) => {
                      e.preventDefault();
                      window.history.pushState({}, '', '/bus-operator-dev/owner-kyc');
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline pl-6"
                  >
                    Go to Owner KYC & Bank Details <ArrowUpRight size={13} />
                  </a>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Remarks / Notes (Optional)</label>
                <Input
                  value={ownerNote}
                  onChange={(val: any) => setOwnerNote(typeof val === 'string' ? val : val?.target?.value || '')}
                  placeholder="e.g. Previous week fuel and driver settlement request"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setRequestModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={!prevWeekSummary?.can_request || !prevWeekSummary?.kyc?.account_number || requestSubmitting}
                  onClick={handleSubmitWeeklySettlement}
                >
                  {requestSubmitting ? 'Submitting...' : 'Confirm & Request Payout'}
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
};
