import React, { useState, useEffect, useCallback } from 'react';
import { refundsAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, SearchInput, Select, StatusBadge, ErrorState, Button, ConfirmDialog } from '../components/ui';
import { RefreshCcw } from 'lucide-react';

interface RefundsPageProps {
  onNotify: (msg: string, type?: any) => void;
}

export const RefundsPage: React.FC<RefundsPageProps> = ({ onNotify }) => {
  const [refunds, setRefunds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });
  const [retryTarget, setRetryTarget] = useState<any>(null);
  const [retrying, setRetrying] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);

  const fetchRefunds = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const resp = await refundsAPI.list({
        page,
        limit: 15,
        search,
        status: statusFilter,
      });
      setRefunds(resp.data.data || []);
      setPagination(resp.data.pagination || { total: 0, pages: 1, limit: 15 });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load refunds');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchRefunds();
  }, [fetchRefunds]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const handleRetry = async () => {
    if (!retryTarget) return;
    setRetrying(true);
    try {
      await refundsAPI.retry(retryTarget.id);
      await refundsAPI.process(retryTarget.id, {});
      onNotify('Refund retry submitted to gateway');
      setRetryTarget(null);
      fetchRefunds();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Retry failed', 'error');
    } finally {
      setRetrying(false);
    }
  };

  const handleProcessPayURefund = async (refund: any) => {
    setProcessingId(refund.id);
    try {
      const response = await refundsAPI.process(refund.id, {});
      onNotify(response.data.message || 'Refund submitted to PayU');
      await fetchRefunds();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Unable to submit PayU refund', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleVerifyPayU = async (refund: any) => {
    setProcessingId(refund.id);
    try {
      const response = await refundsAPI.verifyPayU(refund.id);
      onNotify(response.data.message || 'PayU refund status refreshed');
      await fetchRefunds();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Unable to verify PayU refund', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const HEADERS = ['Refund Ref', 'Booking Ref', 'Passenger', 'Refund Amount', 'Reason', 'Status', 'Date', 'Actions'];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">All Refunds Management</h2>
          <p className="text-slate-400 text-sm">Audit and handle all passenger refund requests</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search refund ref, booking ref, name..."
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'completed', label: 'Completed' },
            { value: 'pending', label: 'Pending' },
            { value: 'processing', label: 'Processing' },
            { value: 'failed', label: 'Failed' },
          ]}
          placeholder="All Refund Statuses"
        />
      </div>

      <Card padding={false}>
        {error ? (
          <ErrorState message={error} onRetry={fetchRefunds} />
        ) : (
          <>
            <Table
              headers={HEADERS}
              loading={loading}
              empty={!loading && refunds.length === 0}
              emptyMessage="No refund records found"
            >
              {refunds.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="text-white text-sm font-mono font-medium">
                      {r.refund_reference || `REF-${r.id}`}
                    </div>
                  </Td>
                  <Td>
                    <div className="text-xs font-mono text-cyan-400">
                      {r.booking?.booking_reference || r.booking_reference || '—'}
                    </div>
                  </Td>
                  <Td>
                    <div className="text-white text-sm">
                      {r.passenger?.name || r.booking?.passenger_name || 'Passenger'}
                    </div>
                    <div className="text-slate-500 text-xs">
                      {r.passenger?.mobile || r.booking?.passenger_mobile || '—'}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-sm font-bold text-emerald-400 font-mono">
                      ₹{Number(r.refund_amount || 0).toFixed(2)}
                    </span>
                  </Td>
                  <Td>
                    <div className="text-xs text-slate-300 max-w-xs truncate" title={r.cancellation_reason || r.failure_reason || r.reason}>
                      {r.cancellation_reason || r.failure_reason || r.reason || 'Ticket Cancelled'}
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={r.refund_status || r.status || 'pending'} />
                  </Td>
                  <Td className="text-xs text-slate-400">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                  </Td>
                  <Td>
                    {r.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRetryTarget(r)}
                        icon={RefreshCcw}
                      >
                        Retry
                      </Button>
                    )}
                    {r.status === 'pending' && (
                      <Button size="sm" variant="secondary" loading={processingId === r.id} onClick={() => handleProcessPayURefund(r)}>
                        Process PayU Refund
                      </Button>
                    )}
                    {r.status === 'processing' && r.refund_method === 'payu' && (
                      <Button size="sm" variant="secondary" loading={processingId === r.id} onClick={() => handleVerifyPayU(r)}>
                        Verify PayU
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
            <Pagination
              page={page}
              pages={pagination.pages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      {retryTarget && (
        <ConfirmDialog
          isOpen={true}
          title="Retry Refund Transaction"
          message={`Are you sure you want to re-process refund ${retryTarget.refund_reference || retryTarget.id} for ₹${retryTarget.refund_amount}?`}
          confirmLabel={retrying ? 'Processing...' : 'Retry Refund'}
          onConfirm={handleRetry}
          onCancel={() => setRetryTarget(null)}
        />
      )}
    </div>
  );
};
