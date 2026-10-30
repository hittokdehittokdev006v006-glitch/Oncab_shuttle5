import React from 'react';
import { Loader2, AlertCircle, Search, RefreshCw, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

// ── Loading State ──────────────────────────────────────────
// ── Loading State ──────────────────────────────────────────
export const LoadingState: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400">
    <Loader2 size={32} className="animate-spin mb-3 text-indigo-600 dark:text-indigo-400" />
    <p className="text-sm">{message}</p>
  </div>
);

// ── Error State ────────────────────────────────────────────
export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({ message = 'Something went wrong', onRetry }) => (
  <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400">
    <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
      <AlertCircle size={24} />
    </div>
    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{message}</p>
    {onRetry && (
      <button 
        onClick={onRetry} 
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/60 dark:text-indigo-400 dark:border-indigo-800"
      >
        <RefreshCw size={14} /> Retry
      </button>
    )}
  </div>
);

// ── Empty State ────────────────────────────────────────────
export const EmptyState: React.FC<{ message?: string; description?: string; action?: { label: string; onClick: () => void } }> = ({ message = 'No data found', description, action }) => (
  <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400">
    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-500">
      <Search size={28} />
    </div>
    <p className="text-slate-800 dark:text-white font-medium mb-1">{message}</p>
    {description && <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 text-center max-w-sm">{description}</p>}
    {action && (
      <button 
        onClick={action.onClick} 
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
      >
        <Plus size={14} /> {action.label}
      </button>
    )}
  </div>
);

// ── Card ───────────────────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}
export const Card: React.FC<CardProps> = ({ children, className = '', padding = true }) => (
  <div
    className={`rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm transition-all duration-200 ${padding ? 'p-5' : ''} ${className}`}
  >
    {children}
  </div>
);

// ── Stat Card ──────────────────────────────────────────────
interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
  trend?: { value: number; label: string };
  subtitle?: string;
}
export const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, color = '#6366f1', trend, subtitle }) => (
  <Card>
    <div className="flex items-start justify-between">
      <div>
        <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">{title}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        {subtitle && <p className="text-slate-400 text-xs mt-0.5">{subtitle}</p>}
        {trend && (
          <div className="flex items-center gap-1 mt-1.5">
            <span className="text-xs font-semibold" style={{ color: trend.value >= 0 ? '#10b981' : '#ef4444' }}>
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
            </span>
            <span className="text-slate-400 text-xs">{trend.label}</span>
          </div>
        )}
      </div>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: `${color}15`, color: color }}>
        <Icon size={20} />
      </div>
    </div>
  </Card>
);

// ── Badge ──────────────────────────────────────────────────
interface BadgeProps {
  children: React.ReactNode;
  color?: 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'gray' | 'orange' | 'emerald' | 'slate';
}
const BADGE_COLORS: Record<string, string> = {
  emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60',
  slate: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
  green: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60',
  red: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60',
  yellow: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60',
  blue: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60',
  purple: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800/60',
  gray: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
  orange: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800/60',
};
export const Badge: React.FC<BadgeProps> = ({ children, color = 'gray' }) => {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${BADGE_COLORS[color]}`}>
      {children}
    </span>
  );
};

// ── Status Badge ───────────────────────────────────────────
export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusMap: Record<string, BadgeProps['color']> = {
    Active: 'green', active: 'green', Approve: 'green', confirmed: 'green', paid: 'green', completed: 'green', Online: 'green', Unblock: 'green', Valid: 'green',
    boarded: 'green', Boarded: 'green',
    not_boarded: 'yellow', 'not-boarded': 'yellow', 'Not Boarded': 'yellow',
    no_show: 'purple', 'no-show': 'purple', 'No Show': 'purple',
    Inactive: 'gray', Offline: 'gray', Incomplete: 'gray', pending: 'yellow', Pending: 'yellow', Scheduled: 'blue',
    cancelled: 'red', Cancelled: 'red', failed: 'red', Failed: 'red', Block: 'red', Reject: 'red', Expired: 'red',
    refunded: 'purple', partial_refund: 'purple', processing: 'blue', 'Under Maintenance': 'orange', Delayed: 'orange',
  };
  const labelMap: Record<string, string> = {
    boarded: 'Boarded',
    not_boarded: 'Not Boarded',
    no_show: 'No Show',
    confirmed: 'Confirmed',
    cancelled: 'Cancelled',
    completed: 'Completed',
    pending: 'Pending',
    paid: 'Paid',
    partial_refund: 'Partial Refund',
  };
  return <Badge color={statusMap[status] || 'gray'}>{labelMap[status] || status}</Badge>;
};

// ── Table ──────────────────────────────────────────────────
interface TableProps {
  headers: string[];
  children: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
}
export const Table: React.FC<TableProps> = ({ headers, children, loading, empty, emptyMessage }) => (
  <div className="overflow-x-auto">
    <table className="w-full">
      <thead>
        <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/40">
          {headers.map((h) => (
            <th key={h} className="text-left text-xs font-bold uppercase tracking-wider py-3.5 px-4 text-slate-500 dark:text-slate-400">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {loading ? (
          <tr><td colSpan={headers.length}><LoadingState /></td></tr>
        ) : empty ? (
          <tr><td colSpan={headers.length}><EmptyState message={emptyMessage} /></td></tr>
        ) : children}
      </tbody>
    </table>
  </div>
);

// ── Table Row ──────────────────────────────────────────────
export const Tr: React.FC<{ children: React.ReactNode; onClick?: () => void; className?: string }> = ({ children, onClick, className = '' }) => (
  <tr
    className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${onClick ? 'cursor-pointer' : ''} ${className}`}
    onClick={onClick}
  >
    {children}
  </tr>
);

// ── Table Cell ─────────────────────────────────────────────
export const Td: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <td className={`px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 ${className}`}>{children}</td>
);

// ── Pagination ─────────────────────────────────────────────
interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}
export const Pagination: React.FC<PaginationProps> = ({ page, pages, total, limit, onPageChange }) => {
  if (pages <= 1) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-3.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
      <p className="text-xs text-slate-500 dark:text-slate-400">Showing {from}–{to} of {total} results</p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-lg transition-colors text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 disabled:opacity-30"
        >
          <ChevronLeft size={16} />
        </button>
        {Array.from({ length: Math.min(5, pages) }, (_, i) => {
          const p = page <= 3 ? i + 1 : page - 2 + i;
          if (p < 1 || p > pages) return null;
          const isActive = p === page;
          return (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                isActive 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
              }`}
            >
              {p}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          className="p-1.5 rounded-lg transition-colors text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 disabled:opacity-30"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

// ── Search Input ───────────────────────────────────────────
export const SearchInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string; className?: string }> = ({ value, onChange, placeholder = 'Search...', className = 'w-64' }) => (
  <div className="relative">
    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`pl-9 pr-4 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 ${className}`}
    />
  </div>
);

// ── Button ─────────────────────────────────────────────────
interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  title?: string;
  icon?: React.ElementType;
}
export const Button: React.FC<ButtonProps> = ({ children, onClick, variant = 'primary', size = 'md', disabled, loading, type = 'button', className = '', title, icon: Icon }) => {
  const VARIANTS = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm border-transparent',
    secondary: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60',
    danger: 'bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60',
    ghost: 'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border-transparent',
    outline: 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm',
  };
  const SIZES = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-base gap-2.5',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150 border ${VARIANTS[variant]} ${SIZES[size]} ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 12 : 14} />
      ) : null}
      {children}
    </button>
  );
};

// ── Select ─────────────────────────────────────────────────
interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}
export const Select: React.FC<SelectProps> = ({ value, onChange, options, placeholder, className = '' }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 ${className}`}
  >
    {placeholder && <option value="" className="text-slate-400">{placeholder}</option>}
    {options.map((o) => <option key={o.value} value={o.value} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">{o.label}</option>)}
  </select>
);

// ── Modal ──────────────────────────────────────────────────
interface ModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}
const MODAL_SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
export const Modal: React.FC<ModalProps> = ({ open, isOpen, onClose, title, children, footer, size = 'md' }) => {
  const isVisible = open ?? isOpen ?? false;
  if (!isVisible) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" />
      <div
        className={`relative w-full ${MODAL_SIZES[size]} max-h-[90vh] rounded-2xl overflow-hidden flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl transition-all`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900">
          <h2 className="text-slate-900 dark:text-white font-bold text-base">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 text-slate-700 dark:text-slate-300">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
const X: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ── Input Field ────────────────────────────────────────────
interface InputProps {
  label?: string;
  type?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  className?: string;
}
export const Input: React.FC<InputProps> = ({ label, type = 'text', min, max, step, value, onChange, placeholder, required, error, helperText, disabled, className = '' }) => (
  <div className={`space-y-1.5 ${className}`}>
    {label && (
      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
    )}
    <input
      type={type}
      min={min}
      max={max}
      step={step}
      value={value ?? ''}
      onChange={(e) => {
        if (typeof onChange === 'function') {
          onChange(e.target.value);
        }
      }}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      className={`w-full px-3.5 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border ${
        error ? 'border-rose-500 ring-1 ring-rose-500/20' : 'border-slate-200 dark:border-slate-800'
      } text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
    />
    {helperText && !error && <p className="text-[11px] text-slate-400">{helperText}</p>}
    {error && <p className="text-xs text-rose-500">{error}</p>}
  </div>
);

// ── Confirm Dialog ─────────────────────────────────────────
interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
}
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', variant = 'danger', loading }) => (
  <Modal open={open} onClose={onClose} title={title} size="sm"
    footer={
      <>
        <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>
    }
  >
    <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{message}</p>
  </Modal>
);

// ── Toast ──────────────────────────────────────────────────
interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
}
export const Toast: React.FC<ToastProps> = ({ message, type = 'success' }) => {
  const styles = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
    info: 'bg-indigo-600 text-white',
  };
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-medium ${styles[type]} min-w-[280px] animate-in slide-in-from-bottom-5 duration-200`}
    >
      <div className="w-2 h-2 rounded-full bg-white flex-shrink-0 animate-pulse" />
      {message}
    </div>
  );
};
