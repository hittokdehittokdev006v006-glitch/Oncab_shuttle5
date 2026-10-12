import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Users, Shield, UserRound, Truck, Route, MapPin,
  CalendarDays, Ticket, UserCheck, Bus, Package, FileX, RefreshCcw,
  CreditCard, Bell, BarChart3, ClipboardList, Settings, ChevronDown,
  BusFront, X, LogOut, ChevronRight, ChevronLeft, Tag, Loader2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
const ROUTE_PREFIX = (import.meta.env.VITE_ROUTE_PREFIX || '').replace(/\/$/, '');
export type View = 
  | 'dashboard' | 'users' | 'roles' | 'drivers' | 'vehicles' | 'vehicle-docs'
  | 'routes' | 'stops' | 'trips' | 'scheduled-trips'
  | 'locations'
  | 'rate-charts'
  | 'passengers' | 'bookings' | 'passes' | 'cancelled-tickets' | 'refunds'
  | 'failed-refunds' | 'paid-refunds' | 'payments' | 'notifications'
  | 'coupons' | 'reports' | 'audit-logs' | 'settings' | 'owner-requests';

interface NavItem {
  id: View;
  label: string;
  icon: React.ElementType;
  permission?: string;
  badge?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.read' },
    ]
  },
  {
    title: 'Administration',
    items: [
      { id: 'users', label: 'Users', icon: Users, permission: 'users.read' },
      { id: 'roles', label: 'Roles & Permissions', icon: Shield, permission: 'roles.read' },
      { id: 'owner-requests', label: 'Approval Requests', icon: ClipboardList },
    ]
  },
  {
    title: 'Fleet Management',
    items: [
      { id: 'drivers', label: 'Drivers', icon: UserRound, permission: 'drivers.read' },
      { id: 'vehicles', label: 'Vehicles', icon: Truck, permission: 'vehicles.read' },
      { id: 'vehicle-docs', label: 'Vehicle Documents', icon: Package, permission: 'vehicles.read' },
    ]
  },
  {
    title: 'Operations',
    items: [
      { id: 'routes', label: 'Routes', icon: Route, permission: 'routes.read' },
      { id: 'stops', label: 'Stops & Stations', icon: MapPin, permission: 'routes.read' },
      { id: 'trips', label: 'Trips', icon: Bus, permission: 'trips.read' },
      { id: 'scheduled-trips', label: 'Scheduled Trips', icon: CalendarDays, permission: 'schedules.read' },
      { id: 'locations', label: 'Location', icon: MapPin, permission: 'locations.read' },
      { id: 'rate-charts', label: 'Rate Charts', icon: CreditCard, permission: 'rates.read' },
    ]
  },
  {
    title: 'Bookings & Revenue',
    items: [
      { id: 'passengers', label: 'Passengers', icon: UserCheck, permission: 'passengers.read' },
      { id: 'bookings', label: 'Bookings', icon: Ticket, permission: 'bookings.read' },
      { id: 'passes', label: 'Passes', icon: Package, permission: 'passes.read' },
      { id: 'coupons', label: 'Coupons & Discounts', icon: Tag, permission: 'coupons.read' },
      { id: 'payments', label: 'Payments', icon: CreditCard, permission: 'payments.read' },
    ]
  },
  {
    title: 'Cancellations & Refunds',
    items: [
      { id: 'cancelled-tickets', label: 'Cancelled Tickets', icon: FileX, permission: 'bookings.read' },
      { id: 'refunds', label: 'All Refunds', icon: RefreshCcw, permission: 'refunds.read' },
      { id: 'failed-refunds', label: 'Failed Refunds', icon: FileX, permission: 'refunds.read' },
      { id: 'paid-refunds', label: 'Paid Refunds', icon: RefreshCcw, permission: 'refunds.read' },
    ]
  },
  {
    title: 'Communications',
    items: [
      { id: 'notifications', label: 'Notifications', icon: Bell, permission: 'notifications.read' },
    ]
  },
  {
    title: 'Analytics & Logs',
    items: [
      { id: 'reports', label: 'Reports & Analytics', icon: BarChart3, permission: 'reports.read' },
      { id: 'audit-logs', label: 'Audit Logs', icon: ClipboardList, permission: 'audit_logs.read' },
    ]
  },
  {
    title: 'System',
    items: [
      { id: 'settings', label: 'System Settings', icon: Settings, permission: 'settings.manage' },
    ]
  },
];

interface SidebarProps {
  currentView: View;
  onSelectView: (view: View) => void;
  isOpen: boolean;
  onClose: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  unreadNotifications?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  currentView, 
  onSelectView, 
  isOpen, 
  onClose, 
  isCollapsed = false,
  onToggleCollapse,
  unreadNotifications = 0 
}) => {
  const { user, logout, hasPermission } = useAuth();
  const { theme } = useTheme();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [loggingOut, setLoggingOut] = useState(false);

  const toggleGroup = (title: string) => {
    setCollapsedGroups(prev => ({ ...prev, [title]: !prev[title] }));
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await logout(); } finally { setLoggingOut(false); }
  };

  // const handleNav = (id: View) => {
  //   onSelectView(id);
  //   onClose();
  // };
  const handleNav = (id: View) => {
  onSelectView(id);

  const routePath = `${ROUTE_PREFIX}/${id}`.replace(/\/+/g, '/');

  if (window.location.pathname !== routePath) {
    window.history.pushState({}, '', routePath);
  }

  onClose();
};

  const isLight = theme === 'light';
  const roleBadgeColor = user?.role?.name === 'admin' ? '#6366f1' : '#10b981';
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      (item.id !== 'owner-requests' || ['admin', 'owner'].includes(user?.role?.name || '')) &&
      (item.id !== 'vehicle-docs' || user?.role?.name !== 'owner') &&
      (!item.permission || hasPermission(item.permission))
    ),
  })).filter((group) => group.items.length > 0);

  const sidebarWidth = isCollapsed ? '70px' : '260px';

  return (
    <>
      <aside
        className={`fixed top-0 left-0 h-full z-40 flex flex-col transition-all duration-300`}
        style={{
          width: sidebarWidth,
          background: isLight ? '#ffffff' : 'linear-gradient(180deg, #0f172a 0%, #0d1526 100%)',
          borderRight: isLight ? '1px solid #e2e8f0' : '1px solid rgba(99, 102, 241, 0.15)',
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        {/* Brand Header */}
        <div 
          className={`flex items-center ${isCollapsed ? 'justify-center px-2 py-4' : 'justify-between p-4'} border-b`} 
          style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(99, 102, 241, 0.15)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 cursor-pointer shadow-sm" 
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              onClick={onToggleCollapse}
              title={isCollapsed ? 'Click to expand sidebar' : 'OncabShuttle'}
            >
              <BusFront size={20} className="text-white" />
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <div className={`font-bold text-sm ${isLight ? 'text-slate-900' : 'text-white'}`}>OncabShuttle</div>
                <div className={`${isLight ? 'text-slate-500' : 'text-slate-400'} text-xs`}>Management System</div>
              </div>
            )}
          </div>

          {!isCollapsed && onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hidden lg:flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Collapse Sidebar"
            >
              <ChevronLeft size={18} />
            </button>
          )}

          {isCollapsed && onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hidden lg:flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Expand Sidebar"
            >
              <ChevronRight size={18} />
            </button>
          )}

          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* User Card */}
        <div className="p-2.5 border-b" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(99, 102, 241, 0.1)' }}>
          <div 
            className={`flex items-center ${isCollapsed ? 'justify-center p-1.5' : 'gap-3 p-2.5'} rounded-xl`} 
            style={{ background: isLight ? '#f1f5f9' : 'rgba(99, 102, 241, 0.08)' }}
            title={isCollapsed ? user?.name : undefined}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>{user?.name}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium capitalize" style={{ background: `${roleBadgeColor}20`, color: roleBadgeColor }}>
                    {user?.role?.display_name || user?.role?.name || 'User'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto py-2 ${isCollapsed ? 'px-1.5' : 'px-2'}`} style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(99,102,241,0.2) transparent' }}>
          {visibleGroups.map((group) => (
            <div key={group.title} className="mb-1">
              {!isCollapsed ? (
                <button
                  onClick={() => toggleGroup(group.title)}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-slate-300"
                  style={{ color: isLight ? '#94a3b8' : 'rgba(148, 163, 184, 0.6)' }}
                >
                  <span>{group.title}</span>
                  <ChevronDown size={12} className={`transition-transform ${collapsedGroups[group.title] ? '-rotate-90' : ''}`} />
                </button>
              ) : (
                <div className="my-1.5 border-t border-slate-200/50 dark:border-slate-800/80" />
              )}

              {(!collapsedGroups[group.title] || isCollapsed) && (
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentView === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNav(item.id)}
                        title={isCollapsed ? item.label : undefined}
                        className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2'} rounded-lg text-sm transition-all group relative`}
                        style={{
                          background: isActive
                            ? (isLight ? '#ede9fe' : 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15))')
                            : 'transparent',
                          color: isActive
                            ? (isLight ? '#4f46e5' : '#a5b4fc')
                            : (isLight ? '#475569' : '#94a3b8'),
                          borderLeft: !isCollapsed && isActive ? '2px solid #6366f1' : '2px solid transparent',
                        }}
                      >
                        <Icon size={18} style={{ color: isActive ? '#6366f1' : (isLight ? '#64748b' : '#64748b') }} />
                        {!isCollapsed && <span className="flex-1 text-left font-medium truncate">{item.label}</span>}
                        {item.id === 'notifications' && unreadNotifications > 0 && (
                          <span className={`${isCollapsed ? 'absolute -top-1 -right-1 text-[10px] w-4 h-4' : 'text-xs px-1.5 py-0.5'} rounded-full text-white font-bold flex items-center justify-center`} style={{ background: '#ef4444' }}>
                            {unreadNotifications}
                          </span>
                        )}
                        {!isCollapsed && isActive && <ChevronRight size={14} style={{ color: '#6366f1' }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-2.5 border-t" style={{ borderColor: isLight ? '#e2e8f0' : 'rgba(99, 102, 241, 0.15)' }}>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title={isCollapsed ? 'Sign Out' : undefined}
            className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'} rounded-lg text-sm transition-all`}
            style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.08)' }}
          >
            {loggingOut ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
            {!isCollapsed && <span className="font-medium">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        />
      )}
    </>
  );
};
