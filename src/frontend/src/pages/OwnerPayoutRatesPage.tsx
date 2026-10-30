import React, { useEffect, useMemo, useState } from 'react';
import { settingsAPI, vehiclesAPI } from '../services/api';
import { Card, Table, Tr, Td, LoadingState, ErrorState } from '../components/ui';
import { Banknote, Calculator, Truck } from 'lucide-react';

const money = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const prettyLabel = (key: string) => {
  if (!key) return 'Bus Type';
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export const OwnerPayoutRatesPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tds, setTds] = useState(2);
  const [rates, setRates] = useState<Record<string, number>>({
    bus: 3000,
    traveller: 1900,
  });
  const [busTypes, setBusTypes] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [settingsRes, busTypeRes] = await Promise.all([
          settingsAPI.list(),
          vehiclesAPI.busTypes(),
        ]);

        const savedSettings = Array.isArray(settingsRes.data?.data)
          ? settingsRes.data.data
          : settingsRes.data?.data?.settings || [];

        const settingMap: Record<string, any> = {};
        savedSettings.forEach((entry: any) => {
          if (entry && entry.key) settingMap[entry.key] = entry.value;
        });

        const parsedRates = (() => {
          const raw = settingMap.owner_trip_rates_by_bus_type;
          if (!raw) return {};
          try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return parsed && typeof parsed === 'object' ? parsed : {};
          } catch {
            return {};
          }
        })();

        const merged = { bus: 3000, traveller: 1900, ...parsedRates };
        setRates(merged);

        const tdsValue = Number(settingMap.owner_settlement_tds_percentage ?? 2);
        if (Number.isFinite(tdsValue)) setTds(tdsValue);

        setBusTypes(busTypeRes.data?.data || []);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load owner payout rates');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const rows = useMemo(() => {
    const tableRows: Array<{ key: string; label: string; rate: number }> = [];
    const seen = new Set<string>();

    Object.entries(rates).forEach(([key, value]) => {
      const normalizedKey = String(key).trim();
      if (!normalizedKey || !Number.isFinite(Number(value))) return;
      tableRows.push({ key: normalizedKey, label: prettyLabel(normalizedKey), rate: Number(value) });
      seen.add(normalizedKey.toLowerCase());
    });

    if (busTypes.length > 0) {
      busTypes.forEach((busType: any) => {
        const name = String(busType?.name || busType?.bus_type || busType?.label || '').trim();
        if (!name) return;
        const key = name.toLowerCase().replace(/\s+/g, '_');
        if (seen.has(key)) return;
        tableRows.push({
          key,
          label: name,
          rate: Number(rates[key] ?? rates[busType?.name] ?? 0),
        });
      });
    }

    return tableRows.sort((a, b) => b.rate - a.rate);
  }, [rates, busTypes]);

  if (loading) return <LoadingState message="Loading payout rates..." />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Owner Payout Rates</h2>
        <p className="text-sm text-slate-400">Per-trip payout and TDS configuration for each owner vehicle type.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-sm font-medium uppercase tracking-wide">Settlement & TDS</span>
            <Banknote size={16} />
          </div>
          <div className="mt-5 text-3xl font-bold text-white">{tds}%</div>
          <p className="mt-2 text-sm text-slate-400">Tax deducted at source automatically from owner payouts for the selected settlement cycle.</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-sm font-medium uppercase tracking-wide">Payout Rule</span>
            <Calculator size={16} />
          </div>
          <div className="mt-5 text-3xl font-bold text-sky-400">{money(rows[0]?.rate || 0)}</div>
          <p className="mt-2 text-sm text-slate-400">Highest configured rate per trip for a bus type under current payout settings.</p>
        </Card>
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : (
        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
            <div className="flex items-center gap-2 text-white font-medium">
              <Truck size={16} className="text-slate-400" />
              <span>Owner Payout Rates (Per Trip Bus Type Wise)</span>
            </div>
          </div>

          <Table headers={['Bus Type', 'Per Trip Rate', 'Net After TDS']} loading={false} empty={rows.length === 0} emptyMessage="No payout rates configured.">
            {rows.map((row) => {
              const netAfterTds = row.rate * (1 - tds / 100);
              return (
                <Tr key={row.key}>
                  <Td className="font-medium text-white">{row.label}</Td>
                  <Td className="text-emerald-400 font-semibold">{money(row.rate)}</Td>
                  <Td className="text-sky-400 font-semibold">{money(netAfterTds)}</Td>
                </Tr>
              );
            })}
          </Table>
        </Card>
      )}
    </div>
  );
};
