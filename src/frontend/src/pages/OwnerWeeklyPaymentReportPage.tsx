import React, { useEffect, useMemo, useState } from 'react';
import { dashboardAPI } from '../services/api';
import { Card, Table, Tr, Td, Select, ErrorState, Badge, Button } from '../components/ui';
import { Banknote, CalendarRange, TrendingUp, Users, ChevronLeft, ChevronRight, Download, FileSpreadsheet } from 'lucide-react';

interface OwnerWeeklyPaymentReportPageProps {
  onNotify?: (msg: string, type?: any) => void;
}

const money = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const getNumber = (...values: any[]) => {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

const formatYMD = (date: Date) => {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

export interface WeekOption {
  value: string; // format: "YYYY-MM-DD_YYYY-MM-DD" or custom
  label: string;
  from_date: string;
  to_date: string;
}

// Generate the list of current and previous calendar weeks.
// The current week is treated as an ongoing period from Monday to today.
const getAvailableWeeks = (numWeeks = 16): WeekOption[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  const currentWeekMonday = new Date(today);
  currentWeekMonday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  const weeks: WeekOption[] = [];

  const currentFromDate = formatYMD(currentWeekMonday);
  const currentToDate = formatYMD(today);
  const currentFromDay = pad2(currentWeekMonday.getDate());
  const currentFromMon = currentWeekMonday.toLocaleString('en-US', { month: 'short' });
  const currentToDay = pad2(today.getDate());
  const currentToMon = today.toLocaleString('en-US', { month: 'short' });
  const currentYear = today.getFullYear();

  weeks.push({
    value: 'current_week',
    label: `Current Week: ${currentFromDay} ${currentFromMon} – ${currentToDay} ${currentToMon} ${currentYear} (${currentFromDate} to ${currentToDate})`,
    from_date: currentFromDate,
    to_date: currentToDate,
  });

  for (let i = 1; i <= numWeeks; i++) {
    const monday = new Date(currentWeekMonday);
    monday.setDate(currentWeekMonday.getDate() - 7 * i);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const from_date = formatYMD(monday);
    const to_date = formatYMD(sunday);

    const sDay = pad2(monday.getDate());
    const sMon = monday.toLocaleString('en-US', { month: 'short' });
    const eDay = pad2(sunday.getDate());
    const eMon = sunday.toLocaleString('en-US', { month: 'short' });
    const year = sunday.getFullYear();

    const labelPrefix = i === 1 ? 'Last Completed Week: ' : '';
    const label = `${labelPrefix}${sDay} ${sMon} – ${eDay} ${eMon} ${year} (${from_date} to ${to_date})`;

    weeks.push({
      value: `${from_date}_${to_date}`,
      label,
      from_date,
      to_date,
    });
  }

  return weeks;
};

export const OwnerWeeklyPaymentReportPage: React.FC<OwnerWeeklyPaymentReportPageProps> = ({ onNotify }) => {
  const availableWeeks = useMemo(() => getAvailableWeeks(20), []);
  const [selectedWeek, setSelectedWeek] = useState<string>(() => {
    const firstCompleted = availableWeeks.find((w) => w.value !== 'current_week');
    return firstCompleted?.value || availableWeeks[0]?.value || '';
  });
  const [period, setPeriod] = useState('weekly');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  // Current active date range based on period and selected week / custom dates
  const currentRange = useMemo(() => {
    if (period === 'weekly') {
      if (selectedWeek === 'custom') {
        return {
          from_date: customFromDate,
          to_date: customToDate,
          isCustom: true,
        };
      }
      const found = availableWeeks.find((w) => w.value === selectedWeek);
      if (found) {
        return {
          from_date: found.from_date,
          to_date: found.to_date,
          label: found.label,
          isCustom: false,
        };
      }
      const defaultWeek = availableWeeks[0];
      return {
        from_date: defaultWeek?.from_date || '',
        to_date: defaultWeek?.to_date || '',
        label: defaultWeek?.label || '',
        isCustom: false,
      };
    }
    return null;
  }, [period, selectedWeek, availableWeeks, customFromDate, customToDate]);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        setLoading(true);
        setError('');
        const params: Record<string, string> = { period };

        if (period === 'weekly') {
          if (currentRange?.from_date && currentRange?.to_date) {
            params.from_date = currentRange.from_date;
            params.to_date = currentRange.to_date;
          }
        }
        if (ownerFilter) params.owner_id = ownerFilter;
        const res = await dashboardAPI.revenueReport(params);
        setData(res.data?.data || res.data || {});
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load weekly owner payment report');
      } finally {
        setLoading(false);
      }
    };

    if (period !== 'weekly' || selectedWeek !== 'custom' || (customFromDate && customToDate)) {
      fetchReport();
    }
  }, [period, currentRange, ownerFilter, selectedWeek, customFromDate, customToDate]);

  // Quick navigation to previous/next week
  const currentWeekIndex = availableWeeks.findIndex((w) => w.value === selectedWeek);
  const canGoNewer = currentWeekIndex > 0;
  const canGoOlder = currentWeekIndex >= 0 && currentWeekIndex < availableWeeks.length - 1;

  const handlePreviousWeek = () => {
    if (canGoOlder) {
      setSelectedWeek(availableWeeks[currentWeekIndex + 1].value);
    }
  };

  const handleNextWeek = () => {
    if (canGoNewer) {
      setSelectedWeek(availableWeeks[currentWeekIndex - 1].value);
    }
  };

  const selectedOwnerAnalytics = data?.selected_owner_analytics;
  const selectedTripSummary = selectedOwnerAnalytics?.trip_summary || null;

  const rows = useMemo(() => {
    const list = data?.owner_breakdown || data?.report || [];
    const selectedOwnerId = Number(ownerFilter || selectedOwnerAnalytics?.owner_id || 0);

    return list.map((item: any) => {
      const ownerId = Number(item.owner_id || item.ownerId || item.id);
      const selectedOwnerMatch = selectedOwnerId > 0 && selectedOwnerId === ownerId && Boolean(selectedTripSummary);

      const rawTotalTrips = getNumber(item.total_trips, item.trip_count, item.trips, item.total_assigned_trips, item.total_run_trips, item.total_trip_count);
      const rawTotalTripAmount = getNumber(item.total_trip_amount, item.gross_revenue, item.total_earned_amount, item.total_amount, item.gross_amount, item.total_gross_revenue);
      const rawTotalTds = getNumber(item.total_tds_amount, item.tds_amount, item.tax_deduction, item.deduction_amount, item.total_tds, Math.max(rawTotalTripAmount - (item.total_net_payout ?? item.net_payout ?? item.net_revenue ?? rawTotalTripAmount), 0));
      const rawTotalNetPayout = getNumber(item.total_net_payout, item.net_payout, item.net_revenue, item.owner_payout, item.net_amount, item.payable_amount, item.final_amount, rawTotalTripAmount - rawTotalTds);
      const rawCompletedTrips = getNumber(item.completed_trips, item.completed_trip_count, item.total_completed_trips, item.trips_completed, item.completed, item.total_completed_trip_count, rawTotalTrips);
      const rawCompletedGross = getNumber(item.completed_trip_amount, item.completed_gross_revenue, item.completed_revenue, item.completed_total_amount, item.completed_amount, rawTotalTripAmount);
      const rawCompletedTds = getNumber(item.completed_tds_amount, item.completed_tds, item.completed_tax, item.completed_tax_amount, rawTotalTds);
      const rawCompletedNet = getNumber(item.completed_net_payout, item.completed_net_revenue, item.completed_net_amount, item.completed_net, rawTotalNetPayout);

      const totalTrips = selectedOwnerMatch ? getNumber(selectedTripSummary.total_trips, rawTotalTrips) : rawTotalTrips;
      const totalTripAmount = selectedOwnerMatch ? getNumber(selectedTripSummary.total_trip_amount, selectedTripSummary.gross_revenue, rawTotalTripAmount) : rawTotalTripAmount;
      const totalTds = selectedOwnerMatch ? getNumber(selectedTripSummary.total_tds_amount, selectedTripSummary.tds_amount, rawTotalTds) : rawTotalTds;
      const totalNetPayout = selectedOwnerMatch ? getNumber(selectedTripSummary.total_net_payout, selectedTripSummary.net_revenue, rawTotalNetPayout) : rawTotalNetPayout;
      const completedTrips = selectedOwnerMatch ? getNumber(selectedTripSummary.completed_trips, rawCompletedTrips) : rawCompletedTrips;
      const completedGross = selectedOwnerMatch ? getNumber(
        selectedTripSummary.completed_trip_amount,
        selectedTripSummary.completed_gross_revenue,
        selectedTripSummary.gross_revenue,
        rawCompletedGross
      ) : rawCompletedGross;
      const completedTds = selectedOwnerMatch ? getNumber(
        selectedTripSummary.completed_tds_amount,
        selectedTripSummary.completed_tds,
        selectedTripSummary.tds_amount,
        rawCompletedTds
      ) : rawCompletedTds;
      const completedNet = selectedOwnerMatch ? getNumber(
        selectedTripSummary.completed_net_payout,
        selectedTripSummary.completed_net_revenue,
        selectedTripSummary.net_revenue,
        rawCompletedNet
      ) : rawCompletedNet;

      return {
        ownerId,
        ownerName: item.owner_name || item.ownerName || 'Unknown Owner',
        trips: totalTrips,
        gross: totalTripAmount,
        tds: totalTds,
        payout: totalNetPayout,
        completedTrips,
        completedGross,
        completedTds,
        completedNet,
        status: item.status || (totalNetPayout > 0 ? 'Ready' : 'No payout'),
      };
    });
  }, [data, ownerFilter, selectedOwnerAnalytics, selectedTripSummary]);

  const ownerOptions = useMemo(() => {
    const list = data?.owner_options || [];
    return list.map((owner: any) => ({
      value: String(owner.owner_id),
      label: owner.owner_name || `Owner #${owner.owner_id}`,
    }));
  }, [data]);

  const busTypeRows = useMemo(() => {
    const list = selectedOwnerAnalytics?.bus_type_summary?.bus_types || [];
    return list.map((item: any) => ({
      id: item.bus_type_id || item.id,
      name: item.name || item.bus_type_name || 'Bus Type',
      trips: getNumber(item.trips_count, item.total_trips, item.trips),
      completed: getNumber(item.completed_trips, item.completed),
      cancelled: getNumber(item.cancelled_trips, item.cancelled),
      gross: getNumber(item.gross_revenue, item.gross),
      net: getNumber(item.net_revenue, item.net),
    }));
  }, [selectedOwnerAnalytics]);

  const driverRows = useMemo(() => {
    const list = selectedOwnerAnalytics?.driver_summary?.drivers || [];
    return list.map((item: any) => ({
      id: item.driver_id || item.id,
      name: item.name || 'Driver',
      mobile: item.mobile || '—',
      assignedVehicle: item.assigned_vehicle?.registration_number || item.assigned_vehicle?.company_model || 'Unassigned',
      trips: getNumber(item.total_trips, item.trips),
      completed: getNumber(item.completed_trips, item.completed),
      cancelled: getNumber(item.cancelled_trips, item.cancelled),
      gross: getNumber(item.gross_revenue, item.gross),
      net: getNumber(item.net_revenue, item.net),
    }));
  }, [selectedOwnerAnalytics]);

  const tripRows = useMemo(() => {
    const list = data?.trip_breakdown || [];
    if (!selectedOwnerAnalytics) return list;
    return list.filter((trip: any) => Number(trip.owner_id) === Number(selectedOwnerAnalytics.owner_id));
  }, [data, selectedOwnerAnalytics]);

  const totals = useMemo(() => rows.reduce((acc: any, row: any) => {
    acc.trips += row.trips;
    acc.gross += row.gross;
    acc.tds += row.tds;
    acc.payout += row.payout;
    return acc;
  }, { trips: 0, gross: 0, tds: 0, payout: 0 }), [rows]);

  const weekDropdownOptions = useMemo(() => {
    return [
      ...availableWeeks.map((w) => ({ value: w.value, label: w.label })),
      { value: 'custom', label: '📅 Custom Date Range...' },
    ];
  }, [availableWeeks]);

  // ── Download All Owners Payment Summary Excel / CSV ────────────
  const handleDownloadAllOwnerPayments = () => {
    const csvEscape = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const lines: string[] = [];

    lines.push([
      csvEscape('Owner'),
      csvEscape('Total Trips'),
      csvEscape('Total Trip Amount (INR)'),
      csvEscape('TDS (INR)'),
      csvEscape('Net Payout (INR)'),
      csvEscape('Trips Completed'),
      csvEscape('Total Completed Trip Amount (INR)'),
      csvEscape('Completed TDS (INR)'),
      csvEscape('Completed Net Payout (INR)'),
      csvEscape('Status'),
    ].join(','));

    rows.forEach((row: any) => {
      lines.push([
        csvEscape(row.ownerName),
        csvEscape(row.trips),
        csvEscape(Number(row.gross || 0).toFixed(2)),
        csvEscape(Number(row.tds || 0).toFixed(2)),
        csvEscape(Number(row.payout || 0).toFixed(2)),
        csvEscape(row.completedTrips),
        csvEscape(Number(row.completedGross || 0).toFixed(2)),
        csvEscape(Number(row.completedTds || 0).toFixed(2)),
        csvEscape(Number(row.completedNet || 0).toFixed(2)),
        csvEscape(row.status),
      ].join(','));
    });

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `owner_weekly_payment_report_${currentRange?.from_date || 'all'}_to_${currentRange?.to_date || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (onNotify) {
      onNotify('All owner weekly payment report downloaded successfully', 'success');
    }
  };

  // ── Download Owner Payment Invoice Excel / CSV ────────────
  const handleDownloadOwnerInvoice = () => {
    if (!selectedOwnerAnalytics && !ownerFilter) {
      if (onNotify) onNotify('Please select an owner first to download their detailed payout invoice.', 'info');
      return;
    }

    const ownerName = selectedOwnerAnalytics?.owner_name || (ownerOptions.find(o => o.value === ownerFilter)?.label) || `Owner #${ownerFilter}`;
    const periodLabel = currentRange?.from_date && currentRange?.to_date
      ? `${currentRange.from_date} to ${currentRange.to_date}`
      : period;

    const vehiclesList = selectedOwnerAnalytics?.vehicle_summary?.vehicles || [];
    const totalVehiclesCount = selectedOwnerAnalytics?.vehicle_summary?.total_vehicles || vehiclesList.length || 0;

    const totalTripsRun = selectedTripSummary?.total_trips || tripRows.length || 0;
    const completedTrips = selectedTripSummary?.completed_trips || tripRows.filter(t => t.status === 'Completed').length || 0;
    const cancelledTrips = selectedTripSummary?.cancelled_trips || tripRows.filter(t => t.status === 'Cancelled').length || 0;
    const grossRevenue = selectedTripSummary?.gross_revenue || tripRows.reduce((sum, t) => sum + (t.status === 'Completed' ? Number(t.trip_rate || t.gross_revenue || 0) : 0), 0);
    const tdsPercentage = Number(data?.tds_percentage || 2);
    const tdsAmount = selectedTripSummary?.tds_amount != null
      ? Number(selectedTripSummary.tds_amount)
      : Number((grossRevenue * (tdsPercentage / 100)).toFixed(2));
    const netPayable = selectedTripSummary?.net_revenue != null
      ? Number(selectedTripSummary.net_revenue)
      : Number((grossRevenue - tdsAmount).toFixed(2));

    const csvEscape = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;

    const lines: string[] = [];

    // 1. INVOICE HEADER
    lines.push([csvEscape('ONCAB SHUTTLE - OWNER WEEKLY PAYMENT STATEMENT & INVOICE')].join(','));
    lines.push([csvEscape('Generated Date:'), csvEscape(new Date().toLocaleString('en-IN'))].join(','));
    lines.push([csvEscape('Owner Name:'), csvEscape(ownerName)].join(','));
    lines.push([csvEscape('Owner ID:'), csvEscape(selectedOwnerAnalytics?.owner_id || ownerFilter)].join(','));
    lines.push([csvEscape('Payment / Settlement Period:'), csvEscape(periodLabel)].join(','));
    lines.push('');

    // 2. PAYMENT SUMMARY BOX
    lines.push([csvEscape('--- FINANCIAL PAYOUT SUMMARY ---')].join(','));
    lines.push([csvEscape('Metric / Description'), csvEscape('Quantity / Value')].join(','));
    lines.push([csvEscape('Total Vehicles Owned:'), csvEscape(totalVehiclesCount)].join(','));
    lines.push([csvEscape('Total Completed Trips:'), csvEscape(completedTrips)].join(','));
    lines.push([csvEscape('Total Cancelled Trips:'), csvEscape(cancelledTrips)].join(','));
    lines.push([csvEscape('Total Trips Scheduled:'), csvEscape(totalTripsRun)].join(','));
    lines.push([csvEscape('Gross Payout Due (before TDS):'), csvEscape(`INR ${grossRevenue.toFixed(2)}`)].join(','));
    lines.push([csvEscape(`TDS Deduction (${tdsPercentage}%):`), csvEscape(`INR ${tdsAmount.toFixed(2)}`)].join(','));
    lines.push([csvEscape('NET PAYOUT DUE TO OWNER:'), csvEscape(`INR ${netPayable.toFixed(2)}`)].join(','));
    lines.push('');

    // 3. VEHICLE FLEET BREAKDOWN & TRIP RATES
    lines.push([csvEscape('--- SECTION 1: OWNER VEHICLE FLEET & CONFIGURED TRIP RATES ---')].join(','));
    lines.push([
      csvEscape('Vehicle Number'),
      csvEscape('Vehicle Model'),
      csvEscape('Vehicle Type (Bus / Traveller / Van)'),
      csvEscape('Seat Capacity'),
      csvEscape('Configured Payout Rate Per Completed Trip (INR)'),
      csvEscape('Assigned Driver'),
      csvEscape('Vehicle Status')
    ].join(','));

    if (vehiclesList.length > 0) {
      vehiclesList.forEach((v: any) => {
        lines.push([
          csvEscape(v.registration_number || '—'),
          csvEscape(v.company_model || '—'),
          csvEscape(v.bus_type_name || 'Standard Bus'),
          csvEscape(v.total_seats || 0),
          csvEscape(v.rate_per_trip != null ? `INR ${Number(v.rate_per_trip).toFixed(2)}` : 'INR 3000.00'),
          csvEscape(v.assigned_driver_name || 'Unassigned'),
          csvEscape(v.status || 'Active')
        ].join(','));
      });
    } else {
      lines.push([csvEscape('No vehicles registered under this owner.')].join(','));
    }
    lines.push('');

    // 4. BUS TYPE RATE & REVENUE BREAKDOWN
    lines.push([csvEscape('--- SECTION 2: BUS TYPE PERFORMANCE & EARNINGS SUMMARY ---')].join(','));
    lines.push([
      csvEscape('Bus Type'),
      csvEscape('Total Trips'),
      csvEscape('Completed Trips'),
      csvEscape('Cancelled Trips'),
      csvEscape('Gross Earnings (INR)'),
      csvEscape('Net Payout (INR)')
    ].join(','));

    if (busTypeRows.length > 0) {
      busTypeRows.forEach((bt: any) => {
        lines.push([
          csvEscape(bt.name),
          csvEscape(bt.trips),
          csvEscape(bt.completed),
          csvEscape(bt.cancelled),
          csvEscape(`INR ${bt.gross.toFixed(2)}`),
          csvEscape(`INR ${bt.net.toFixed(2)}`)
        ].join(','));
      });
    } else {
      lines.push([csvEscape('No bus type summary available.')].join(','));
    }
    lines.push('');

    // 5. DRIVER PERFORMANCE BREAKDOWN
    lines.push([csvEscape('--- SECTION 3: DRIVER PERFORMANCE BREAKDOWN ---')].join(','));
    lines.push([
      csvEscape('Driver Name'),
      csvEscape('Mobile Number'),
      csvEscape('Assigned Vehicle'),
      csvEscape('Total Trips'),
      csvEscape('Completed Trips'),
      csvEscape('Cancelled Trips'),
      csvEscape('Gross Earnings (INR)'),
      csvEscape('Net Payout (INR)')
    ].join(','));

    if (driverRows.length > 0) {
      driverRows.forEach((d: any) => {
        lines.push([
          csvEscape(d.name),
          csvEscape(d.mobile),
          csvEscape(d.assignedVehicle),
          csvEscape(d.trips),
          csvEscape(d.completed),
          csvEscape(d.cancelled),
          csvEscape(`INR ${d.gross.toFixed(2)}`),
          csvEscape(`INR ${d.net.toFixed(2)}`)
        ].join(','));
      });
    } else {
      lines.push([csvEscape('No driver activity registered.')].join(','));
    }
    lines.push('');

    // 6. ITEMISED TRIP LOG (AUDIT RECORD)
    lines.push([csvEscape('--- SECTION 4: FULL TRIP-BY-TRIP ITEMISED AUDIT LOG ---')].join(','));
    lines.push([
      csvEscape('Trip ID'),
      csvEscape('Date'),
      csvEscape('Departure Time'),
      csvEscape('Schedule Code'),
      csvEscape('Route Name'),
      csvEscape('Vehicle Number'),
      csvEscape('Vehicle / Bus Type'),
      csvEscape('Driver Name'),
      csvEscape('Trip Status'),
      csvEscape('Payout Rate Per Trip (INR)'),
      csvEscape('Gross Payable (INR)'),
      csvEscape('TDS (INR)'),
      csvEscape('Net Payable (INR)')
    ].join(','));

    if (tripRows.length > 0) {
      tripRows.forEach((t: any) => {
        const isCompleted = t.status === 'Completed';
        const rate = Number(t.trip_rate || t.gross_revenue || 0);
        const gross = isCompleted ? rate : 0;
        const tds = isCompleted ? Number((gross * (tdsPercentage / 100)).toFixed(2)) : 0;
        const net = isCompleted ? Number((gross - tds).toFixed(2)) : 0;

        lines.push([
          csvEscape(t.trip_id || t.id),
          csvEscape(t.travel_date || t.trip_date || '—'),
          csvEscape(t.departure_time || '—'),
          csvEscape(t.schedule_code || '—'),
          csvEscape(t.route_name || '—'),
          csvEscape(t.vehicle?.registration_number || '—'),
          csvEscape(t.bus_type_name || t.vehicle?.bus_type_name || 'Standard Bus'),
          csvEscape(t.driver?.name || '—'),
          csvEscape(t.status || 'Scheduled'),
          csvEscape(isCompleted ? `INR ${rate.toFixed(2)}` : 'INR 0.00'),
          csvEscape(`INR ${gross.toFixed(2)}`),
          csvEscape(`INR ${tds.toFixed(2)}`),
          csvEscape(`INR ${net.toFixed(2)}`)
        ].join(','));
      });
    } else {
      lines.push([csvEscape('No trip details recorded for this owner during this period.')].join(','));
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const cleanOwnerName = ownerName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateRangeSlug = currentRange?.from_date && currentRange?.to_date
      ? `${currentRange.from_date}_to_${currentRange.to_date}`
      : 'report';
    link.setAttribute('download', `owner_payment_invoice_${cleanOwnerName}_${dateRangeSlug}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (onNotify) {
      onNotify(`Payment invoice and breakdown for ${ownerName} downloaded successfully!`, 'success');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Filter Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Owner Weekly Payment Report</h2>
          <p className="text-sm text-slate-400">Per owner trip count and payout due across the selected period.</p>
          {period === 'weekly' && currentRange && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs font-medium text-sky-300">
                Active week: {currentRange.from_date} to {currentRange.to_date}
              </span>
              {currentRange.from_date && currentRange.to_date && (
                <span className="inline-block rounded-full bg-sky-950/70 px-2 py-0.5 text-[11px] text-sky-400 border border-sky-800/60">
                  {new Date(`${currentRange.from_date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(`${currentRange.to_date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Owner Filter */}
          <div className="w-full sm:w-56">
            <Select
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { value: '', label: 'All Owners' },
                ...ownerOptions,
              ]}
              className="w-full"
            />
          </div>

          {/* Period Mode Filter (Weekly, Monthly, Yearly) */}
          <div className="w-full sm:w-36">
            <Select
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
              className="w-full"
            />
          </div>

          {/* Week Selector Dropdown & Previous/Next Buttons */}
          {period === 'weekly' && (
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePreviousWeek}
                  disabled={!canGoOlder || loading}
                  title="Previous (earlier) week"
                  className="p-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleNextWeek}
                  disabled={!canGoNewer || loading}
                  title="Next (more recent) week"
                  className="p-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="flex-1 sm:w-80">
                <Select
                  value={selectedWeek}
                  onChange={(val) => {
                    setSelectedWeek(val);
                    if (val === 'custom' && !customFromDate && !customToDate) {
                      const prevWeek = availableWeeks[0];
                      if (prevWeek) {
                        setCustomFromDate(prevWeek.from_date);
                        setCustomToDate(prevWeek.to_date);
                      }
                    }
                  }}
                  options={weekDropdownOptions}
                  className="w-full font-medium"
                />
              </div>
            </div>
          )}

          {/* Single-Click Excel / CSV Export Button */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleDownloadAllOwnerPayments}
              variant="secondary"
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white border-none shadow-md shadow-sky-950/40"
            >
              <FileSpreadsheet size={15} />
              <span>Export All Owner Payments</span>
            </Button>
            {ownerFilter && (
              <Button
                onClick={handleDownloadOwnerInvoice}
                variant="secondary"
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white border-none shadow-md shadow-emerald-950/40"
              >
                <Download size={15} />
                <span>Download Owner Invoice</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Custom Date Range Picker when "Custom Date Range" is chosen */}
      {period === 'weekly' && selectedWeek === 'custom' && (
        <Card className="p-4 bg-slate-850/70 border border-slate-800">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <CalendarRange size={16} className="text-sky-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Select Custom Week / Period Range:
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">From:</label>
              <input
                type="date"
                value={customFromDate}
                onChange={(e) => setCustomFromDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl text-sm bg-slate-900 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">To:</label>
              <input
                type="date"
                value={customToDate}
                onChange={(e) => setCustomToDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl text-sm bg-slate-900 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
          </div>
        </Card>
      )}

      {selectedTripSummary && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs uppercase tracking-wide">Trips Run</span>
              <CalendarRange size={16} />
            </div>
            <div className="mt-3 text-2xl font-bold text-white">{selectedTripSummary.total_trips || 0}</div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs uppercase tracking-wide">Completed</span>
              <TrendingUp size={16} />
            </div>
            <div className="mt-3 text-2xl font-bold text-emerald-400">{selectedTripSummary.completed_trips || 0}</div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs uppercase tracking-wide">Cancelled</span>
              <CalendarRange size={16} />
            </div>
            <div className="mt-3 text-2xl font-bold text-amber-400">{selectedTripSummary.cancelled_trips || 0}</div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs uppercase tracking-wide">Net Payout Due</span>
              <Banknote size={16} />
            </div>
            <div className="mt-3 text-xl font-bold text-sky-400">{money(selectedTripSummary.net_revenue || 0)}</div>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs uppercase tracking-wide">Owners</span>
            <Users size={16} />
          </div>
          <div className="mt-3 text-2xl font-bold text-white">{rows.length}</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs uppercase tracking-wide">Trips Run</span>
            <CalendarRange size={16} />
          </div>
          <div className="mt-3 text-2xl font-bold text-white">{totals.trips}</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs uppercase tracking-wide">Gross</span>
            <TrendingUp size={16} />
          </div>
          <div className="mt-3 text-xl font-bold text-emerald-400">{money(totals.gross)}</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs uppercase tracking-wide">Net Payable</span>
            <Banknote size={16} />
          </div>
          <div className="mt-3 text-xl font-bold text-sky-400">{money(totals.payout)}</div>
        </Card>
      </div>

      {/* Selected Owner Analytics & Invoice Card */}
      {selectedOwnerAnalytics && (
        <div className="space-y-5">
          {/* Owner Highlight Banner & Download CTA */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-750 shadow-lg">
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-bold text-white">{selectedOwnerAnalytics.owner_name}</h3>
                <Badge color="blue">Owner ID #{selectedOwnerAnalytics.owner_id}</Badge>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {selectedOwnerAnalytics.vehicle_summary?.total_vehicles || 0} Vehicles Registered • {selectedTripSummary?.completed_trips || 0} Completed Trips • Net Payout: <strong className="text-emerald-400">{money(selectedTripSummary?.net_revenue || 0)}</strong>
              </p>
            </div>

            <Button
              onClick={handleDownloadOwnerInvoice}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-xl shadow-md"
            >
              <FileSpreadsheet size={16} />
              <span>Download Excel/CSV Statement</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {/* Vehicles Fleet & Configured Rate */}
            <Card padding={false}>
              <div className="border-b border-slate-700/60 px-4 py-3 flex items-center justify-between">
                <h4 className="font-semibold text-white">Owner Vehicles & Trip Rates</h4>
                <span className="text-xs text-slate-400">{selectedOwnerAnalytics.vehicle_summary?.total_vehicles || 0} total</span>
              </div>
              <Table
                headers={['Vehicle Reg', 'Model', 'Type', 'Rate/Trip', 'Assigned Driver', 'Status']}
                loading={loading}
                empty={!selectedOwnerAnalytics.vehicle_summary?.vehicles?.length}
                emptyMessage="No vehicles registered."
              >
                {selectedOwnerAnalytics.vehicle_summary?.vehicles?.map((veh: any) => (
                  <Tr key={veh.id || veh.registration_number}>
                    <Td className="font-semibold text-white">{veh.registration_number}</Td>
                    <Td className="text-slate-300">{veh.company_model || '—'}</Td>
                    <Td className="text-slate-300">
                      <span className="inline-block px-2 py-0.5 rounded-md bg-slate-800 text-xs font-medium text-slate-200">
                        {veh.bus_type_name || 'Standard Bus'}
                      </span>
                    </Td>
                    <Td className="text-emerald-400 font-semibold">{money(veh.rate_per_trip || 3000)}</Td>
                    <Td className="text-slate-300">{veh.assigned_driver_name || 'Unassigned'}</Td>
                    <Td>
                      <Badge color={veh.status === 'Active' ? 'green' : 'slate'}>{veh.status || 'Active'}</Badge>
                    </Td>
                  </Tr>
                ))}
              </Table>
            </Card>

            {/* Bus Type Breakdown */}
            <Card padding={false}>
              <div className="border-b border-slate-700/60 px-4 py-3">
                <h4 className="font-semibold text-white">Bus Type Earnings Breakdown</h4>
              </div>
              <Table headers={['Bus Type', 'Trips', 'Completed', 'Cancelled', 'Gross', 'Net']} loading={loading} empty={busTypeRows.length === 0} emptyMessage="No bus type data.">
                {busTypeRows.map((row: any) => (
                  <Tr key={row.id || row.name}>
                    <Td className="font-medium text-white">{row.name}</Td>
                    <Td className="text-slate-300">{row.trips}</Td>
                    <Td className="text-emerald-400">{row.completed}</Td>
                    <Td className="text-amber-400">{row.cancelled}</Td>
                    <Td className="text-emerald-400 font-semibold">{money(row.gross)}</Td>
                    <Td className="text-sky-400 font-semibold">{money(row.net)}</Td>
                  </Tr>
                ))}
              </Table>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {/* Driver Breakdown */}
            <Card padding={false}>
              <div className="border-b border-slate-700/60 px-4 py-3">
                <h4 className="font-semibold text-white">Driver Breakdown</h4>
              </div>
              <Table headers={['Driver', 'Vehicle', 'Trips', 'Completed', 'Cancelled', 'Gross', 'Net']} loading={loading} empty={driverRows.length === 0} emptyMessage="No driver data.">
                {driverRows.map((row: any) => (
                  <Tr key={row.id || row.name}>
                    <Td>
                      <div className="font-medium text-white">{row.name}</div>
                      <div className="text-xs text-slate-400">{row.mobile}</div>
                    </Td>
                    <Td className="text-slate-300">{row.assignedVehicle}</Td>
                    <Td className="text-slate-300">{row.trips}</Td>
                    <Td className="text-emerald-400">{row.completed}</Td>
                    <Td className="text-amber-400">{row.cancelled}</Td>
                    <Td className="text-emerald-400 font-semibold">{money(row.gross)}</Td>
                    <Td className="text-sky-400 font-semibold">{money(row.net)}</Td>
                  </Tr>
                ))}
              </Table>
            </Card>

            {/* Trip Date & Driver Activity */}
            <Card padding={false}>
              <div className="border-b border-slate-700/60 px-4 py-3">
                <h4 className="font-semibold text-white">Trip Activity</h4>
              </div>
              <Table headers={['Date', 'Trip', 'Vehicle', 'Bus Type', 'Driver', 'Status', 'Revenue']} loading={loading} empty={tripRows.length === 0} emptyMessage="No trip activity for selected owner.">
                {tripRows.slice(0, 40).map((trip: any) => (
                  <Tr key={`${trip.trip_id}-${trip.travel_date}`}>
                    <Td className="text-slate-300">{trip.travel_date || trip.trip_date || '—'}</Td>
                    <Td className="font-medium text-white">{trip.schedule_code || `Trip #${trip.trip_id}`}</Td>
                    <Td className="text-slate-300 font-mono text-xs font-semibold">{trip.vehicle?.registration_number || trip.vehicle_registration || '—'}</Td>
                    <Td className="text-slate-300">{trip.bus_type_name || trip.bus_type?.name || 'Standard Bus'}</Td>
                    <Td className="text-slate-300">{trip.driver?.name || 'Unassigned'}</Td>
                    <Td>
                      <Badge color={trip.status === 'Completed' ? 'green' : trip.status === 'Cancelled' ? 'red' : trip.status === 'Active' ? 'blue' : 'slate'}>{trip.status || 'Scheduled'}</Badge>
                    </Td>
                    <Td className="text-emerald-400 font-semibold">{money(trip.net_revenue || trip.gross_revenue || 0)}</Td>
                  </Tr>
                ))}
              </Table>
            </Card>
          </div>
        </div>
      )}

      {/* Main Table for All Owners */}
      {error ? (
        <ErrorState message={error} />
      ) : (
        <Card padding={false}>
          <div className="border-b border-slate-700/60 px-4 py-3 flex items-center justify-between">
            <h4 className="font-semibold text-white">All Owners Weekly Settlement Summary</h4>
            <span className="text-xs text-slate-400">Click any owner to inspect or download full breakdown</span>
          </div>
          <Table
            headers={['Owner', 'Total Trips', 'Total Trip Amount', 'TDS', 'Net Payout', 'Trips Completed', 'Total Completed Trip Amount', 'Completed TDS', 'Completed Net Payout', 'Status', 'Action']}
            loading={loading}
            empty={!loading && rows.length === 0}
            emptyMessage="No owner payout data for this period."
          >
            {rows.map((row: any) => (
              <Tr
                key={row.ownerId || row.ownerName}
                className={ownerFilter === String(row.ownerId) ? 'bg-sky-950/30 border-l-4 border-sky-500' : ''}
              >
                <Td>
                  <button
                    type="button"
                    onClick={() => setOwnerFilter(String(row.ownerId))}
                    className="font-medium text-white hover:text-sky-400 text-left transition"
                  >
                    {row.ownerName}
                  </button>
                </Td>
                <Td className="text-sm text-slate-300">{row.trips}</Td>
                <Td className="text-sm text-emerald-400 font-semibold">{money(row.gross)}</Td>
                <Td className="text-sm text-amber-400">{money(row.tds)}</Td>
                <Td className="text-sm text-sky-400 font-semibold">{money(row.payout)}</Td>
                <Td className="text-sm text-slate-300">{row.completedTrips}</Td>
                <Td className="text-sm text-emerald-400 font-semibold">{money(row.completedGross)}</Td>
                <Td className="text-sm text-amber-400">{money(row.completedTds)}</Td>
                <Td className="text-sm text-sky-400 font-semibold">{money(row.completedNet)}</Td>
                <Td>
                  <Badge color={row.payout > 0 ? 'green' : 'slate'}>{row.status}</Badge>
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => {
                      setOwnerFilter(String(row.ownerId));
                    }}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition"
                  >
                    {ownerFilter === String(row.ownerId) ? 'Selected' : 'Select & View'}
                  </button>
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
};
