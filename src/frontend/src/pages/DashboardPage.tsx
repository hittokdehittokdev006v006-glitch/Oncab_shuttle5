import React, { useEffect, useState, useMemo } from 'react';
import { 
  Users, Truck, Ticket, TrendingUp, CreditCard, RefreshCcw, UserRound, Bus,
  CheckCircle, XCircle, ArrowUpRight, Calendar, UserCheck, Clock,
  Filter, Search, ArrowRight, Activity, PieChart, BarChart3, ChevronDown, Check,
  X
} from 'lucide-react';
import { dashboardAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { StatCard, Card, LoadingState, ErrorState, StatusBadge, Button, Select } from '../components/ui';
import { hasRole } from '../utils/roles';

interface DashboardStats {
  filter?: {
    from_date: string | null;
    to_date: string | null;
    preset: string;
    date_field: string;
    boarding_status: string;
  };
  summary: {
    trips: { total: number; today: number; active: number };
    bookings: {
      total: number;
      all_time?: number;
      today: number;
      confirmed: number;
      cancelled: number;
      completed?: number;
    };
    boarding?: {
      boarded: number;
      not_boarded: number;
      no_show: number;
      total_eligible: number;
      boarding_rate: number;
    };
    drivers: { total: number; active: number };
    vehicles: { total: number; active: number };
    passengers: { total: number };
    revenue?: { total: number; all_time?: number; today: number; distinctSeats?: number };
    refunds?: { pending: number; pendingAmount: number; completedAmount: number };
  };
  charts?: {
    revenue?: any[];
    paymentMethods?: any[];
    bookingsByStatus?: any[];
    boardingStatus?: Array<{ status: string; label: string; count: number; color: string }>;
    timelineTrend?: Array<{ date: string; label: string; bookings: number; boarded: number; cancelled: number; revenue: number }>;
    hourlyDistribution?: Array<{ hour: string; label: string; bookings: number; boarded: number }>;
    vehicleStatus?: any[];
    driverStatus?: any[];
    tripStatus?: any[];
  };
  recentBookings: any[];
  boardedUsers?: any[];
  topRoutes: any[];
}

const formatCurrency = (amount: number) => `₹${(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_30_days', label: 'Last 30 Days' },
  { id: 'all_time', label: 'All Time' },
  { id: 'custom', label: 'Custom Range' },
];

export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  
  // Date and filter states
  const [preset, setPreset] = useState('all_time');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateField, setDateField] = useState<'travel_date' | 'created_at'>('travel_date');
  const [boardingStatusFilter, setBoardingStatusFilter] = useState('all');
  const [showCustomRange, setShowCustomRange] = useState(false);
  
  // Tab for passenger details
  const [activeTableTab, setActiveTableTab] = useState<'boarded' | 'recent'>('boarded');
  const [passengerSearch, setPassengerSearch] = useState('');
  const [passengerStatusTab, setPassengerStatusTab] = useState('all');

  const { user } = useAuth();
  const isOwner = hasRole(user, 'owner');
  const isAdmin = hasRole(user, 'admin');

  const fetchStats = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      const params: Record<string, string> = {
        preset,
        date_field: dateField,
      };

      if (preset === 'custom' || (fromDate && toDate)) {
        if (fromDate) params.from_date = fromDate;
        if (toDate) params.to_date = toDate;
      }
      if (boardingStatusFilter && boardingStatusFilter !== 'all') {
        params.boarding_status = boardingStatusFilter;
      }

      const resp = await dashboardAPI.stats(params);
      setStats(resp.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [preset, dateField, boardingStatusFilter]);

  const handleApplyCustomDate = () => {
    if (!fromDate || !toDate) return;
    setPreset('custom');
    fetchStats(true);
  };

  const handleResetFilters = () => {
    setPreset('all_time');
    setFromDate('');
    setToDate('');
    setDateField('travel_date');
    setBoardingStatusFilter('all');
    setShowCustomRange(false);
  };

  // Filtered boarded users for search and sub-tab
  const filteredBoardedUsers = useMemo(() => {
    if (!stats?.boardedUsers) return [];
    return stats.boardedUsers.filter((b: any) => {
      // Sub-tab filter
      if (passengerStatusTab !== 'all' && b.boarding_status !== passengerStatusTab) {
        return false;
      }
      // Text search
      if (!passengerSearch.trim()) return true;
      const q = passengerSearch.toLowerCase();
      const name = (b.passenger_name || '').toLowerCase();
      const mobile = (b.passenger_mobile || '').toLowerCase();
      const ref = (b.booking_reference || '').toLowerCase();
      const pass = (b.boarding_pass_code || '').toLowerCase();
      const route = (b.trip?.route?.route_name || '').toLowerCase();
      const pickup = (b.origin_stop?.stop_name || '').toLowerCase();
      const drop = (b.destination_stop?.stop_name || '').toLowerCase();
      return (
        name.includes(q) ||
        mobile.includes(q) ||
        ref.includes(q) ||
        pass.includes(q) ||
        route.includes(q) ||
        pickup.includes(q) ||
        drop.includes(q)
      );
    });
  }, [stats?.boardedUsers, passengerSearch, passengerStatusTab]);

  if (loading && !stats) return <LoadingState message="Loading dashboard & analytics..." />;
  if (error && !stats) return <ErrorState message={error} onRetry={() => fetchStats()} />;
  if (!stats) return null;

  const { summary, charts = {}, recentBookings = [], topRoutes = [] } = stats;
  const boardingStats = summary.boarding || {
    boarded: 0,
    not_boarded: 0,
    no_show: 0,
    total_eligible: summary.bookings.confirmed || 0,
    boarding_rate: 0,
  };

  // Helper renderer for simple status progress bars
  const renderSimpleStatusBar = (title: string, rows: any[], labelKey: string, valueKey: string, color: string) => {
    const values = rows.map((row) => Number(row[valueKey] || 0));
    const maxValue = Math.max(...values, 1);
    return (
      <Card key={title}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-800 dark:text-white font-semibold text-sm">{title}</h3>
          <span className="text-xs text-slate-400">{rows.length} categories</span>
        </div>
        <div className="space-y-3">
          {rows.length === 0 ? (
            <div className="text-sm text-slate-500 py-3 text-center">No data available</div>
          ) : rows.map((row, index) => {
            const val = Number(row[valueKey] || 0);
            const pct = Math.round((val / maxValue) * 100);
            return (
              <div key={`${title}-${index}`}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-400 font-medium capitalize">{row[labelKey] || 'Unknown'}</span>
                  <span className="text-slate-800 dark:text-slate-200 font-bold">{val}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  // Timeline SVG Area & Bar Chart
  const timelineData = charts.timelineTrend || [];
  const maxTrendBookings = Math.max(...timelineData.map((d) => Math.max(d.bookings, d.boarded)), 1);

  // Hourly Commuter Distribution Chart Data
  const hourlyData = charts.hourlyDistribution || [];
  const maxHourlyValue = Math.max(...hourlyData.map((h) => Math.max(h.bookings, h.boarded)), 1);

  // Donut chart calculations for boarding status
  const boardingDonutSegments = [
    { label: 'Boarded', count: boardingStats.boarded, color: '#10b981' },
    { label: 'Pending Boarding', count: boardingStats.not_boarded, color: '#f59e0b' },
    { label: 'No Show', count: boardingStats.no_show, color: '#8b5cf6' },
    { label: 'Cancelled', count: summary.bookings.cancelled, color: '#ef4444' },
  ];
  const totalDonutCount = boardingDonutSegments.reduce((sum, seg) => sum + seg.count, 0) || 1;

  return (
    <div className="space-y-6 pb-12">
      {/* ── Top Bar: Date Range Filter & Controls ─────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
              <Calendar size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Admin Operations Dashboard</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {stats.filter?.from_date && stats.filter?.to_date
                  ? `Filtered from ${stats.filter.from_date} to ${stats.filter.to_date} (${dateField === 'travel_date' ? 'Travel Date' : 'Booking Date'})`
                  : 'Viewing all-time metrics & live operations'}
              </p>
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => {
              const active = preset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setPreset(p.id);
                    if (p.id === 'custom') setShowCustomRange(true);
                    else setShowCustomRange(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}

            <button
              onClick={() => fetchStats(true)}
              disabled={refreshing}
              title="Refresh data"
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors ml-1"
            >
              <RefreshCcw size={15} className={refreshing ? 'animate-spin text-indigo-500' : ''} />
            </button>
          </div>
        </div>

        {/* Filter Details & Custom Date Pickers */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Field Toggle */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl">
              <span className="text-slate-400 pl-2 pr-1 font-medium">Filter By:</span>
              <button
                onClick={() => setDateField('travel_date')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  dateField === 'travel_date'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Travel Date (Journey)
              </button>
              <button
                onClick={() => setDateField('created_at')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  dateField === 'created_at'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Booking Date (Sales)
              </button>
            </div>

            {/* Boarding Status Filter */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl">
              <span className="text-slate-400 pl-2 pr-1 font-medium">Boarding Status:</span>
              {[
                { id: 'all', label: 'All' },
                { id: 'boarded', label: 'Boarded Only' },
                { id: 'not_boarded', label: 'Pending' },
                { id: 'no_show', label: 'No Show' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setBoardingStatusFilter(opt.id)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    boardingStatusFilter === opt.id
                      ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reset Filters button */}
          {(preset !== 'all_time' || boardingStatusFilter !== 'all' || dateField !== 'travel_date') && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
            >
              <X size={13} /> Reset Filters
            </button>
          )}
        </div>

        {/* Custom Date Range Picker inputs when active */}
        {(showCustomRange || preset === 'custom') && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex flex-wrap items-center gap-3 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Filter size={13} className="text-indigo-500" /> Select Date Range:
            </span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-slate-400 text-xs font-medium">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={handleApplyCustomDate}
              disabled={!fromDate || !toDate}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors shadow-xs"
            >
              Apply Filter
            </button>
          </div>
        )}
      </div>

      {/* ── Revenue / Highlight Card ────────────────────────────────────────── */}
      {isAdmin && (
        <div
          className="rounded-2xl p-6 relative overflow-hidden shadow-sm"
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.08) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
          }}
        >
          <div className="absolute -right-8 -top-8 w-44 h-44 rounded-full opacity-10" style={{ background: 'radial-gradient(#6366f1, transparent)' }} />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
                {preset === 'all_time' ? 'Total Platform Revenue' : 'Filtered Revenue (Selected Range)'}
              </p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
                {formatCurrency(summary.revenue?.total || 0)}
              </h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs sm:text-sm">
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <ArrowUpRight size={16} />
                  <span>{formatCurrency(summary.revenue?.today || 0)} today</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                  <RefreshCcw size={14} />
                  <span>{formatCurrency(summary.refunds?.pendingAmount || 0)} pending refunds</span>
                </div>
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <CreditCard size={14} />
                  <span>{formatCurrency(summary.refunds?.completedAmount || 0)} completed refunds</span>
                </div>
              </div>
            </div>

            {/* Boarding Rate Callout Badge */}
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-indigo-200/50 dark:border-indigo-900/50 rounded-2xl p-4 flex items-center gap-4 shadow-xs">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                <UserCheck size={24} />
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Passenger Boarding Rate</p>
                <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {boardingStats.boarding_rate}%
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {boardingStats.boarded} of {boardingStats.total_eligible} eligible boarded
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Grid 1: Essential Operations & Boarding ─────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Boarded Passengers */}
        <StatCard
          title="Boarded Passengers"
          value={boardingStats.boarded}
          icon={UserCheck}
          color="#10b981"
          subtitle={`${boardingStats.boarding_rate}% boarding rate`}
        />

        {/* Pending Boarding / Not Boarded */}
        <StatCard
          title="Pending Boarding"
          value={boardingStats.not_boarded}
          icon={Clock}
          color="#f59e0b"
          subtitle={`${boardingStats.no_show} no-shows recorded`}
        />

        {/* Total Bookings */}
        <StatCard
          title="Total Bookings"
          value={summary.bookings.total}
          icon={Ticket}
          color="#6366f1"
          subtitle={`${summary.bookings.today} today • ${summary.bookings.confirmed} confirmed`}
        />

        {/* Total Trips */}
        <StatCard
          title="Total Trips"
          value={summary.trips.total}
          icon={Bus}
          color="#06b6d4"
          subtitle={`${summary.trips.today} today • ${summary.trips.active} active`}
        />
      </div>

      {/* ── KPI Grid 2: Fleet & Passengers ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Unique Passengers"
          value={summary.passengers.total}
          icon={Users}
          color="#3b82f6"
          subtitle="Registered travelers"
        />
        <StatCard
          title="Active Drivers"
          value={`${summary.drivers.active}/${summary.drivers.total}`}
          icon={UserRound}
          color="#8b5cf6"
          subtitle="Approved and online"
        />
        <StatCard
          title="Active Vehicles"
          value={`${summary.vehicles.active}/${summary.vehicles.total}`}
          icon={Truck}
          color="#ec4899"
          subtitle="Fleet ready in service"
        />
        <StatCard
          title="Cancelled Bookings"
          value={summary.bookings.cancelled}
          icon={XCircle}
          color="#ef4444"
          subtitle={
            summary.bookings.total > 0
              ? `${Math.round((summary.bookings.cancelled / summary.bookings.total) * 100)}% cancel rate`
              : '0% cancel rate'
          }
        />
      </div>

      {/* ── CHARTS ROW 1: Timeline Trend & Boarding Donut ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart 1: Interactive Daily Trend (Bookings vs Boarded) */}
        <Card className="lg:col-span-2" padding={false}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-indigo-500" />
                <h3 className="text-slate-900 dark:text-white font-bold text-sm">
                  Booking & Boarding Activity Trend
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Daily comparison of tickets booked vs passengers boarded
              </p>
            </div>

            {/* Chart Legend */}
            <div className="flex items-center gap-4 text-xs mt-3 sm:mt-0">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-md bg-indigo-500" />
                <span className="text-slate-600 dark:text-slate-300 font-medium">Bookings</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-md bg-emerald-500" />
                <span className="text-slate-600 dark:text-slate-300 font-medium">Boarded</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-md bg-rose-400" />
                <span className="text-slate-600 dark:text-slate-300 font-medium">Cancelled</span>
              </div>
            </div>
          </div>

          <div className="p-5">
            {timelineData.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-sm">
                No trend data for the selected period
              </div>
            ) : (
              <div className="space-y-4">
                {/* SVG Line / Bar Visualizer */}
                <div className="h-56 w-full flex items-end gap-1.5 sm:gap-2 pt-6 pb-2 border-b border-slate-100 dark:border-slate-800">
                  {timelineData.map((d, i) => {
                    const bookingHeight = Math.max((d.bookings / maxTrendBookings) * 100, 4);
                    const boardedHeight = Math.max((d.boarded / maxTrendBookings) * 100, 2);
                    return (
                      <div
                        key={d.date}
                        className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                      >
                        {/* Hover Tooltip */}
                        <div className="absolute -top-16 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 bg-slate-900 text-white text-[11px] rounded-lg p-2 shadow-xl whitespace-nowrap border border-slate-700">
                          <p className="font-bold text-indigo-300">{d.label || d.date}</p>
                          <div className="flex items-center justify-between gap-3 text-[10px] mt-0.5">
                            <span className="text-slate-300">Bookings:</span>
                            <span className="font-semibold text-white">{d.bookings}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-[10px]">
                            <span className="text-emerald-300">Boarded:</span>
                            <span className="font-semibold text-emerald-400">{d.boarded}</span>
                          </div>
                          {d.revenue > 0 && (
                            <div className="flex items-center justify-between gap-3 text-[10px]">
                              <span className="text-amber-300">Revenue:</span>
                              <span className="font-semibold text-amber-400">₹{d.revenue}</span>
                            </div>
                          )}
                        </div>

                        {/* Visual Bar Columns */}
                        <div className="w-full flex items-end justify-center gap-0.5 sm:gap-1 h-full">
                          {/* Bookings bar */}
                          <div
                            className="w-1/2 sm:w-2.5 rounded-t-sm bg-indigo-500/80 group-hover:bg-indigo-500 transition-all"
                            style={{ height: `${bookingHeight}%` }}
                          />
                          {/* Boarded bar */}
                          <div
                            className="w-1/2 sm:w-2.5 rounded-t-sm bg-emerald-500/90 group-hover:bg-emerald-400 transition-all"
                            style={{ height: `${boardedHeight}%` }}
                          />
                        </div>

                        {/* X-axis Label */}
                        <span className="text-[10px] text-slate-400 mt-2 truncate max-w-full hidden sm:block">
                          {i % 2 === 0 ? d.label.split(' ')[0] : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Timeline Bottom Summary */}
                <div className="grid grid-cols-3 gap-2 text-center pt-2">
                  <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5">
                    <p className="text-[11px] text-slate-400 font-medium">Period Bookings</p>
                    <p className="text-base font-bold text-indigo-600 dark:text-indigo-400">
                      {timelineData.reduce((acc, cur) => acc + cur.bookings, 0)}
                    </p>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5">
                    <p className="text-[11px] text-slate-400 font-medium">Period Boarded</p>
                    <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                      {timelineData.reduce((acc, cur) => acc + cur.boarded, 0)}
                    </p>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5">
                    <p className="text-[11px] text-slate-400 font-medium">Period Revenue</p>
                    <p className="text-base font-bold text-slate-800 dark:text-slate-200">
                      ₹{timelineData.reduce((acc, cur) => acc + (cur.revenue || 0), 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Chart 2: Passenger Boarding Status Breakdown (Donut & Status list) */}
        <Card padding={false} className="flex flex-col">
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PieChart size={16} className="text-emerald-500" />
              <h3 className="text-slate-900 dark:text-white font-bold text-sm">
                Boarding Status Breakdown
              </h3>
            </div>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {boardingStats.boarding_rate}% Boarded
            </span>
          </div>

          <div className="p-5 flex-1 flex flex-col justify-between space-y-5">
            {/* Donut representation */}
            <div className="flex items-center justify-center py-2">
              <div className="relative w-36 h-36 flex items-center justify-center">
                {/* SVG Ring */}
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="transparent"
                    stroke="#1e293b"
                    strokeWidth="12"
                  />
                  {boardingDonutSegments.map((seg, i) => {
                    const pct = (seg.count / totalDonutCount) * 100;
                    const strokeDasharray = `${(pct * 251.2) / 100} 251.2`;
                    // Calculate previous offsets
                    const prevPcts = boardingDonutSegments
                      .slice(0, i)
                      .reduce((sum, s) => sum + (s.count / totalDonutCount) * 100, 0);
                    const strokeDashoffset = -((prevPcts * 251.2) / 100);
                    return (
                      <circle
                        key={seg.label}
                        cx="50"
                        cy="50"
                        r="40"
                        fill="transparent"
                        stroke={seg.color}
                        strokeWidth="12"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-500"
                      />
                    );
                  })}
                </svg>
                {/* Center text */}
                <div className="absolute flex flex-col items-center justify-center text-center">
                  <span className="text-xs text-slate-400 font-medium">Eligible</span>
                  <span className="text-lg font-extrabold text-slate-900 dark:text-white">
                    {boardingStats.total_eligible}
                  </span>
                  <span className="text-[10px] text-emerald-500 font-bold">{boardingStats.boarded} on bus</span>
                </div>
              </div>
            </div>

            {/* Status breakdown rows */}
            <div className="space-y-2.5">
              {boardingDonutSegments.map((seg) => {
                const pct = totalDonutCount > 0 ? Math.round((seg.count / totalDonutCount) * 100) : 0;
                return (
                  <div key={seg.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: seg.color }} />
                      <span className="text-slate-600 dark:text-slate-300 font-medium">{seg.label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-800 dark:text-white font-bold">{seg.count}</span>
                      <span className="text-slate-400 text-[11px] w-9 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* ── CHARTS ROW 2: Hourly Commuter Rush & Top Routes ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 3: Hourly Commuter & Travel Distribution */}
        <Card padding={false}>
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-indigo-500" />
              <div>
                <h3 className="text-slate-900 dark:text-white font-bold text-sm">
                  Peak Commuter Rush Hours (06:00 – 22:00)
                </h3>
                <p className="text-xs text-slate-400">
                  Passenger flow by departure schedule hour
                </p>
              </div>
            </div>
            <span className="text-xs text-indigo-500 font-medium bg-indigo-50 dark:bg-indigo-950/40 px-2 py-1 rounded-md">
              Fleet Scheduling
            </span>
          </div>

          <div className="p-5">
            {hourlyData.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">No hourly data available</div>
            ) : (
              <div className="space-y-4">
                <div className="h-44 w-full flex items-end gap-1.5 sm:gap-2 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
                  {hourlyData.map((h) => {
                    const height = Math.max((h.bookings / maxHourlyValue) * 100, 3);
                    const boardedPct = h.bookings > 0 ? (h.boarded / h.bookings) * 100 : 0;
                    return (
                      <div
                        key={h.hour}
                        className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                      >
                        {/* Tooltip */}
                        <div className="absolute -top-12 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 bg-slate-900 text-white text-[11px] rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap border border-slate-700">
                          <p className="font-bold text-indigo-300">{h.label} ({h.hour})</p>
                          <p className="text-[10px] text-slate-300">Bookings: {h.bookings} | Boarded: {h.boarded}</p>
                        </div>

                        {/* Bar with Boarded sub-fill */}
                        <div
                          className="w-full rounded-t-sm bg-indigo-500/30 group-hover:bg-indigo-500/50 transition-all relative overflow-hidden flex flex-col justify-end"
                          style={{ height: `${height}%` }}
                        >
                          <div
                            className="w-full bg-emerald-500 transition-all rounded-t-xs"
                            style={{ height: `${boardedPct}%` }}
                          />
                        </div>

                        <span className="text-[9px] text-slate-400 mt-2 truncate hidden sm:block">
                          {h.label.replace(' ', '')}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                    <span>Boarded Passsengers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500/40" />
                    <span>Booked Seats</span>
                  </div>
                  <span className="text-slate-400 text-[11px]">Morning rush (8-10 AM) • Evening rush (5-8 PM)</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Chart 4: Top Routes Performance & Boarding Rates */}
        <Card padding={false}>
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-slate-900 dark:text-white font-bold text-sm">
              Top Routes & Route Occupancy
            </h3>
            <span className="text-xs text-slate-400">{topRoutes.length} active routes</span>
          </div>

          <div className="p-4 divide-y divide-slate-100 dark:divide-slate-800/60">
            {topRoutes.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">No route performance data</div>
            ) : topRoutes.slice(0, 5).map((r: any, i: number) => {
              const bookingCount = Number(r.booking_count || 0);
              const boardedCount = Number(r.boarded_count || 0);
              const boardingPct = bookingCount > 0 ? Math.round((boardedCount / bookingCount) * 100) : 0;
              return (
                <div key={r.trip_id || i} className="py-3 px-2 flex items-center gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 rounded-xl transition-colors">
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{
                      background: i === 0 ? '#f59e0b' : i === 1 ? '#6366f1' : i === 2 ? '#10b981' : '#64748b',
                    }}
                  >
                    {i + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-slate-900 dark:text-white text-xs font-bold truncate">
                        {r.trip?.route?.route_name || r.trip?.schedule_code || `Trip #${r.trip_id}`}
                      </p>
                      <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        {bookingCount} bookings
                      </span>
                    </div>

                    <p className="text-slate-400 text-[11px] mt-0.5 truncate">
                      {r.trip?.route?.origin_city || 'Origin'} → {r.trip?.route?.destination_city || 'Destination'}
                    </p>

                    {/* Route Boarding Progress Bar */}
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${boardingPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                        {boardedCount} boarded ({boardingPct}%)
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── CHARTS ROW 3: Status Breakdown (Vehicles, Drivers, Trip Status) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {renderSimpleStatusBar(
          'Vehicle Fleet Status',
          charts.vehicleStatus || [],
          'status',
          'count',
          '#ec4899'
        )}
        {renderSimpleStatusBar(
          'Driver Status',
          charts.driverStatus || [],
          'status',
          'count',
          '#8b5cf6'
        )}
        {renderSimpleStatusBar(
          'Trip Execution Status',
          charts.tripStatus || [],
          'status',
          'count',
          '#06b6d4'
        )}
      </div>

      {/* ── BOARDED USERS & PASSENGER DIRECTORY ─────────────────────────────── */}
      <Card padding={false} className="shadow-sm">
        {/* Table Tab Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTableTab('boarded')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                activeTableTab === 'boarded'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <UserCheck size={14} />
              <span>Boarded & Active Commuters</span>
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${activeTableTab === 'boarded' ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>
                {stats.boardedUsers?.length || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTableTab('recent')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                activeTableTab === 'recent'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <Ticket size={14} />
              <span>Recent Bookings</span>
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${activeTableTab === 'recent' ? 'bg-indigo-700 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>
                {recentBookings.length}
              </span>
            </button>
          </div>

          {/* Search Input for Boarded Users */}
          {activeTableTab === 'boarded' && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search passenger, phone, seat..."
                  value={passengerSearch}
                  onChange={(e) => setPassengerSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-52 sm:w-64"
                />
              </div>

              {/* Status Pill Filters */}
              <div className="hidden sm:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[11px]">
                {['all', 'boarded', 'not_boarded', 'no_show'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setPassengerStatusTab(status)}
                    className={`px-2 py-1 rounded-md font-medium capitalize ${
                      passengerStatusTab === status
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                    }`}
                  >
                    {status.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Content for Boarded Users Table */}
        {activeTableTab === 'boarded' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Passenger Details</th>
                  <th className="py-3 px-4">Booking Ref / Pass</th>
                  <th className="py-3 px-4">Seat Numbers</th>
                  <th className="py-3 px-4">Route & Trip</th>
                  <th className="py-3 px-4">Stops (Pickup → Drop)</th>
                  <th className="py-3 px-4">Travel Date & Time</th>
                  <th className="py-3 px-4">Boarding Status</th>
                  <th className="py-3 px-4 text-right">Fare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredBoardedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      No passenger boarding records match the current filters
                    </td>
                  </tr>
                ) : filteredBoardedUsers.map((b: any) => {
                  let seatDisplay = '-';
                  try {
                    if (Array.isArray(b.seat_numbers)) {
                      seatDisplay = b.seat_numbers.join(', ');
                    } else if (typeof b.seat_numbers === 'string') {
                      const parsed = JSON.parse(b.seat_numbers);
                      seatDisplay = Array.isArray(parsed) ? parsed.join(', ') : b.seat_numbers;
                    }
                  } catch {
                    seatDisplay = String(b.seat_numbers || `${b.total_seats} seat(s)`);
                  }

                  const isBoarded = b.boarding_status === 'boarded';
                  const isNoShow = b.boarding_status === 'no_show';

                  return (
                    <tr
                      key={b.id}
                      className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${
                        isBoarded ? 'bg-emerald-500/5' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          {isBoarded && <Check size={13} className="text-emerald-500 flex-shrink-0" />}
                          <span>{b.passenger_name}</span>
                        </div>
                        <p className="text-[11px] text-slate-400">{b.passenger_mobile}</p>
                      </td>

                      <td className="py-3 px-4 font-mono text-[11px]">
                        <span className="text-slate-800 dark:text-slate-200 font-medium">{b.booking_reference}</span>
                        {b.boarding_pass_code && (
                          <p className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold">
                            {b.boarding_pass_code}
                          </p>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold text-slate-800 dark:text-slate-200">
                          {seatDisplay}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-800 dark:text-slate-200">
                          {b.trip?.route?.route_name || b.trip?.schedule_code || `Trip #${b.trip_id}`}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {b.trip?.vehicle?.registration_number && `Bus: ${b.trip.vehicle.registration_number}`}
                          {b.trip?.driver?.name && ` • ${b.trip.driver.name}`}
                        </p>
                      </td>

                      <td className="py-3 px-4 text-[11px]">
                        <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                          From: {b.origin_stop?.stop_name || 'Origin Stop'}
                        </p>
                        <p className="text-slate-400">
                          To: {b.destination_stop?.stop_name || 'Destination Stop'}
                        </p>
                      </td>

                      <td className="py-3 px-4 text-[11px]">
                        <p className="font-medium text-slate-800 dark:text-slate-200">{b.travel_date}</p>
                        {b.boarded_at ? (
                          <p className="text-[10px] text-emerald-500 font-semibold">
                            Boarded: {new Date(b.boarded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-400">
                            Dep: {b.trip?.departure_time || '-'}
                          </p>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge status={b.boarding_status || 'not_boarded'} />
                      </td>

                      <td className="py-3 px-4 text-right font-semibold text-slate-900 dark:text-white">
                        ₹{b.final_amount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Content for Recent Bookings Tab */}
        {activeTableTab === 'recent' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Passenger</th>
                  <th className="py-3 px-4">Booking Ref</th>
                  <th className="py-3 px-4">Trip Schedule</th>
                  <th className="py-3 px-4">Booking Status</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {recentBookings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No recent bookings available
                    </td>
                  </tr>
                ) : recentBookings.map((booking: any) => (
                  <tr key={booking.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                      {booking.passenger_name}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                      {booking.booking_reference}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {booking.trip?.schedule_code || `Trip #${booking.trip_id || '-'}`}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={booking.booking_status} />
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      ₹{booking.final_amount || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
