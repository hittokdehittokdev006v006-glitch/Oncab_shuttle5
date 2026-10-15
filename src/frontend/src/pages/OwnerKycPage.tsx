import React, { useState, useEffect, useCallback } from 'react';
import { ownerKycAPI } from '../services/api';
import { Card, Table, Tr, Td, Button, LoadingState, ErrorState, StatusBadge, Badge, Select } from '../components/ui';
import {
  ShieldCheck,
  Building,
  CreditCard,
  User,
  Phone,
  Mail,
  Car,
  CheckCircle2,
  AlertCircle,
  Clock,
  Lock,
  Search,
  Filter,
  RefreshCw,
  XCircle,
  FileCheck,
  Check,
  Info,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasRole } from '../utils/roles';

interface OwnerKycPageProps {
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const OwnerKycPage: React.FC<OwnerKycPageProps> = ({ onNotify }) => {
  const { user } = useAuth();
  const isAdmin = hasRole(user, 'admin');

  // Active view tab for Admin: 'form' (or my KYC) vs 'admin_list' (all submissions)
  const [activeTab, setActiveTab] = useState<'form' | 'admin_list'>(isAdmin ? 'admin_list' : 'form');

  // Loading & Error states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Auto-fetched profile data
  const [ownerProfile, setOwnerProfile] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [existingKyc, setExistingKyc] = useState<any>(null);

  // Form states
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [upiId, setUpiId] = useState('');

  // Field validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Admin list states
  const [adminKycs, setAdminKycs] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [reviewModalKyc, setReviewModalKyc] = useState<any>(null);
  const [reviewDecision, setReviewDecision] = useState<'verified' | 'rejected'>('verified');
  const [adminNote, setAdminNote] = useState('');
  const [reviewing, setReviewing] = useState(false);

  // ── Fetch Profile & Existing KYC ─────────────────────────────
  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const resp = await ownerKycAPI.getProfile();
      const data = resp.data.data;
      setOwnerProfile(data.owner);
      setVehicles(data.vehicles || []);

      const kyc = data.existing_kyc;
      setExistingKyc(kyc);

      // Pre-fill fields from existing KYC or profile
      if (kyc) {
        setAadhaarNumber(kyc.aadhaar_number || '');
        setPanNumber(kyc.pan_number || '');
        setBankName(kyc.bank_name || '');
        setAccountHolderName(kyc.account_holder_name || data.owner?.name || '');
        setAccountNumber(kyc.account_number || '');
        setConfirmAccountNumber(kyc.account_number || '');
        setIfscCode(kyc.ifsc_code || '');
        setUpiId(kyc.upi_id || '');
        if (kyc.vehicle_id) setSelectedVehicleId(String(kyc.vehicle_id));
      } else {
        setAccountHolderName(data.owner?.name || '');
        if (data.user_table_data?.aadhar) setAadhaarNumber(data.user_table_data.aadhar);
        if (data.user_table_data?.pan) setPanNumber(data.user_table_data.pan);
        if (data.vehicles?.length === 1) {
          setSelectedVehicleId(String(data.vehicles[0].id));
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load owner profile details');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch Admin KYC List ─────────────────────────────────────
  const fetchAdminList = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setAdminLoading(true);
      const params: any = { page, limit: 15 };
      if (statusFilter) params.status = statusFilter;
      if (searchQuery) params.search = searchQuery;
      const resp = await ownerKycAPI.list(params);
      setAdminKycs(resp.data.data || []);
      setTotalPages(resp.data.pagination?.pages || 1);
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to fetch KYC submissions', 'error');
    } finally {
      setAdminLoading(false);
    }
  }, [isAdmin, statusFilter, searchQuery, page, onNotify]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (activeTab === 'admin_list' && isAdmin) {
      fetchAdminList();
    }
  }, [activeTab, isAdmin, fetchAdminList]);

  // ── Real-time Client Form Validation ─────────────────────────
  const validateForm = () => {
    const errors: Record<string, string> = {};

    // Aadhaar: exactly 12 digits
    const cleanAadhaar = aadhaarNumber.replace(/\D/g, '');
    if (!cleanAadhaar) {
      errors.aadhaar_number = 'Aadhaar number is required';
    } else if (cleanAadhaar.length !== 12) {
      errors.aadhaar_number = 'Aadhaar number must be exactly 12 numeric digits';
    }

    // PAN: 10 characters standard format
    const cleanPan = panNumber.trim().toUpperCase();
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!cleanPan) {
      errors.pan_number = 'PAN number is required';
    } else if (!panRegex.test(cleanPan)) {
      errors.pan_number = 'Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F)';
    }

    // Bank Name
    if (!bankName.trim()) {
      errors.bank_name = 'Bank name is required';
    }

    // Account Holder Name
    if (!accountHolderName.trim()) {
      errors.account_holder_name = 'Account holder name is required';
    }

    // Account Number: 9 to 18 digits
    const cleanAcc = accountNumber.trim().replace(/\s/g, '');
    if (!cleanAcc) {
      errors.account_number = 'Account number is required';
    } else if (!/^\d{9,18}$/.test(cleanAcc)) {
      errors.account_number = 'Account number must be 9 to 18 digits';
    }

    // Confirm Account Number match
    const cleanConfirm = confirmAccountNumber.trim().replace(/\s/g, '');
    if (!cleanConfirm) {
      errors.confirm_account_number = 'Please re-enter your account number to confirm';
    } else if (cleanAcc !== cleanConfirm) {
      errors.confirm_account_number = 'Account numbers do not match';
    }

    // IFSC Code: 11 characters
    const cleanIfsc = ifscCode.trim().toUpperCase();
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!cleanIfsc) {
      errors.ifsc_code = 'IFSC code is required';
    } else if (!ifscRegex.test(cleanIfsc)) {
      errors.ifsc_code = 'Invalid IFSC code (e.g. SBIN0001234)';
    }

    // UPI ID (Optional)
    if (upiId.trim()) {
      const upiRegex = /^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/;
      if (!upiRegex.test(upiId.trim())) {
        errors.upi_id = 'Invalid UPI ID format (e.g. mobile@upi or name@bank)';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Handle Form Submit ───────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      onNotify('Please correct the highlighted validation errors', 'error');
      return;
    }

    try {
      setSaving(true);
      const payload: any = {
        aadhaar_number: aadhaarNumber.replace(/\D/g, ''),
        pan_number: panNumber.trim().toUpperCase(),
        bank_name: bankName.trim(),
        account_holder_name: accountHolderName.trim(),
        account_number: accountNumber.trim().replace(/\s/g, ''),
        confirm_account_number: confirmAccountNumber.trim().replace(/\s/g, ''),
        ifsc_code: ifscCode.trim().toUpperCase(),
        upi_id: upiId.trim() || null,
      };

      if (selectedVehicleId) {
        payload.vehicle_id = Number(selectedVehicleId);
      }

      const resp = await ownerKycAPI.submit(payload);
      if (resp.data.success) {
        onNotify(resp.data.message || 'KYC and Bank details submitted successfully!', 'success');
        setExistingKyc(resp.data.data);
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to submit KYC details';
      onNotify(msg, 'error');
      if (err.response?.data?.errors) {
        setFormErrors(err.response.data.errors);
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Handle Admin Status Review ───────────────────────────────
  const handleReviewSubmit = async () => {
    if (!reviewModalKyc) return;
    try {
      setReviewing(true);
      const resp = await ownerKycAPI.updateStatus(reviewModalKyc.id, {
        status: reviewDecision,
        admin_note: adminNote.trim() || undefined,
      });
      if (resp.data.success) {
        onNotify(`KYC for ${reviewModalKyc.owner_name} marked as ${reviewDecision}!`, 'success');
        setReviewModalKyc(null);
        setAdminNote('');
        fetchAdminList();
      }
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to update review status', 'error');
    } finally {
      setReviewing(false);
    }
  };

  // Helper formatting for Aadhaar display
  const formatAadhaarDisplay = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 12);
    return raw.replace(/(\d{4})(?=\d)/g, '$1 ');
  };

  if (loading && !ownerProfile) {
    return <LoadingState message="Loading owner profile and KYC verification status..." />;
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Header & Navigation */}
      <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Owner KYC & Bank Details</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              {isAdmin ? 'Admin Console' : 'Operator Onboarding'}
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-0.5">
            {isAdmin
              ? 'Review and verify bus operator identity, Aadhaar, PAN, and payout bank accounts.'
              : 'Secure verification of Aadhaar, PAN, and Bank details for automated route payouts.'}
          </p>
        </div>

        {/* Tab Switcher for Admin */}
        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="flex items-center p-1 bg-slate-950/80 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab('admin_list')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'admin_list'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Submissions ({adminKycs.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'form'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                My KYC Form
              </button>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={activeTab === 'admin_list' ? fetchAdminList : fetchProfile} icon={RefreshCw}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={fetchProfile} />
      ) : activeTab === 'admin_list' && isAdmin ? (
        /* ── ADMIN SUBMISSIONS LIST VIEW ────────────────────────── */
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">Operator KYC Verification Queue</h3>
                <p className="text-xs text-slate-400 mt-0.5">Review submitted identity documents and verify bank accounts.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search owner, PAN, vehicle..."
                    className="pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-56"
                  />
                </div>

                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: '', label: 'All Statuses' },
                    { value: 'pending', label: 'Pending Verification' },
                    { value: 'verified', label: 'Verified & Approved' },
                    { value: 'rejected', label: 'Rejected' },
                  ]}
                  className="text-xs py-1.5"
                />
              </div>
            </div>

            <Table
              headers={[
                'Owner / Operator',
                'Vehicle Assigned',
                'Aadhaar & PAN',
                'Bank & Account Number',
                'IFSC / UPI',
                'Status',
                'Submitted Date',
                'Action',
              ]}
              loading={adminLoading}
              empty={adminKycs.length === 0}
              emptyMessage="No KYC submissions match your search criteria"
            >
              {adminKycs.map((kyc: any) => (
                <Tr key={kyc.id}>
                  <Td>
                    <div className="font-semibold text-white">{kyc.owner_name}</div>
                    <div className="text-xs text-slate-400">{kyc.owner_mobile}</div>
                    <div className="text-xs text-slate-500">{kyc.owner_email}</div>
                  </Td>
                  <Td>
                    {kyc.vehicle_number ? (
                      <div>
                        <div className="font-medium text-white flex items-center gap-1.5">
                          <Car size={13} className="text-indigo-400" />
                          {kyc.vehicle_number}
                        </div>
                        <div className="text-xs text-slate-400">{kyc.vehicle?.company_model || 'Bus'}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 italic">No vehicle linked</span>
                    )}
                  </Td>
                  <Td>
                    <div className="font-medium text-white">PAN: {kyc.pan_number}</div>
                    <div className="text-xs text-slate-400">
                      Aadhaar: •••• •••• {String(kyc.aadhaar_number || '').slice(-4)}
                    </div>
                  </Td>
                  <Td>
                    <div className="font-medium text-white">{kyc.bank_name}</div>
                    <div className="text-xs text-slate-400">
                      A/C: ••••••{String(kyc.account_number || '').slice(-4)}
                    </div>
                    <div className="text-[11px] text-slate-500">{kyc.account_holder_name}</div>
                  </Td>
                  <Td>
                    <div className="text-xs font-mono text-slate-300">{kyc.ifsc_code}</div>
                    {kyc.upi_id && <div className="text-xs text-emerald-400 font-mono mt-0.5">{kyc.upi_id}</div>}
                  </Td>
                  <Td>
                    {kyc.status === 'verified' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 size={12} /> Verified
                      </span>
                    ) : kyc.status === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                        <XCircle size={12} /> Rejected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        <Clock size={12} /> Pending
                      </span>
                    )}
                    {kyc.admin_note && (
                      <div className="text-[11px] text-slate-400 mt-1 max-w-[150px] truncate" title={kyc.admin_note}>
                        Note: {kyc.admin_note}
                      </div>
                    )}
                  </Td>
                  <Td className="text-xs text-slate-400">
                    {kyc.created_at ? new Date(kyc.created_at).toLocaleDateString('en-IN') : '—'}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setReviewModalKyc(kyc);
                        setReviewDecision(kyc.status === 'verified' ? 'rejected' : 'verified');
                        setAdminNote(kyc.admin_note || '');
                      }}
                    >
                      Review
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>

          {/* Admin Review Modal */}
          {reviewModalKyc && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl relative">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-base font-bold text-white">Review Owner KYC Submission</h3>
                  </div>
                  <button onClick={() => setReviewModalKyc(null)} className="text-slate-400 hover:text-white font-bold">×</button>
                </div>

                <div className="py-4 space-y-3 text-sm">
                  <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Operator:</span>
                      <span className="font-semibold text-white">{reviewModalKyc.owner_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Mobile / Email:</span>
                      <span className="text-slate-200">{reviewModalKyc.owner_mobile} · {reviewModalKyc.owner_email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Vehicle Linked:</span>
                      <span className="text-indigo-400 font-semibold">{reviewModalKyc.vehicle_number || 'None'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Aadhaar:</span>
                      <span className="font-mono text-white">{reviewModalKyc.aadhaar_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">PAN Card:</span>
                      <span className="font-mono text-white uppercase">{reviewModalKyc.pan_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Bank Name:</span>
                      <span className="font-medium text-white">{reviewModalKyc.bank_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Account Number:</span>
                      <span className="font-mono text-white">{reviewModalKyc.account_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">IFSC Code:</span>
                      <span className="font-mono text-white uppercase">{reviewModalKyc.ifsc_code}</span>
                    </div>
                    {reviewModalKyc.upi_id && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">UPI ID:</span>
                        <span className="font-mono text-emerald-400">{reviewModalKyc.upi_id}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Review Decision</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setReviewDecision('verified')}
                        className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-medium text-xs transition-all ${
                          reviewDecision === 'verified'
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <CheckCircle2 size={16} /> Approve & Verify
                      </button>
                      <button
                        type="button"
                        onClick={() => setReviewDecision('rejected')}
                        className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-medium text-xs transition-all ${
                          reviewDecision === 'rejected'
                            ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <XCircle size={16} /> Reject Submission
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                      {reviewDecision === 'rejected' ? 'Rejection Reason (Required)' : 'Admin Note (Optional)'}
                    </label>
                    <textarea
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder={reviewDecision === 'rejected' ? 'Explain what document or number was incorrect...' : 'Optional approval remarks...'}
                      rows={2}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
                  <Button variant="ghost" size="sm" onClick={() => setReviewModalKyc(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    variant={reviewDecision === 'verified' ? 'primary' : 'danger'}
                    onClick={handleReviewSubmit}
                    loading={reviewing}
                  >
                    Confirm {reviewDecision === 'verified' ? 'Verification' : 'Rejection'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── OWNER SUBMISSION FORM VIEW ─────────────────────────── */
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Status Alert Banner */}
          {existingKyc ? (
            existingKyc.status === 'verified' ? (
              <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-2xl p-5 flex items-start gap-3.5 shadow-sm">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 flex-shrink-0">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h4 className="text-emerald-300 font-bold text-base">KYC Verified & Active</h4>
                  <p className="text-emerald-400/80 text-xs mt-0.5">
                    Your identity, Aadhaar, PAN, and Bank details are verified. Payouts and settlements are processed directly to your registered bank account.
                  </p>
                  {existingKyc.verified_at && (
                    <div className="text-[11px] text-emerald-500/80 mt-1 flex items-center gap-1.5">
                      <Clock size={12} /> Verified on {new Date(existingKyc.verified_at).toLocaleDateString('en-IN')}
                    </div>
                  )}
                </div>
              </div>
            ) : existingKyc.status === 'rejected' ? (
              <div className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-5 flex items-start gap-3.5 shadow-sm">
                <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 flex-shrink-0">
                  <AlertCircle size={24} />
                </div>
                <div>
                  <h4 className="text-rose-300 font-bold text-base">KYC Verification Rejected</h4>
                  <p className="text-rose-400/80 text-xs mt-0.5">
                    Your previous KYC submission could not be verified. Please review the admin remarks below, correct your information, and re-submit.
                  </p>
                  {existingKyc.admin_note && (
                    <div className="mt-2 p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/40 text-rose-200 text-xs font-medium">
                      Remarks: {existingKyc.admin_note}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-amber-950/40 border border-amber-500/40 rounded-2xl p-5 flex items-start gap-3.5 shadow-sm">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 flex-shrink-0">
                  <Clock size={24} />
                </div>
                <div>
                  <h4 className="text-amber-300 font-bold text-base">Verification in Progress</h4>
                  <p className="text-amber-400/80 text-xs mt-0.5">
                    Your KYC and Bank details have been submitted and are currently awaiting review by our compliance team. You may update your details below if needed.
                  </p>
                </div>
              </div>
            )
          ) : (
            <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-5 flex items-start gap-3.5 shadow-sm">
              <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 flex-shrink-0">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h4 className="text-indigo-200 font-bold text-base">Complete Your KYC & Bank Registration</h4>
                <p className="text-indigo-300/80 text-xs mt-0.5">
                  As a registered bus operator, complete your identity and payout account verification to activate passenger ticket settlements and route assignments.
                </p>
              </div>
            </div>
          )}

          {/* Section 1: Auto-Fetched Owner & Vehicle Info */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
              <User className="w-5 h-5 text-indigo-400" />
              <div>
                <h3 className="text-base font-bold text-white">Owner Account & Fleet Linkage</h3>
                <p className="text-xs text-slate-400">Automatically fetched from your registered operator account.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Name */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <span className="text-[11px] font-semibold uppercase text-slate-400 block mb-1">Operator Name</span>
                <div className="text-base font-bold text-white flex items-center gap-2">
                  <span>{ownerProfile?.name || '—'}</span>
                  <Check size={14} className="text-emerald-400" />
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">Registered Account Holder</span>
              </div>

              {/* Mobile */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <span className="text-[11px] font-semibold uppercase text-slate-400 block mb-1">Mobile Number</span>
                <div className="text-base font-bold text-white flex items-center gap-2">
                  <Phone size={14} className="text-emerald-400" />
                  <span>{ownerProfile?.mobile || ownerProfile?.phone || 'Not set'}</span>
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">Primary contact number</span>
              </div>

              {/* Email */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <span className="text-[11px] font-semibold uppercase text-slate-400 block mb-1">Email Address</span>
                <div className="text-base font-bold text-white flex items-center gap-2 truncate">
                  <Mail size={14} className="text-indigo-400 flex-shrink-0" />
                  <span className="truncate">{ownerProfile?.email || '—'}</span>
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">Account notification email</span>
              </div>
            </div>

            {/* Vehicle Selection Dropdown */}
            <div className="pt-2">
              <label className="block text-xs font-semibold uppercase text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Select Fleet Bus / Vehicle (Optional Linkage)</span>
                {vehicles.length > 0 && (
                  <span className="text-[11px] text-indigo-400 font-normal">
                    {vehicles.length} {vehicles.length === 1 ? 'vehicle registered' : 'vehicles registered'}
                  </span>
                )}
              </label>

              {vehicles.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Select
                      value={selectedVehicleId}
                      onChange={setSelectedVehicleId}
                      placeholder="Select a vehicle from your fleet"
                      options={[
                        { value: '', label: 'None / Link to General Fleet' },
                        ...vehicles.map((v) => ({
                          value: String(v.id),
                          label: `${v.registration_number} — ${v.company_model || 'Bus'} (${v.status || 'Active'})`,
                        })),
                      ]}
                      className="w-full text-sm"
                    />
                  </div>
                  {selectedVehicleId && (
                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center gap-3">
                      <Car size={18} className="text-indigo-400 flex-shrink-0" />
                      <div className="text-xs">
                        <span className="text-indigo-300 font-semibold">
                          Selected: {vehicles.find((v) => String(v.id) === selectedVehicleId)?.registration_number}
                        </span>
                        <div className="text-slate-400">
                          {vehicles.find((v) => String(v.id) === selectedVehicleId)?.company_model} · {vehicles.find((v) => String(v.id) === selectedVehicleId)?.total_seats || 0} Seats
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                  <Info size={15} className="text-slate-500" />
                  <span>No registered vehicles found for your account. You can complete and submit your KYC now.</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Identity & KYC Documents */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
              <div>
                <h3 className="text-base font-bold text-white">Identity & Government KYC Details</h3>
                <p className="text-xs text-slate-400">Government-issued identity cards for regulatory verification.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Aadhaar Number */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300 mb-1">
                  Aadhaar Number <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={14}
                    value={formatAadhaarDisplay(aadhaarNumber)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 12);
                      setAadhaarNumber(clean);
                      if (formErrors.aadhaar_number) {
                        setFormErrors((prev) => ({ ...prev, aadhaar_number: '' }));
                      }
                    }}
                    placeholder="12-digit Aadhaar Number (XXXX XXXX XXXX)"
                    className={`w-full rounded-xl bg-slate-950 border px-3.5 py-2.5 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                      formErrors.aadhaar_number
                        ? 'border-rose-500/80 focus:ring-rose-500/20'
                        : 'border-slate-800 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  />
                  {aadhaarNumber.length === 12 && (
                    <CheckCircle2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400" />
                  )}
                </div>
                {formErrors.aadhaar_number ? (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {formErrors.aadhaar_number}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">12-digit Unique Identification Authority of India number</p>
                )}
              </div>

              {/* PAN Number */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300 mb-1">
                  Permanent Account Number (PAN) <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={10}
                    value={panNumber.toUpperCase()}
                    onChange={(e) => {
                      const clean = e.target.value.toUpperCase().slice(0, 10);
                      setPanNumber(clean);
                      if (formErrors.pan_number) {
                        setFormErrors((prev) => ({ ...prev, pan_number: '' }));
                      }
                    }}
                    placeholder="10-character PAN (e.g. ABCDE1234F)"
                    className={`w-full rounded-xl bg-slate-950 border px-3.5 py-2.5 text-sm font-mono uppercase text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                      formErrors.pan_number
                        ? 'border-rose-500/80 focus:ring-rose-500/20'
                        : 'border-slate-800 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  />
                  {/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber.toUpperCase()) && (
                    <CheckCircle2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400" />
                  )}
                </div>
                {formErrors.pan_number ? (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {formErrors.pan_number}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">Income Tax Department 10-character alphanumeric PAN</p>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Bank & Settlement Payout Account */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
              <Building className="w-5 h-5 text-indigo-400" />
              <div>
                <h3 className="text-base font-bold text-white">Bank Account & Payout Details</h3>
                <p className="text-xs text-slate-400">All trip earnings and ticket settlements will be credited to this verified account.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Bank Name */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300 mb-1">
                  Bank Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => {
                    setBankName(e.target.value);
                    if (formErrors.bank_name) setFormErrors((prev) => ({ ...prev, bank_name: '' }));
                  }}
                  placeholder="e.g. State Bank of India, HDFC Bank, ICICI Bank"
                  className={`w-full rounded-xl bg-slate-950 border px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                    formErrors.bank_name
                      ? 'border-rose-500/80 focus:ring-rose-500/20'
                      : 'border-slate-800 focus:ring-indigo-500/20 focus:border-indigo-500'
                  }`}
                />
                {formErrors.bank_name && (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {formErrors.bank_name}
                  </p>
                )}
              </div>

              {/* Account Holder Name */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300 mb-1">
                  Account Holder Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={accountHolderName}
                  onChange={(e) => {
                    setAccountHolderName(e.target.value);
                    if (formErrors.account_holder_name) setFormErrors((prev) => ({ ...prev, account_holder_name: '' }));
                  }}
                  placeholder="Exact name as in bank passbook"
                  className={`w-full rounded-xl bg-slate-950 border px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                    formErrors.account_holder_name
                      ? 'border-rose-500/80 focus:ring-rose-500/20'
                      : 'border-slate-800 focus:ring-indigo-500/20 focus:border-indigo-500'
                  }`}
                />
                {formErrors.account_holder_name ? (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {formErrors.account_holder_name}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">Must match the registered bank account title</p>
                )}
              </div>

              {/* Bank Account Number */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300 mb-1">
                  Bank Account Number <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  value={accountNumber}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/\s/g, '');
                    setAccountNumber(clean);
                    if (formErrors.account_number) setFormErrors((prev) => ({ ...prev, account_number: '' }));
                  }}
                  placeholder="Enter 9 to 18 digit account number"
                  className={`w-full rounded-xl bg-slate-950 border px-3.5 py-2.5 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                    formErrors.account_number
                      ? 'border-rose-500/80 focus:ring-rose-500/20'
                      : 'border-slate-800 focus:ring-indigo-500/20 focus:border-indigo-500'
                  }`}
                />
                {formErrors.account_number && (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {formErrors.account_number}
                  </p>
                )}
              </div>

              {/* Confirm Bank Account Number */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300 mb-1">
                  Confirm Bank Account Number <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={confirmAccountNumber}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\s/g, '');
                      setConfirmAccountNumber(clean);
                      if (formErrors.confirm_account_number) setFormErrors((prev) => ({ ...prev, confirm_account_number: '' }));
                    }}
                    placeholder="Re-enter bank account number"
                    className={`w-full rounded-xl bg-slate-950 border px-3.5 py-2.5 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                      formErrors.confirm_account_number
                        ? 'border-rose-500/80 focus:ring-rose-500/20'
                        : 'border-slate-800 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  />
                  {confirmAccountNumber && confirmAccountNumber === accountNumber && (
                    <CheckCircle2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400" />
                  )}
                </div>
                {formErrors.confirm_account_number ? (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {formErrors.confirm_account_number}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">Prevents accidental settlement transfer typos</p>
                )}
              </div>

              {/* IFSC Code */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300 mb-1">
                  IFSC Code <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={11}
                    value={ifscCode.toUpperCase()}
                    onChange={(e) => {
                      const clean = e.target.value.toUpperCase().slice(0, 11);
                      setIfscCode(clean);
                      if (formErrors.ifsc_code) setFormErrors((prev) => ({ ...prev, ifsc_code: '' }));
                    }}
                    placeholder="11-character IFSC (e.g. SBIN0001234)"
                    className={`w-full rounded-xl bg-slate-950 border px-3.5 py-2.5 text-sm font-mono uppercase text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                      formErrors.ifsc_code
                        ? 'border-rose-500/80 focus:ring-rose-500/20'
                        : 'border-slate-800 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  />
                  {/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode.toUpperCase()) && (
                    <CheckCircle2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400" />
                  )}
                </div>
                {formErrors.ifsc_code ? (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {formErrors.ifsc_code}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">Found on bank cheque leaf or passbook front page</p>
                )}
              </div>

              {/* Optional UPI ID */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-300 mb-1">
                  UPI ID (Optional Instant Payouts)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={upiId}
                    onChange={(e) => {
                      setUpiId(e.target.value);
                      if (formErrors.upi_id) setFormErrors((prev) => ({ ...prev, upi_id: '' }));
                    }}
                    placeholder="e.g. mobile@paytm or username@okhdfcbank"
                    className={`w-full rounded-xl bg-slate-950 border px-3.5 py-2.5 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                      formErrors.upi_id
                        ? 'border-rose-500/80 focus:ring-rose-500/20'
                        : 'border-slate-800 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  />
                  {upiId.trim() && /^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId.trim()) && (
                    <CheckCircle2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400" />
                  )}
                </div>
                {formErrors.upi_id ? (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {formErrors.upi_id}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">Virtual Payment Address for automated UPI transfers</p>
                )}
              </div>
            </div>
          </div>

          {/* Security & Compliance Notice */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
            <Lock size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-400">
              <span className="font-semibold text-slate-200">256-Bit Encrypted & PCI-DSS Compliant Storage:</span>{' '}
              All bank details and government identification are securely stored with role-based access restrictions. Details are strictly utilized for verified ticket fare settlements and statutory operator compliance.
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                fetchProfile();
                setFormErrors({});
              }}
              disabled={saving}
            >
              Reset
            </Button>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={saving}
              icon={ShieldCheck}
            >
              {existingKyc ? 'Update & Re-Submit KYC' : 'Submit KYC & Bank Details'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
