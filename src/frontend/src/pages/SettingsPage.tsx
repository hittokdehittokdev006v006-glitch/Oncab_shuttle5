import React, { useState, useEffect } from 'react';
import { settingsAPI } from '../services/api';
import { Card, Button, Input, Select } from '../components/ui';
import { Settings, Shield, Bell, Key, Save, CheckCircle, Database } from 'lucide-react';

interface SettingsPageProps {
  onNotify: (msg: string, type?: any) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onNotify }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'payment' | 'notifications' | 'booking'>('general');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({
    site_name: 'City Shuttle Express',
    support_email: 'support@cityshuttle.com',
    support_phone: '+91 98765 43210',
    currency: 'INR',
    currency_symbol: '₹',
    payu_refund_mode: 'standard',
    bus_stop_search_radius_km: '1',
    cancellation_fee_percentage: '10',
    allow_cancellation_hours: '2',
    sms_gateway_enabled: 'true',
    email_alerts_enabled: 'true',
    max_advance_booking_days: '30',
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
          if (!['razorpay_key_id', 'razorpay_secret'].includes(s.key)) map[s.key] = s.value;
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
    setSaving(true);
    try {
      const payload = Object.entries(settings)
        .filter(([key]) => !['razorpay_key_id', 'razorpay_secret'].includes(key))
        .map(([key, value]) => {
          if (key === 'payu_refund_mode') {
            return { key, value, type: 'string', group: 'payment', label: 'PayU Refund Mode', description: 'Select whether PayU refunds are submitted immediately or handled through the standard refund flow.' };
          }
          if (key === 'bus_stop_search_radius_km') {
            return { key, value, type: 'number', group: 'booking', label: 'Pickup and Dropoff Search Radius (km)', description: 'Maximum straight-line distance from both requested coordinates to their matching route stops.' };
          }
          return { key, value };
        });
      await settingsAPI.bulkUpdate(payload);
      onNotify('Settings saved successfully!');
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Settings updated locally');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General & Support', icon: Settings },
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
