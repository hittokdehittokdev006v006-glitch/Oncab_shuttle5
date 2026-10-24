import React, { useState } from 'react';
import { Menu, Bell, Search, RefreshCw, Sun, Moon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { View } from './Sidebar';

const PAGE_TITLES: Record<View, string> = {
  dashboard: 'Dashboard',
  users: 'User Management',
  roles: 'Roles & Permissions',
  drivers: 'Driver Management',
  vehicles: 'Vehicle Management',
  'vehicle-docs': 'Vehicle Documents',
  routes: 'Route Management',
  stops: 'Stops & Stations',
  trips: 'Trip Management',
  'scheduled-trips': 'Scheduled Trips',
  locations: 'Live Location',
  'driver-location-history': 'Driver Location History',
  'rate-charts': 'Rate Charts',
  packages: 'Ride Packages',
  'package-purchases': 'Package Purchases',
  passengers: 'Passenger Management',
  bookings: 'Booking Management',
  passes: 'Passes Management',
  coupons: 'Coupons & Discounts',
  payments: 'Payment Transactions',
  'cancelled-tickets': 'Cancelled Tickets',
  refunds: 'Refund Management',
  'failed-refunds': 'Failed Refunds',
  'paid-refunds': 'Paid Refunds',
  notifications: 'Notifications',
  reports: 'Reports & Analytics',
  'audit-logs': 'Audit Logs',
  'owner-requests': 'Approval Requests',
  banners: 'Banners',
  'payu-webhooks': 'PayU Webhooks',
  'owner-kyc': 'Owner KYC & Bank',
  'owner-settlements': 'Owner Settlements',
  settings: 'System Settings',
};

interface TopbarProps {
  currentView: View;
  onMenuClick: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  unreadNotifications?: number;
  onNavigate: (view: View) => void;
}

export const Topbar: React.FC<TopbarProps> = ({ 
  currentView, 
  onMenuClick, 
  isCollapsed = false,
  onToggleCollapse,
  unreadNotifications = 0, 
  onNavigate 
}) => {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => { setRefreshing(false); window.location.reload(); }, 500);
  };

  const isLight = theme === 'light';

  return (
    <header
      className="fixed top-0 right-0 z-30 flex items-center gap-3 px-4 h-14 transition-[left] duration-300 border-b"
      style={{
        left: isCollapsed ? '70px' : '260px',
        backdropFilter: 'blur(20px)',
        background: isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(10, 15, 30, 0.85)',
        borderColor: isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)',
        color: isLight ? '#0f172a' : '#ffffff',
      }}
    >
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="lg:hidden text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
        title="Open Mobile Navigation"
      >
        <Menu size={20} />
      </button>

      {/* Desktop toggle button */}
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={isCollapsed ? 'Expand Sidebar (260px)' : 'Collapse Sidebar (70px)'}
        >
          {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      )}

      {/* Page title */}
      <div className="flex-1">
        <h1 className="font-semibold text-sm">{PAGE_TITLES[currentView]}</h1>
        <p className="text-slate-500 text-xs hidden sm:block">OncabShuttle Management System</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Light / Dark Mode Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg transition-all flex items-center gap-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700/40 hover:bg-slate-100 dark:hover:bg-slate-800/60"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          {theme === 'dark' ? (
            <>
              <Sun size={16} className="text-amber-400" />
              <span className="text-slate-300 hidden md:inline">Light Mode</span>
            </>
          ) : (
            <>
              <Moon size={16} className="text-indigo-600" />
              <span className="text-slate-700 hidden md:inline">Dark Mode</span>
            </>
          )}
        </button>

        <button
          onClick={handleRefresh}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-2 rounded-lg transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Refresh"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>

        <button
          onClick={() => onNavigate('notifications')}
          className="relative text-slate-400 hover:text-slate-700 dark:hover:text-white p-2 rounded-lg transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Bell size={16} />
          {unreadNotifications > 0 && (
            <span
              className="absolute top-1 right-1 w-4 h-4 text-xs font-bold text-white rounded-full flex items-center justify-center"
              style={{ background: '#ef4444', fontSize: '10px' }}
            >
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </button>

        {/* User avatar */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm text-white cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          title={user?.name}
        >
          {user?.name?.charAt(0)?.toUpperCase() || 'U'}
        </div>
      </div>
    </header>
  );
};
