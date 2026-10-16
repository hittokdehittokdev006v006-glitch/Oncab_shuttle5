import React, { useCallback, useEffect, useState } from 'react';
import { 
  Banknote, Search, Plus, CheckCircle, XCircle, Trash2, Eye, RefreshCw, 
  Clock, ShieldAlert, ArrowUpRight, Copy, Check, AlertTriangle, Calculator,
  Building2, Hash, FileText, ChevronRight
} from 'lucide-react';
import { settlementsAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { hasRole } from '../utils/roles';
import { Card, Button, Input, Modal, Badge, LoadingState, ErrorState, EmptyState } from '../components/ui';

interface OwnerSettlementsPageProps {
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
  onNavigateSettings?: () => void;
}

export const OwnerSettlementsPage: React.FC<OwnerSettlementsPageProps> = ({ onNotify, onNavigateSettings }) => {
  const { user } = useAuth();
  const isAdmin = hasRole(user, 'admin');

  // List & Stats state
  const [settlements, setSettlements] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [currentTdsPct, setCurrentTdsPct] = useState<number>(2.00);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewTarget, setViewTarget] = useState<any>(null);
  const [approveTarget, setApproveTarget] = useState<any>(null);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  // Action form state
  const [actionLoading, setActionLoading] = useState(false);
  const [utrNumber, setUtrNumber] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Owner creation form state
  const [ownerConfig, setOwnerConfig] = useState<any>({ vehicles: [], kyc: null, tds_percentage: 2.00 });
  const [createForm, setCreateForm] = useState({
    vehicle_id: '',
    vehicle_number: '',
    requested_amount: '',
    account_number: '',
    bank_name: '',
    ifsc_code: '',
    account_holder_name: '',
    upi_id: '',
    owner_notes: '',
  });

  // Fetch settlements list & stats
  const fetchSettlements = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const resp = await settlementsAPI.list({
        status: statusFilter,
        search: searchTerm.trim() || undefined,
      });
      setSettlements(resp.data.data || []);
      setStats(resp.data.stats || {});
      if (resp.data.current_tds_percentage !== undefined) {
        setCurrentTdsPct(resp.data.current_tds_percentage);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load settlements');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm]);

  // Fetch owner config (vehicles & KYC bank details)
  const fetchOwnerConfig = useCallback(async () => {
    try {
      const resp = await settlementsAPI.getConfig();
      const cfg = resp.data.data || {};
      setOwnerConfig(cfg);
      if (cfg.tds_percentage !== undefined) {
        setCurrentTdsPct(cfg.tds_percentage);
      }

      // Pre-populate owner create form with KYC defaults if available
      if (cfg.kyc) {
        setCreateForm((prev) => ({
          ...prev,
          account_number: prev.account_number || cfg.kyc.account_number || '',
          bank_name: prev.bank_name || cfg.kyc.bank_name || '',
          ifsc_code: prev.ifsc_code || cfg.kyc.ifsc_code || '',
          account_holder_name: prev.account_holder_name || cfg.kyc.account_holder_name || '',
          upi_id: prev.upi_id || cfg.kyc.upi_id || '',
        }));
      }

      // Auto-select first vehicle if available
      if (cfg.vehicles && cfg.vehicles.length > 0) {
        setCreateForm((prev) => ({
          ...prev,
          vehicle_id: prev.vehicle_id || String(cfg.vehicles[0].id),
          vehicle_number: prev.vehicle_number || cfg.vehicles[0].registration_number,
        }));
      }
    } catch {
      // Ignore if config lookup fails
    }
  }, []);

  useEffect(() => {
    fetchSettlements();
  }, [fetchSettlements]);

  useEffect(() => {
    fetchOwnerConfig();
  }, [fetchOwnerConfig]);

  // Copy helper
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    onNotify('Copied to clipboard', 'info');
  };

  // Submit new settlement request (Owner)
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const reqAmount = parseFloat(createForm.requested_amount);
    if (!Number.isFinite(reqAmount) || reqAmount <= 0) {
      onNotify('Please enter a valid requested amount greater than ₹0', 'error');
      return;
    }
    if (!createForm.vehicle_number) {
      onNotify('Please select or specify a vehicle number', 'error');
      return;
    }
    if (!createForm.account_number || !createForm.bank_name || !createForm.ifsc_code) {
      onNotify('Bank name, account number, and IFSC code are required', 'error');
      return;
    }

    setActionLoading(true);
    try {
      const resp = await settlementsAPI.create({
        vehicle_id: createForm.vehicle_id ? Number(createForm.vehicle_id) : undefined,
        vehicle_number: createForm.vehicle_number,
        requested_amount: reqAmount,
        account_number: createForm.account_number,
        bank_name: createForm.bank_name,
        ifsc_code: createForm.ifsc_code,
        account_holder_name: createForm.account_holder_name,
        upi_id: createForm.upi_id,
        owner_notes: createForm.owner_notes,
      });
      onNotify(resp.data?.message || 'Settlement request submitted successfully!', 'success');
      setShowCreateModal(false);
      setCreateForm((prev) => ({
        ...prev,
        requested_amount: '',
        owner_notes: '',
      }));
      await fetchSettlements();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to submit settlement request', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin Action: Approve Settlement
  const handleApprove = async () => {
    if (!approveTarget) return;
    setActionLoading(true);
    try {
      await settlementsAPI.updateStatus(approveTarget.id, {
        status: 'approved',
        utr_number: utrNumber.trim() || undefined,
        admin_note: adminNote.trim() || undefined,
      });
      onNotify(`Settlement ${approveTarget.settlement_code} approved successfully!`, 'success');
      setApproveTarget(null);
      setUtrNumber('');
      setAdminNote('');
      await fetchSettlements();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to approve settlement', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin Action: Reject Settlement
  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectionReason.trim()) {
      onNotify('Please provide a reason for rejecting this settlement', 'error');
      return;
    }
    setActionLoading(true);
    try {
      await settlementsAPI.updateStatus(rejectTarget.id, {
        status: 'rejected',
        admin_note: rejectionReason.trim(),
      });
      onNotify(`Settlement ${rejectTarget.settlement_code} rejected`, 'info');
      setRejectTarget(null);
      setRejectionReason('');
      await fetchSettlements();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to reject settlement', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin Action: Permanently Delete Settlement
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await settlementsAPI.delete(deleteTarget.id);
      onNotify(`Settlement ${deleteTarget.settlement_code} permanently removed from both panels`, 'success');
      setDeleteTarget(null);
      await fetchSettlements();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to delete settlement request', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Live calculation for the owner creation modal
  const liveRequestedAmt = parseFloat(createForm.requested_amount) || 0;
  const liveTdsAmt = Number(((liveRequestedAmt * currentTdsPct) / 100).toFixed(2));
  const liveNetAmt = Number((liveRequestedAmt - liveTdsAmt).toFixed(2));

  return (
    <div className="space-y-6">
      {/* Page Title & Top Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-white tracking-tight">
              {isAdmin ? 'Owner Settlements & Payouts' : 'My Settlement Requests'}
            </h2>
            <Badge color="blue">TDS Rate: {currentTdsPct}%</Badge>
          </div>
          <p className="text-slate-400 text-xs mt-1">
            {isAdmin
              ? 'Review operator earnings, calculate statutory TDS, approve transfers, and manage bank payouts'
              : 'Submit earnings settlement requests, track TDS deductions, and monitor bank transfer statuses'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="sm" onClick={fetchSettlements} disabled={loading} title="Refresh data">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>

          {!isAdmin && (
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus size={15} /> Request Settlement
            </Button>
          )}

          {isAdmin && onNavigateSettings && (
            <Button variant="secondary" size="sm" onClick={onNavigateSettings}>
              <Calculator size={14} /> Configure TDS %
            </Button>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-indigo-500 bg-slate-900/60 p-4">
          <div className="text-xs text-slate-400 font-medium">Total Requested Amount</div>
          <div className="text-lg sm:text-xl font-bold text-white mt-1">
            ₹{(stats.total_requested || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            Gross submitted claims
          </div>
        </Card>

        <Card className="border-l-4 border-l-amber-500 bg-slate-900/60 p-4">
          <div className="text-xs text-slate-400 font-medium flex items-center justify-between">
            <span>Statutory TDS Deducted</span>
            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono">{currentTdsPct}%</span>
          </div>
          <div className="text-lg sm:text-xl font-bold text-amber-400 mt-1">
            ₹{(stats.total_tds || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Section 194C / 194O tax
          </div>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 bg-slate-900/60 p-4">
          <div className="text-xs text-slate-400 font-medium">Net Payable Payout</div>
          <div className="text-lg sm:text-xl font-bold text-emerald-400 mt-1">
            ₹{(stats.total_net_payable || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Net transfer amount
          </div>
        </Card>

        <Card className="border-l-4 border-l-purple-500 bg-slate-900/60 p-4">
          <div className="text-xs text-slate-400 font-medium flex items-center justify-between">
            <span>Pending Approvals</span>
            <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-bold">{stats.pending_count || 0}</span>
          </div>
          <div className="text-lg sm:text-xl font-bold text-purple-300 mt-1">
            ₹{(stats.pending_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Awaiting bank verification
          </div>
        </Card>
      </div>

      {/* Filter Tabs & Search Bar */}
      <Card className="p-3 bg-slate-900/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-950/70 rounded-xl border border-slate-800">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all ${
                  statusFilter === tab
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {tab === 'all' ? 'All Requests' : tab}
                {tab === 'pending' && stats.pending_count > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/30 text-amber-200">
                    {stats.pending_count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by owner, vehicle, account, IFSC, or STL code..."
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>
      </Card>

      {/* Main Settlements Table */}
      {loading && settlements.length === 0 ? (
        <LoadingState message="Loading owner settlement records..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchSettlements} />
      ) : settlements.length === 0 ? (
        <EmptyState
          message="No settlement requests found"
          description={
            searchTerm
              ? `No results matching "${searchTerm}". Try resetting search or status filters.`
              : isAdmin
              ? 'No operator payout settlements have been requested yet.'
              : 'You have not submitted any settlement requests yet. Click below to request your first payout.'
          }
          action={
            !isAdmin
              ? {
                  label: 'Request Settlement',
                  onClick: () => setShowCreateModal(true),
                }
              : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden p-0 border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-3 px-4">Settlement Code</th>
                  <th className="py-3 px-4">Owner Name</th>
                  <th className="py-3 px-4">Vehicle Number</th>
                  <th className="py-3 px-4">Bank Details</th>
                  <th className="py-3 px-4 text-right">Requested Amount</th>
                  <th className="py-3 px-4 text-right">TDS Rate</th>
                  <th className="py-3 px-4 text-right">Net Payable</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {settlements.map((s) => {
                  const reqAmt = parseFloat(s.requested_amount) || 0;
                  const tdsAmt = parseFloat(s.tds_amount) || 0;
                  const netAmt = parseFloat(s.net_payable_amount) || 0;

                  return (
                    <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                      {/* Settlement Code & Date */}
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <span>{s.settlement_code}</span>
                          <button
                            onClick={() => copyToClipboard(s.settlement_code, `code-${s.id}`)}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                            title="Copy code"
                          >
                            {copiedId === `code-${s.id}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(s.created_at).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                      </td>

                      {/* Owner Name */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-white">{s.owner_name}</div>
                        <div className="text-[11px] text-slate-400">{s.owner_mobile || s.owner_email || '—'}</div>
                      </td>

                      {/* Vehicle Number */}
                      <td className="py-3.5 px-4">
                        <span className="inline-block px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-800 text-slate-200 border border-slate-700">
                          {s.vehicle_number}
                        </span>
                      </td>

                      {/* Bank Details */}
                      <td className="py-3.5 px-4 text-slate-300">
                        <div className="font-medium text-slate-200 flex items-center gap-1">
                          <Building2 size={12} className="text-slate-400" />
                          <span>{s.bank_name}</span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                          <span>A/C: {s.account_number}</span>
                          <button
                            onClick={() => copyToClipboard(s.account_number, `acc-${s.id}`)}
                            className="text-slate-500 hover:text-slate-300"
                            title="Copy account number"
                          >
                            {copiedId === `acc-${s.id}` ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                          </button>
                        </div>
                        <div className="font-mono text-[10px] text-slate-400">IFSC: {s.ifsc_code}</div>
                      </td>

                      {/* Requested Amount (Gross) */}
                      <td className="py-3.5 px-4 text-right font-medium text-slate-200">
                        ₹{reqAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      {/* TDS */}
                      <td className="py-3.5 px-4 text-right font-medium text-amber-400">
                        <div>{s.tds_percentage}%</div>
                        <div className="text-[10px] text-amber-500/80 font-mono">-₹{tdsAmt.toFixed(2)}</div>
                      </td>

                      {/* Net Payable */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="font-bold text-emerald-400 text-sm">
                          ₹{netAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                        {s.utr_number && (
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[120px] ml-auto" title={`UTR: ${s.utr_number}`}>
                            UTR: {s.utr_number}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        {s.status === 'approved' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle size={11} /> Approved
                          </span>
                        )}
                        {s.status === 'rejected' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle size={11} /> Rejected
                          </span>
                        )}
                        {s.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <Clock size={11} /> Pending
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setViewTarget(s)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            title="View Full Breakdown & Details"
                          >
                            <Eye size={14} />
                          </button>

                          {isAdmin && s.status === 'pending' && (
                            <>
                              <button
                                onClick={() => {
                                  setApproveTarget(s);
                                  setUtrNumber('');
                                  setAdminNote('');
                                }}
                                className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 transition-colors"
                                title="Approve Settlement & Enter UTR"
                              >
                                <CheckCircle size={14} />
                              </button>

                              <button
                                onClick={() => {
                                  setRejectTarget(s);
                                  setRejectionReason('');
                                }}
                                className="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-950/40 transition-colors"
                                title="Reject Settlement Request"
                              >
                                <XCircle size={14} />
                              </button>
                            </>
                          )}

                          {isAdmin && (
                            <button
                              onClick={() => setDeleteTarget(s)}
                              className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors"
                              title="Permanently Delete Settlement"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Modal 1: Owner "Request Settlement" Modal ─────────── */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Request Owner Payout Settlement"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSubmit} loading={actionLoading}>
              <Check size={14} /> Submit Request
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 p-3 text-xs text-indigo-300">
            <strong>Settlement Process:</strong> Enter your requested payout amount. Statutory TDS ({currentTdsPct}%) will be calculated automatically, and the net payout will be verified and transferred by admin to your bank account.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Vehicle Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Select Vehicle <span className="text-rose-400">*</span>
              </label>
              {ownerConfig.vehicles && ownerConfig.vehicles.length > 0 ? (
                <select
                  value={createForm.vehicle_id}
                  onChange={(e) => {
                    const selId = e.target.value;
                    const v = ownerConfig.vehicles.find((veh: any) => String(veh.id) === selId);
                    setCreateForm((prev) => ({
                      ...prev,
                      vehicle_id: selId,
                      vehicle_number: v ? v.registration_number : prev.vehicle_number,
                    }));
                  }}
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  required
                >
                  {ownerConfig.vehicles.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {v.registration_number} — {v.company_model || 'Bus'}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  placeholder="e.g. WB-04-1234"
                  value={createForm.vehicle_number}
                  onChange={(e) => setCreateForm({ ...createForm, vehicle_number: e.target.value.toUpperCase() })}
                  required
                />
              )}
            </div>

            {/* Requested Amount */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Requested Amount (₹) <span className="text-rose-400">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="1"
                placeholder="e.g. 25000"
                value={createForm.requested_amount}
                onChange={(e) => setCreateForm({ ...createForm, requested_amount: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Live Calculation Box */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-400 font-medium">
              <span>Gross Claim Amount:</span>
              <span className="font-semibold text-white">₹{liveRequestedAmt.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-amber-400">
              <span>Less: Statutory TDS ({currentTdsPct}%):</span>
              <span className="font-semibold font-mono">-₹{liveTdsAmt.toFixed(2)}</span>
            </div>
            <div className="border-t border-slate-800 pt-2 flex items-center justify-between text-sm font-bold text-emerald-400">
              <span>Estimated Net Payout:</span>
              <span>₹{liveNetAmt.toFixed(2)}</span>
            </div>
          </div>

          {/* Bank Account Details */}
          <div className="pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-300">Bank Transfer Account Details</span>
              {ownerConfig.kyc && (
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                  Verified from KYC
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <Input
                label="Bank Name"
                placeholder="e.g. State Bank of India"
                value={createForm.bank_name}
                onChange={(e) => setCreateForm({ ...createForm, bank_name: e.target.value })}
                required
              />
              <Input
                label="Account Number"
                placeholder="e.g. 123456789012"
                value={createForm.account_number}
                onChange={(e) => setCreateForm({ ...createForm, account_number: e.target.value })}
                required
              />
              <Input
                label="IFSC Code"
                placeholder="e.g. SBIN0001234"
                value={createForm.ifsc_code}
                onChange={(e) => setCreateForm({ ...createForm, ifsc_code: e.target.value.toUpperCase() })}
                required
              />
              <Input
                label="Account Holder Name"
                placeholder="e.g. John Doe"
                value={createForm.account_holder_name}
                onChange={(e) => setCreateForm({ ...createForm, account_holder_name: e.target.value })}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Trip / Operator Notes (Optional)</label>
            <textarea
              value={createForm.owner_notes}
              onChange={(e) => setCreateForm({ ...createForm, owner_notes: e.target.value })}
              placeholder="e.g. Weekly settlement for Kolkata-Durgapur routes (October 1-7)"
              rows={2}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </form>
      </Modal>

      {/* ── Modal 2: View Settlement Details Modal ───────────── */}
      <Modal
        open={!!viewTarget}
        onClose={() => setViewTarget(null)}
        title={`Settlement Details: ${viewTarget?.settlement_code || ''}`}
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setViewTarget(null)}>
            Close
          </Button>
        }
      >
        {viewTarget && (
          <div className="space-y-4 text-xs">
            {/* Top Stat Banner */}
            <div className="rounded-xl bg-gradient-to-r from-slate-900 to-indigo-950/40 border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Net Transfer Amount</span>
                <div className="text-2xl font-extrabold text-emerald-400 mt-0.5">
                  ₹{parseFloat(viewTarget.net_payable_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Current Status</span>
                <div className="mt-1">
                  {viewTarget.status === 'approved' && <Badge color="green">Approved & Settled</Badge>}
                  {viewTarget.status === 'rejected' && <Badge color="red">Rejected</Badge>}
                  {viewTarget.status === 'pending' && <Badge color="yellow">Awaiting Approval</Badge>}
                </div>
              </div>
            </div>

            {/* Financial Breakdown Table */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
              <div className="font-semibold text-white text-xs border-b border-slate-800 pb-2">Financial Breakdown</div>
              <div className="flex justify-between text-slate-300">
                <span>Requested Amount (Gross):</span>
                <span className="font-semibold text-white">₹{parseFloat(viewTarget.requested_amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-amber-400">
                <span>Statutory TDS Deduction ({viewTarget.tds_percentage}%):</span>
                <span className="font-semibold font-mono">-₹{parseFloat(viewTarget.tds_amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-emerald-400 font-bold border-t border-slate-800 pt-2 text-sm">
                <span>Net Amount to Bank:</span>
                <span>₹{parseFloat(viewTarget.net_payable_amount).toFixed(2)}</span>
              </div>
            </div>

            {/* Bank Transfer Credentials */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
              <div className="font-semibold text-white text-xs border-b border-slate-800 pb-2">Beneficiary Bank Account</div>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-400 block text-[10px]">Bank Name</span>
                  <span className="font-medium text-white">{viewTarget.bank_name}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Account Number</span>
                  <span className="font-mono font-medium text-white">{viewTarget.account_number}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">IFSC Code</span>
                  <span className="font-mono font-medium text-white">{viewTarget.ifsc_code}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Account Holder</span>
                  <span className="font-medium text-white">{viewTarget.account_holder_name || viewTarget.owner_name}</span>
                </div>
              </div>
            </div>

            {/* Meta & Audit Info */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2 text-slate-300">
              <div className="font-semibold text-white text-xs border-b border-slate-800 pb-2">Audit & Settlement Trail</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400 block text-[10px]">Vehicle</span>
                  <span className="font-mono text-white">{viewTarget.vehicle_number}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Submitted At</span>
                  <span className="text-white">{new Date(viewTarget.created_at).toLocaleString('en-IN')}</span>
                </div>
                {viewTarget.utr_number && (
                  <div className="col-span-2">
                    <span className="text-slate-400 block text-[10px]">Bank UTR / Transaction Reference</span>
                    <span className="font-mono font-bold text-emerald-400">{viewTarget.utr_number}</span>
                  </div>
                )}
                {viewTarget.admin_note && (
                  <div className="col-span-2">
                    <span className="text-slate-400 block text-[10px]">Admin Remarks / Rejection Reason</span>
                    <p className="text-slate-200 bg-slate-900 p-2 rounded-lg mt-0.5">{viewTarget.admin_note}</p>
                  </div>
                )}
                {viewTarget.owner_notes && (
                  <div className="col-span-2">
                    <span className="text-slate-400 block text-[10px]">Owner Submitted Note</span>
                    <p className="text-slate-300 bg-slate-900 p-2 rounded-lg mt-0.5">{viewTarget.owner_notes}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal 3: Admin Approve Confirmation Dialog ───────── */}
      <Modal
        open={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        title="Approve Settlement & Transfer Payout"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setApproveTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleApprove} loading={actionLoading}>
              <CheckCircle size={14} /> Confirm Approval
            </Button>
          </>
        }
      >
        {approveTarget && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3.5 space-y-1 text-emerald-300">
              <div className="font-bold text-sm text-emerald-400">
                Confirm Net Payout: ₹{parseFloat(approveTarget.net_payable_amount).toFixed(2)}
              </div>
              <p className="text-slate-400">
                Settlement for <strong>{approveTarget.owner_name}</strong> (Vehicle: <strong>{approveTarget.vehicle_number}</strong>)
              </p>
              <p className="text-slate-400">
                To Account: <strong>{approveTarget.bank_name}</strong> — {approveTarget.account_number} ({approveTarget.ifsc_code})
              </p>
            </div>

            <Input
              label="Bank UTR / Transaction Reference (Optional)"
              placeholder="e.g. UTR123456789012"
              value={utrNumber}
              onChange={(e) => setUtrNumber(e.target.value)}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Admin Approval Note (Optional)</label>
              <textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="e.g. Verified and processed via NEFT / IMPS"
                rows={2}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal 4: Admin Reject Confirmation Dialog ────────── */}
      <Modal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject Settlement Request"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleReject} loading={actionLoading} className="bg-rose-600 hover:bg-rose-700 text-white">
              <XCircle size={14} /> Reject Request
            </Button>
          </>
        }
      >
        {rejectTarget && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-rose-300">
              You are rejecting settlement request <strong>{rejectTarget.settlement_code}</strong> for <strong>{rejectTarget.owner_name}</strong> of ₹{parseFloat(rejectTarget.requested_amount).toFixed(2)}.
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Rejection Reason <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Please state why this request is being rejected (e.g. Bank details mismatch, trip earnings discrepancy, etc.)"
                rows={3}
                required
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal 5: Admin Permanent Delete Confirmation Dialog ─ */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Permanently Delete Settlement"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleDelete} loading={actionLoading} className="bg-rose-600 hover:bg-rose-700 text-white">
              <Trash2 size={14} /> Permanently Delete
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div className="space-y-3 text-xs">
            <div className="rounded-xl bg-rose-950/40 border border-rose-600/40 p-3.5 space-y-2 text-rose-200">
              <div className="flex items-center gap-2 font-bold text-rose-400 text-sm">
                <AlertTriangle size={18} /> Permanent Record Removal
              </div>
              <p>
                Are you sure you want to permanently delete settlement record <strong>{deleteTarget.settlement_code}</strong>?
              </p>
              <p className="text-slate-300 text-[11px]">
                This will completely remove the record from the database. It will immediately disappear from both the admin and owner panels. This action <strong>cannot be undone</strong>.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
