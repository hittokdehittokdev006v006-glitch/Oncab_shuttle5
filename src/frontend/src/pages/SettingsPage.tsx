import React, { useState, useEffect } from 'react';
import { settingsAPI, vehiclesAPI } from '../services/api';
import { Card, Button, Input, Select } from '../components/ui';
import { Settings, Shield, Bell, Key, Save, CheckCircle, Database, Banknote, Calculator, Bus, Truck } from 'lucide-react';

interface SettingsPageProps {
  onNotify: (msg: string, type?: any) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onNotify }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'payment' | 'notifications' | 'booking' | 'settlement'>('general');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busRate, setBusRate] = useState<string>('3000');
  const [travellerRate, setTravellerRate] = useState<string>('1900');
  const [customRates, setCustomRates] = useState<Record<string, string>>({});
  const [busTypes, setBusTypes] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({
    site_name: 'City Shuttle Express',
    support_email: 'support@cityshuttle.com',
    support_phone: '+91 98765 43210',
    currency: 'INR',
    currency_symbol: '₹',
    payu_refund_mode: 'standard',
    refund_admin_approval_required: 'true',
    bus_stop_search_radius_km: '1',
    cancellation_fee_percentage: '10',
    allow_cancellation_hours: '2',
    sms_gateway_enabled: 'true',
    email_alerts_enabled: 'true',
    max_advance_booking_days: '30',
    owner_settlement_tds_percentage: '2.00',
    owner_trip_rates_by_bus_type: '{"bus":3000,"traveller":1900}',
  });

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const resp = await settingsAPI.list();
      const savedSettings = Array.isArray(resp.data.data)
        ? resp.data.data
        : resp.data.data?.settings || [];
      if (savedSettings.length) {
        const map: Record<string, string> = {};
        savedSettings.forEach((s: any) => {
          if (!['razorpay_key_id', 'razorpay_secret'].includes(s.key)) {
            map[s.key] = s.value;
            if (s.key === 'owner_trip_rates_by_bus_type') {
              try {
                const parsed = typeof s.value === 'object' ? s.value : JSON.parse(s.value);
                if (parsed && typeof parsed === 'object') {
                  if (parsed.bus !== undefined) setBusRate(String(parsed.bus));
                  if (parsed.traveller !== undefined) setTravellerRate(String(parsed.traveller));
                  const rest: Record<string, string> = {};
                  Object.entries(parsed).forEach(([k, v]) => {
                    if (k !== 'bus' && k !== 'traveller') rest[k] = String(v);
                  });
                  setCustomRates(rest);
                }
              } catch {}
            }
          }
        });
        setSettings((prev) => ({ ...prev, ...map }));
      }
    } catch (e: any) {
      // Use fallback defaults if not seeded yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    vehiclesAPI.busTypes().then((res) => setBusTypes(res.data.data || [])).catch(() => {});
  }, []);

  const handleChange = (key: string, val: string) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const searchRadiusKm = Number(settings.bus_stop_search_radius_km);
    if (!Number.isFinite(searchRadiusKm) || searchRadiusKm <= 0) {
      onNotify('Search radius must be a number greater than 0 km', 'error');
      return;
    }

    const tdsPct = Number(settings.owner_settlement_tds_percentage);
    if (!Number.isFinite(tdsPct) || tdsPct < 0 || tdsPct > 50) {
      onNotify('Owner Settlement TDS Percentage must be between 0% and 50%', 'error');
      return;
    }

    const parsedBus = parseFloat(busRate);
    if (!Number.isFinite(parsedBus) || parsedBus < 0) {
      onNotify('Bus Trip Rate must be a valid positive number', 'error');
      return;
    }

    const parsedTraveller = parseFloat(travellerRate);
    if (!Number.isFinite(parsedTraveller) || parsedTraveller < 0) {
      onNotify('Traveller Trip Rate must be a valid positive number', 'error');
      return;
    }

    const updatedRates: Record<string, number> = {
      ...Object.fromEntries(Object.entries(customRates).map(([k, v]) => [k, parseFloat(v) || 0])),
      bus: parsedBus,
      traveller: parsedTraveller,
    };
    const tripRatesJson = JSON.stringify(updatedRates);

    setSaving(true);
    try {
      const payload = Object.entries({
        ...settings,
        owner_trip_rates_by_bus_type: tripRatesJson,
      })
        .filter(([key]) => !['razorpay_key_id', 'razorpay_secret'].includes(key))
        .map(([key, value]) => {
          if (key === 'refund_admin_approval_required') {
            return { key, value, type: 'boolean', group: 'refund', label: 'Require Admin Approval for Refunds', description: 'When enabled, PayU (bank) refunds wait for admin approval. When disabled, the refund is initiated with PayU automatically as soon as the user cancels.' };
          }
          if (key === 'payu_refund_mode') {
            return { key, value, type: 'string', group: 'payment', label: 'PayU Refund Mode', description: 'Select whether PayU refunds are submitted immediately or handled through the standard refund flow.' };
          }
          if (key === 'bus_stop_search_radius_km') {
            return { key, value, type: 'number', group: 'booking', label: 'Pickup and Dropoff Search Radius (km)', description: 'Maximum straight-line distance from both requested coordinates to their matching route stops.' };
          }
          if (key === 'owner_settlement_tds_percentage') {
            return { key, value, type: 'number', group: 'settlement', label: 'Owner Settlement TDS Percentage (%)', description: 'Statutory Tax Deducted at Source (TDS) percentage automatically applied to owner ticket fare settlements (Section 194C/194O)' };
          }
          if (key === 'owner_trip_rates_by_bus_type') {
            return { key, value: tripRatesJson, type: 'json', group: 'settlement', label: 'Owner Trip Rates by Bus Type', description: 'Per-trip payout amount by vehicle/bus type (e.g. bus: 3000, traveller: 1900)' };
          }
          return { key, value };
        });

      if (!payload.some((p) => p.key === 'owner_trip_rates_by_bus_type')) {
        payload.push({
          key: 'owner_trip_rates_by_bus_type',
          value: tripRatesJson,
          type: 'json',
          group: 'settlement',
          label: 'Owner Trip Rates by Bus Type',
          description: 'Per-trip payout amount by vehicle/bus type (e.g. bus: 3000, traveller: 1900)',
        });
      }

      await settingsAPI.bulkUpdate(payload);
      setSettings((prev) => ({ ...prev, owner_trip_rates_by_bus_type: tripRatesJson }));
      onNotify('Settings saved successfully!');
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Settings updated locally');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General & Support', icon: Settings },
    { id: 'settlement', label: 'Settlement & TDS', icon: Banknote },
    { id: 'booking', label: 'Booking & Cancellation', icon: Shield },
    { id: 'payment', label: 'Payment Gateway', icon: Key },
    { id: 'notifications', label: 'Notifications & Alerts', icon: Bell },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">System & Platform Settings</h2>
          <p className="text-slate-400 text-sm">Configure system preferences, payment gateways, and booking rules</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700/60 gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <form onSubmit={handleSave} className="space-y-6">
          {activeTab === 'general' && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-white">General Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Platform / Service Name"
                  value={settings.site_name}
                  onChange={(e) => handleChange('site_name', e.target.value)}
                />
                <Input
                  label="Support Email"
                  type="email"
                  value={settings.support_email}
                  onChange={(e) => handleChange('support_email', e.target.value)}
                />
                <Input
                  label="Support Helpline"
                  value={settings.support_phone}
                  onChange={(e) => handleChange('support_phone', e.target.value)}
                />
                <Input
                  label="Currency Code"
                  value={settings.currency}
                  onChange={(e) => handleChange('currency', e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === 'settlement' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold text-white">Owner Settlements & Statutory TDS</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Configure the Tax Deducted at Source (TDS) percentage automatically applied to all bus owner trip settlements under Indian Income Tax regulations (Section 194C / Section 194O).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <Input
                    label="Owner Settlement TDS Percentage (%)"
                    type="number"
                    step="0.01"
                    min="0"
                    max="50"
                    value={settings.owner_settlement_tds_percentage}
                    onChange={(e) => handleChange('owner_settlement_tds_percentage', e.target.value)}
                    placeholder="2.00"
                    required
                  />
                  <p className="text-xs text-slate-400">
                    Standard transport contractor TDS is <strong>1.00%</strong> for Individual / HUF and <strong>2.00%</strong> for Companies / LLPs. This percentage will be deducted from owner requested amounts to calculate the net payable amount.
                  </p>
                </div>

                {/* Live Preview Card */}
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
                    <Calculator size={15} /> Live Payout Calculation Preview
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-300">
                      <span>Example Requested Amount:</span>
                      <span className="font-semibold text-white">₹10,000.00</span>
                    </div>
                    <div className="flex justify-between text-amber-400">
                      <span>Less: TDS ({settings.owner_settlement_tds_percentage || '0'}%):</span>
                      <span className="font-semibold">-₹{((10000 * (parseFloat(settings.owner_settlement_tds_percentage) || 0)) / 100).toFixed(2)}</span>
                    </div>
                    <div className="border-t border-indigo-500/30 pt-2 flex justify-between text-sm font-bold text-emerald-400">
                      <span>Net Payable to Owner:</span>
                      <span>₹{(10000 - ((10000 * (parseFloat(settings.owner_settlement_tds_percentage) || 0)) / 100)).toFixed(2)}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 italic">
                    All new settlement requests submitted by operators will automatically compute net payable using this configured rate.
                  </p>
                </div>
              </div>

              {/* Trip Rates Bus Type Wise */}
              <div className="pt-6 border-t border-slate-700/60 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Bus className="w-5 h-5 text-indigo-400" />
                      <h3 className="text-base font-semibold text-white">Owner Payout Rates (Per Trip Bus Type Wise)</h3>
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
                        Admin Only
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Set standard rates paid to bus owners for each completed trip according to vehicle category (e.g. Bus: ₹3,000, Traveller: ₹1,900). Owners will see their earned amounts calculated with these rates on the Reports page.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Bus Rate */}
                  <div className="p-4 rounded-xl border border-indigo-500/30 bg-slate-800/60 space-y-3 shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                          <Bus size={18} />
                        </div>
                        <div>
                          <span className="font-semibold text-sm text-white block">Bus</span>
                          <span className="text-[11px] text-slate-400">Standard full-size bus</span>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
                        ₹{Number(busRate || 0).toLocaleString('en-IN')}/trip
                      </span>
                    </div>
                    <Input
                      label="Trip Rate (₹ / trip)"
                      type="number"
                      min="0"
                      step="1"
                      value={busRate}
                      onChange={(e) => setBusRate(e.target.value)}
                      placeholder="3000"
                      required
                    />
                    <p className="text-[11px] text-slate-400">Default rate for full-sized passenger buses per completed trip.</p>
                  </div>

                  {/* Traveller Rate */}
                  <div className="p-4 rounded-xl border border-cyan-500/30 bg-slate-800/60 space-y-3 shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                          <Truck size={18} />
                        </div>
                        <div>
                          <span className="font-semibold text-sm text-white block">Traveller</span>
                          <span className="text-[11px] text-slate-400">Tempo / Mini-bus</span>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-cyan-400 font-bold bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/30">
                        ₹{Number(travellerRate || 0).toLocaleString('en-IN')}/trip
                      </span>
                    </div>
                    <Input
                      label="Trip Rate (₹ / trip)"
                      type="number"
                      min="0"
                      step="1"
                      value={travellerRate}
                      onChange={(e) => setTravellerRate(e.target.value)}
                      placeholder="1900"
                      required
                    />
                    <p className="text-[11px] text-slate-400">Default rate for Force Traveller & mini-buses per completed trip.</p>
                  </div>

                  {/* Dynamic Summary Preview Card */}
                  <div className="p-4 rounded-xl border border-slate-700/60 bg-slate-800/40 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                        <span>Trip Payout Simulation</span>
                        <span className="text-[10px] text-indigo-400 font-normal">Based on current rates</span>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-300">
                          <span>10 Completed Bus Trips:</span>
                          <span className="font-semibold text-white">₹{(10 * (parseFloat(busRate) || 0)).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>10 Completed Traveller Trips:</span>
                          <span className="font-semibold text-white">₹{(10 * (parseFloat(travellerRate) || 0)).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between text-slate-400 pt-2 border-t border-slate-700/50">
                          <span>Gross Payout (20 Trips):</span>
                          <span className="font-bold text-emerald-400">
                            ₹{(10 * (parseFloat(busRate) || 0) + 10 * (parseFloat(travellerRate) || 0)).toLocaleString('en-IN')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-[11px] text-slate-400 italic">
                      These rates apply automatically to owner revenue analytics and weekly settlement requests.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'booking' && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-white">Booking & Cancellation Policies</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Advance Booking Window (Days)"
                  type="number"
                  value={settings.max_advance_booking_days}
                  onChange={(e) => handleChange('max_advance_booking_days', e.target.value)}
                />
                <Input
                  label="Cancellation Cutoff Window (Hours before trip)"
                  type="number"
                  value={settings.allow_cancellation_hours}
                  onChange={(e) => handleChange('allow_cancellation_hours', e.target.value)}
                />
                <Input
                  label="Cancellation Deduction Fee (%)"
                  type="number"
                  value={settings.cancellation_fee_percentage}
                  onChange={(e) => handleChange('cancellation_fee_percentage', e.target.value)}
                />
                <Input
                  label="Pickup and Dropoff Search Radius (km)"
                  type="number"
                  value={settings.bus_stop_search_radius_km}
                  onChange={(e) => handleChange('bus_stop_search_radius_km', e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === 'payment' && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-white">PayU Hosted Checkout</h3>
              <p className="text-sm text-slate-400">PayU merchant credentials are configured on the server and must never be stored or exposed in browser settings.</p>
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
                Set <code>PAYU_KEY</code>, <code>PAYU_SALT</code>, and the PayU checkout/API URLs in the server environment. Use PayU test endpoints until the merchant account is enabled for production.
              </div>
              <div className="max-w-md space-y-2">
                <label className="block text-sm font-medium text-slate-300">PayU Refund Mode</label>
                <Select
                  value={settings.payu_refund_mode || 'standard'}
                  onChange={(value) => handleChange('payu_refund_mode', value)}
                  options={[
                    { value: 'instant', label: 'Instant' },
                    { value: 'standard', label: 'Standard' },
                  ]}
                  placeholder="Select PayU refund mode"
                />
                <p className="text-xs text-slate-400">Instant submits the PayU refund request as soon as an admin processes it. Standard uses PayU’s normal refund flow; final settlement timing is determined by PayU.</p>
              </div>

              <div>
                <label className="flex items-start gap-3 text-slate-300 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.refund_admin_approval_required !== 'false'}
                    onChange={(e) => handleChange('refund_admin_approval_required', e.target.checked ? 'true' : 'false')}
                    className="mt-0.5 w-4 h-4 rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0"
                  />
                  <span>
                    <span className="font-medium text-white">Require admin approval for PayU (bank) refunds</span>
                    <span className="block text-xs text-slate-400 mt-0.5">
                      Enabled: refunds wait for an admin to approve them in the refunds panel. Disabled: the refund is sent to PayU automatically the moment the user cancels — no approval needed.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-white">Alerts & Messaging</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 text-slate-300 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.sms_gateway_enabled === 'true'}
                    onChange={(e) => handleChange('sms_gateway_enabled', e.target.checked ? 'true' : 'false')}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0"
                  />
                  <span>Enable SMS Gateway for OTP & Trip updates</span>
                </label>
                <label className="flex items-center gap-3 text-slate-300 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.email_alerts_enabled === 'true'}
                    onChange={(e) => handleChange('email_alerts_enabled', e.target.checked ? 'true' : 'false')}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0"
                  />
                  <span>Enable Email receipts and automated trip dispatch notifications</span>
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-4 border-t border-slate-700/60">
            <Button type="submit" loading={saving} icon={Save}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
