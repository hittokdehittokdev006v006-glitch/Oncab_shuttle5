import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Webhook, Search } from 'lucide-react';
import { payuWebhooksAPI, refundsAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, SearchInput, Button, StatusBadge, ErrorState, Modal, ConfirmDialog } from '../components/ui';

interface PayuWebhooksPageProps { onNotify: (msg: string, type?: any) => void; }

const EVENT_COLORS: Record<string, string> = {
  payment_status: '#10b981',
  payment_captured: '#10b981',
  payment_failed: '#ef4444',
  refund_status: '#8b5cf6',
  refund_completed: '#10b981',
  refund_failed: '#ef4444',
};

export const PayuWebhooksPage: React.FC<PayuWebhooksPageProps> = ({ onNotify }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [resyncTarget, setResyncTarget] = useState<any>(null);
  const [resyncing, setResyncing] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page, limit: 50 };
      if (search.trim()) params.mihpayid = search.trim();
      const r = await payuWebhooksAPI.list(params);
      setLogs(r.data.data);
      setPagination(r.data.pagination);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load PayU webhook logs');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { setPage(1); }, [search]);

  const handleResync = async () => {
    if (!resyncTarget) return;
    setResyncing(true);
    try {
      const r = await refundsAPI.resyncPayU(resyncTarget.refund_id);
      onNotify(r.data.message || 'Refund re-synced with PayU', 'success');
      setResyncTarget(null);
      fetchLogs();
    } catch (e: any) {
      onNotify(e.response?.data?.message || 'Resync failed', 'error');
    } finally {
      setResyncing(false);
    }
  };

  const HEADERS = ['Event', 'Txn ID', 'Mihpayid', 'Status', 'Amount', 'Refund ID', 'Verified', 'Time', ''];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: 'rgba(139, 92, 246, 0.15)' }}>
              <Webhook size={20} style={{ color: '#8b5cf6' }} />
            </div>
            <div>
              <h2 className="text-white font-semibold">PayU Webhooks</h2>
              <p className="text-slate-500 text-sm">{pagination.total} webhook events received</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-64"><SearchInput value={search} onChange={setSearch} placeholder="Search mihpayid..." /></div>
            <Button variant="secondary" size="sm" onClick={fetchLogs}><RefreshCw size={12} /> Refresh</Button>
          </div>
        </div>

        {error && <ErrorState message={error} onRetry={fetchLogs} />}
        {!error && <Table headers={HEADERS} loading={loading} empty={!loading && logs.length === 0} emptyMessage="No webhook events yet. Configure the webhook URL in your PayU dashboard: POST /api2/payu/webhook">
          {logs.map((log) => (
            <Tr key={log.id}>
              <Td><span className="text-xs font-medium" style={{ color: EVENT_COLORS[log.event_type] || '#94a3b8' }}>{log.event_type || 'unknown'}</span></Td>
              <Td><div className="text-xs text-slate-300 font-mono max-w-[150px] truncate">{log.payu_txnid || '—'}</div></Td>
              <Td><div className="text-xs text-slate-300 font-mono max-w-[150px] truncate">{log.payu_mihpayid || '—'}</div></Td>
              <Td>{log.status ? <StatusBadge status={log.status} /> : <span className="text-xs text-slate-500">—</span>}</Td>
              <Td className="text-sm font-semibold" style={{ color: '#10b981' }}>{log.amount != null ? `₹${Number(log.amount).toFixed(2)}` : '—'}</Td>
              <Td className="text-xs text-slate-400">{log.refund_id ? `#${log.refund_id}` : '—'}</Td>
              <Td>
                <span className="text-xs font-medium" style={{ color: log.hash_verified ? '#10b981' : '#f59e0b' }}>
                  {log.hash_verified ? 'Verified' : 'Unsigned'}
                </span>
              </Td>
              <Td className="text-xs text-slate-400">{log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</Td>
              <Td>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setDetail(log)}>View</Button>
                  {log.refund_id && (
                    <Button variant="ghost" size="sm" onClick={() => setResyncTarget(log)}>Resync</Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>}
        <Pagination
          page={page}
          pages={pagination.pages}
          total={pagination.total}
          limit={pagination.limit}
          onPageChange={setPage}
        />
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Webhook Payload" size="lg">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-500">Event:</span> <span className="text-white">{detail?.event_type || '—'}</span></div>
            <div><span className="text-slate-500">Processed:</span> <span className="text-white">{detail?.processed ? 'Yes' : 'No'}</span></div>
            <div><span className="text-slate-500">Txn ID:</span> <span className="text-white font-mono">{detail?.payu_txnid || '—'}</span></div>
            <div><span className="text-slate-500">Mihpayid:</span> <span className="text-white font-mono">{detail?.payu_mihpayid || '—'}</span></div>
          </div>
          <pre className="mt-3 p-3 rounded-lg text-xs overflow-auto max-h-96" style={{ background: 'rgba(0,0,0,0.3)', color: '#a5b4fc' }}>
            {detail?.payload ? JSON.stringify(detail.payload, null, 2) : 'No payload'}
          </pre>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!resyncTarget}
        onClose={() => setResyncTarget(null)}
        onConfirm={handleResync}
        title="Re-sync Refund with PayU"
        message={`Check refund #${resyncTarget?.refund_id} directly against PayU and update its status?`}
        confirmLabel="Re-sync"
        loading={resyncing}
      />
    </div>
  );
};
