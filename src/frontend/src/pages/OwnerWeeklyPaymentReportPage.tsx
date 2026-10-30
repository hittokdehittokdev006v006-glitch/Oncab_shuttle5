import React, { useEffect, useMemo, useState } from 'react';
import { dashboardAPI } from '../services/api';
import { Card, Table, Tr, Td, Select, ErrorState, Badge } from '../components/ui';
import { Banknote, CalendarRange, TrendingUp, Users } from 'lucide-react';

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

const getPreviousWeekRange = () => {
  const anchor = new Date();
  anchor.setHours(0, 0, 0, 0);

  const currentWeekMonday = new Date(anchor);
  currentWeekMonday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));

  const lastWeekMonday = new Date(currentWeekMonday);
  lastWeekMonday.setDate(currentWeekMonday.getDate() - 7);

  const lastWeekSunday = new Date(lastWeekMonday);
  lastWeekSunday.setDate(lastWeekMonday.getDate() + 6);

  return {
    from_date: lastWeekMonday.toISOString().split('T')[0],
    to_date: lastWeekSunday.toISOString().split('T')[0],
  };
};

export const OwnerWeeklyPaymentReportPage: React.FC<OwnerWeeklyPaymentReportPageProps> = () => {
  const [period, setPeriod] = useState('weekly');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        setLoading(true);
        setError('');
        const params: Record<string, string> = { period };
        if (period === 'weekly') {
          const range = getPreviousWeekRange();
          params.from_date = range.from_date;
          params.to_date = range.to_date;
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

    fetchReport();
  }, [period, ownerFilter]);

  const rows = useMemo(() => {
    const list = data?.owner_breakdown || data?.report || [];
    return list.map((item: any) => {
      const gross = getNumber(item.gross_revenue, item.total_earned_amount, item.total_amount, item.gross_amount);
      const netPayout = getNumber(item.net_payout, item.net_revenue, item.owner_payout, item.net_amount, item.payable_amount, item.final_amount);
      const tds = getNumber(item.tds_amount, item.tax_deduction, item.deduction_amount, item.total_tds, Math.max(gross - netPayout, 0));

      return {
        ownerId: item.owner_id || item.ownerId || item.id,
        ownerName: item.owner_name || item.ownerName || 'Unknown Owner',
        trips: getNumber(item.total_completed_trips, item.completed_trips, item.trip_count, item.trips),
        gross,
        tds,
        payout: netPayout,
        status: item.status || (netPayout > 0 ? 'Ready' : 'No payout'),
      };
    });
  }, [data]);

  const ownerOptions = useMemo(() => {
    const list = data?.owner_options || [];
    return list.map((owner: any) => ({
      value: String(owner.owner_id),
      label: owner.owner_name || `Owner #${owner.owner_id}`,
    }));
  }, [data]);

  const selectedOwnerAnalytics = data?.selected_owner_analytics;
  const selectedTripSummary = selectedOwnerAnalytics?.trip_summary || null;
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

  const activeRange = useMemo(() => {
    if (period !== 'weekly') return null;
    const range = getPreviousWeekRange();
    return `${range.from_date} to ${range.to_date}`;
  }, [period]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Owner Weekly Payment Report</h2>
          <p className="text-sm text-slate-400">Per owner trip count and payout due across the selected period.</p>
          {activeRange && (
            <p className="mt-1 text-xs text-sky-300">Last completed week: {activeRange}</p>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:w-64">
            <Select
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { value: '', label: 'All Owners' },
                ...ownerOptions,
              ]}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />
          </div>
        </div>
      </div>

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
              <span className="text-xs uppercase tracking-wide">Net Payout</span>
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

      {selectedOwnerAnalytics && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Breakdown for {selectedOwnerAnalytics.owner_name}</h3>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card padding={false}>
              <div className="border-b border-slate-700/60 px-4 py-3">
                <h4 className="font-semibold text-white">Bus Type Breakdown</h4>
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
          </div>

          <Card padding={false}>
            <div className="border-b border-slate-700/60 px-4 py-3">
              <h4 className="font-semibold text-white">Trip Date & Driver Activity</h4>
            </div>
            <Table headers={['Date', 'Trip', 'Bus Type', 'Driver', 'Status', 'Revenue']} loading={loading} empty={tripRows.length === 0} emptyMessage="No trip activity for selected owner.">
              {tripRows.slice(0, 40).map((trip: any) => (
                <Tr key={`${trip.trip_id}-${trip.travel_date}`}>
                  <Td className="text-slate-300">{trip.travel_date || trip.trip_date || '—'}</Td>
                  <Td className="font-medium text-white">{trip.schedule_code || `Trip #${trip.trip_id}`}</Td>
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
      )}

      {error ? (
        <ErrorState message={error} />
      ) : (
        <Card padding={false}>
          <Table
            headers={['Owner', 'Trips', 'Gross Revenue', 'TDS', 'Net Payout', 'Status']}
            loading={loading}
            empty={!loading && rows.length === 0}
            emptyMessage="No owner payout data for this period."
          >
            {rows.map((row: any) => (
              <Tr key={row.ownerId || row.ownerName}>
                <Td>
                  <div className="font-medium text-white">{row.ownerName}</div>
                </Td>
                <Td className="text-sm text-slate-300">{row.trips}</Td>
                <Td className="text-sm text-emerald-400 font-semibold">{money(row.gross)}</Td>
                <Td className="text-sm text-amber-400">{money(row.tds)}</Td>
                <Td className="text-sm text-sky-400 font-semibold">{money(row.payout)}</Td>
                <Td>
                  <Badge color={row.payout > 0 ? 'green' : 'slate'}>{row.status}</Badge>
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
};
