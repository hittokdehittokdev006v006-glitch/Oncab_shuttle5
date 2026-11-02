import React, { useState, useEffect, useCallback } from 'react';
import { bookingsAPI, refundsAPI } from '../services/api';
import { Card, Table, Tr, Td, Pagination, SearchInput, Button, StatusBadge, ErrorState, ConfirmDialog, Modal, Input } from '../components/ui';
import { RefreshCw } from 'lucide-react';

interface CancelledTicketsRefundPageProps { onNotify: (msg: string, type?: any) => void; }

export const CancelledTicketsRefundPage: React.FC<CancelledTicketsRefundPageProps> = ({ onNotify }) => {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });
  const [refundModal, setRefundModal] = useState<any>(null);
  const [refundNote, setRefundNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetch = useCallback(async () => {
    try { setLoading(true); setError(''); const r = await bookingsAPI.cancelled({ page, limit: 15, search }); setBookings(r.data.data); setPagination(r.data.pagination); }
    catch (e: any) { setError(e.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { setPage(1); }, [search]);

  const handleProcessRefund = async () => {
    if (!refundModal) return;
    setProcessing(true);
    try {
      const response = await refundsAPI.process(refundModal.refund.id, { notes: refundNote });
      onNotify(response.data.message || 'Refund submitted');
      setRefundModal(null);
      setRefundNote('');
      fetch();
    } catch (e: any) { onNotify(e.response?.data?.message || 'Failed', 'error'); }
    finally { setProcessing(false); }
  };

  const HEADERS = ['Booking Ref', 'Passenger', 'Trip', 'Cancelled On', 'Refund Amount', 'Refund Status', 'Actions'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-white font-semibold">Cancelled Tickets & Refunds</h2><p className="text-slate-500 text-sm">{pagination.total} cancelled bookings</p></div>
      </div>
      <div className="flex gap-3"><SearchInput value={search} onChange={setSearch} placeholder="Search booking reference..." /></div>
      <Card padding={false}>
        {error ? <ErrorState message={error} onRetry={fetch} /> : (
          <>
            <Table headers={HEADERS} loading={loading} empty={!loading && bookings.length === 0} emptyMessage="No cancelled tickets">
              {bookings.map((b) => (
                <Tr key={b.id}>
                  <Td><div className="text-white text-sm font-mono">{b.booking_reference}</div></Td>
                  <Td><div className="text-white text-sm">{b.passenger_name}</div><div className="text-slate-500 text-xs">{b.passenger_mobile}</div></Td>
                  <Td className="text-xs text-slate-300">{b.trip?.schedule_code || '—'}</Td>
                  <Td className="text-xs text-slate-400">{b.cancelled_at ? new Date(b.cancelled_at).toLocaleDateString() : b.updated_at ? new Date(b.updated_at).toLocaleDateString() : '—'}</Td>
                  <Td className="text-sm font-semibold text-amber-400">
                    {b.refunds?.length
                      ? `₹${b.refunds.reduce((total: number, refund: any) => total + Number(refund.refund_amount || 0), 0).toFixed(2)}`
                      : '—'}
                  </Td>
                  <Td><StatusBadge status={b.payment_status} /></Td>
                  <Td>
                    {b.payment_status === 'paid' && b.refunds?.some((refund: any) => ['pending', 'failed'].includes(refund.status)) && (
                      <Button variant="secondary" size="sm" onClick={() => {
                        const refund = b.refunds.find((item: any) => ['pending', 'failed'].includes(item.status));
                        if (refund) setRefundModal({ booking: b, refund });
                      }}>
                        <RefreshCw size={12} /> {b.refunds.find((item: any) => ['pending', 'failed'].includes(item.status))?.refund_method === 'wallet' ? 'Approve Wallet Refund' : 'Approve Refund'}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
            <Pagination page={page} pages={pagination.pages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} />
          </>
        )}
      </Card>
      <Modal open={!!refundModal} onClose={() => setRefundModal(null)} title="Process Refund" size="sm"
        footer={<><Button variant="ghost" onClick={() => setRefundModal(null)}>Cancel</Button><Button onClick={handleProcessRefund} loading={processing}>{refundModal?.refund?.refund_method === 'wallet' ? 'Approve & Credit Wallet' : 'Approve & Process Refund'}</Button></>}>
        <div className="space-y-3">
          <div className="p-3 rounded-lg" style={{ background: 'rgba(99, 102, 241, 0.08)' }}>
            <p className="text-white text-sm font-medium">{refundModal?.booking?.booking_reference}</p>
            <p className="text-slate-400 text-xs mt-0.5">Amount: ₹{Number(refundModal?.refund?.refund_amount || 0).toFixed(2)}</p>
          </div>
          <Input label="Notes (optional)" value={refundNote} onChange={setRefundNote} placeholder="Refund notes..." />
        </div>
      </Modal>
    </div>
  );
};
