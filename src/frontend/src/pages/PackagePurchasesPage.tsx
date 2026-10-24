import React, { useCallback, useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { Eye, RefreshCw } from 'lucide-react';
import { packagePurchasesAPI } from '../services/api';
import {
  Button,
  Card,
  ErrorState,
  Modal,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  Td,
  Tr,
} from '../components/ui';

interface PurchasePayment {
  id: number;
  payu_txnid?: string | null;
  payu_mihpayid?: string | null;
  payment_gateway?: string | null;
  payment_method?: string | null;
  amount: string | number;
  currency?: string | null;
  status: string;
  created_at?: string | null;
}

interface PackagePurchase {
  id: number;
  package_name: string;
  package_code: string;
  package_id: number;
  passenger?: { id: number; name?: string; mobile?: string; email?: string } | null;
  total_rides: number;
  used_rides: number;
  reserved_rides: number;
  available_rides: number;
  amount_paid: string | number;
  payment_status: string;
  status: string;
  created_at: string;
  purchased_at?: string | null;
  expires_at?: string | null;
  payments?: PurchasePayment[];
  usage?: Array<{
    id: number;
    rides_count: number;
    status: string;
    reserved_at?: string | null;
    booking?: {
      booking_reference?: string | null;
      travel_date?: string | null;
      booking_status?: string | null;
    } | null;
  }>;
}

interface PackagePurchasesPageProps {
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const money = (amount: string | number, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(amount || 0));

const dateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—');

export const PackagePurchasesPage: React.FC<PackagePurchasesPageProps> = () => {
  const [purchases, setPurchases] = useState<PackagePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, limit: 15 });
  const [selectedPurchase, setSelectedPurchase] = useState<PackagePurchase | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const fetchPurchases = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await packagePurchasesAPI.list({
        page,
        limit: 15,
        search: search.trim() || undefined,
        status: status || undefined,
        payment_status: paymentStatus || undefined,
      });
      setPurchases(response.data.data || []);
      setPagination(response.data.pagination || { total: 0, pages: 1, limit: 15 });
    } catch (requestError: unknown) {
      const message = isAxiosError<{ message?: string }>(requestError)
        ? requestError.response?.data?.message
        : undefined;
      setError(message || 'Failed to load package purchases');
    } finally {
      setLoading(false);
    }
  }, [page, search, status, paymentStatus]);

  useEffect(() => {
    fetchPurchases();
  }, [fetchPurchases]);

  useEffect(() => {
    setPage(1);
  }, [search, status, paymentStatus]);

  const openDetails = async (purchaseId: number) => {
    setSelectedPurchase(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const response = await packagePurchasesAPI.show(purchaseId);
      setSelectedPurchase(response.data.data);
    } catch (requestError: unknown) {
      const message = isAxiosError<{ message?: string }>(requestError)
        ? requestError.response?.data?.message
        : undefined;
      setDetailError(message || 'Failed to load purchase details');
    } finally {
      setDetailLoading(false);
    }
  };

  const pageRevenue = purchases.reduce(
    (sum, purchase) => sum + (purchase.payment_status === 'paid' ? Number(purchase.amount_paid || 0) : 0),
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Prepaid Package Purchases</h2>
          <p className="text-slate-400 text-sm">
            {pagination.total.toLocaleString()} purchase records · Paid on this page: {money(pageRevenue)}
          </p>
        </div>
        <Button variant="outline" icon={RefreshCw} onClick={fetchPurchases}>Refresh</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search package, passenger, mobile..."
        />
        <Select
          value={status}
          onChange={setStatus}
          placeholder="All purchase statuses"
          options={['pending_payment', 'active', 'exhausted', 'expired', 'cancelled', 'refunded']
            .map((value) => ({ value, label: value.replace('_', ' ') }))}
        />
        <Select
          value={paymentStatus}
          onChange={setPaymentStatus}
          placeholder="All payment statuses"
          options={['pending', 'paid', 'failed', 'refunded']
            .map((value) => ({ value, label: value }))}
        />
      </div>

      <Card padding={false}>
        {error ? (
          <ErrorState message={error} onRetry={fetchPurchases} />
        ) : (
          <>
            <Table
              headers={['Purchase', 'Passenger', 'Package', 'Ride balance', 'Amount', 'Payment / status', 'Purchased', '']}
              loading={loading}
              empty={!loading && purchases.length === 0}
              emptyMessage="No prepaid package purchases found"
            >
              {purchases.map((purchase) => {
                const latestPayment = purchase.payments?.[0];
                return (
                  <Tr key={purchase.id}>
                    <Td className="font-mono text-xs text-cyan-400">#{purchase.id}</Td>
                    <Td>
                      <div className="text-white">{purchase.passenger?.name || 'Passenger'}</div>
                      <div className="text-xs text-slate-500">{purchase.passenger?.mobile || purchase.passenger?.email || '—'}</div>
                    </Td>
                    <Td>
                      <div className="text-white">{purchase.package_name}</div>
                      <div className="text-xs text-slate-500">{purchase.package_code} · package #{purchase.package_id}</div>
                    </Td>
                    <Td>
                      <div className="text-white">{purchase.available_rides} available / {purchase.total_rides}</div>
                      <div className="text-xs text-slate-500">{purchase.used_rides} used · {purchase.reserved_rides} reserved</div>
                    </Td>
                    <Td className="font-semibold text-emerald-400">{money(purchase.amount_paid)}</Td>
                    <Td>
                      <div><StatusBadge status={purchase.payment_status} /></div>
                      <div className="mt-1"><StatusBadge status={purchase.status} /></div>
                      {latestPayment?.payu_txnid && (
                        <div className="mt-1 max-w-40 truncate font-mono text-[11px] text-slate-500" title={latestPayment.payu_txnid}>
                          {latestPayment.payu_txnid}
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-400">{dateTime(purchase.purchased_at || purchase.created_at)}</Td>
                    <Td>
                      <Button size="sm" variant="secondary" icon={Eye} onClick={() => openDetails(purchase.id)}>
                        Details
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
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

      <Modal
        open={Boolean(selectedPurchase) || detailLoading || Boolean(detailError)}
        onClose={() => {
          setSelectedPurchase(null);
          setDetailError('');
        }}
        title={selectedPurchase ? `Purchase #${selectedPurchase.id} details` : 'Purchase details'}
        size="xl"
      >
        {detailLoading ? (
          <p className="text-sm text-slate-400">Loading purchase details…</p>
        ) : detailError ? (
          <p className="text-sm text-rose-400">{detailError}</p>
        ) : selectedPurchase ? (
          <div className="space-y-6">
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-500">Passenger:</span> {selectedPurchase.passenger?.name || '—'} ({selectedPurchase.passenger?.mobile || '—'})</div>
              <div><span className="text-slate-500">Email:</span> {selectedPurchase.passenger?.email || '—'}</div>
              <div><span className="text-slate-500">Package:</span> {selectedPurchase.package_name} ({selectedPurchase.package_code})</div>
              <div><span className="text-slate-500">Amount:</span> {money(selectedPurchase.amount_paid)}</div>
              <div><span className="text-slate-500">Payment:</span> <StatusBadge status={selectedPurchase.payment_status} /></div>
              <div><span className="text-slate-500">Purchase:</span> <StatusBadge status={selectedPurchase.status} /></div>
              <div><span className="text-slate-500">Balance:</span> {selectedPurchase.available_rides} available, {selectedPurchase.used_rides} used, {selectedPurchase.reserved_rides} reserved</div>
              <div><span className="text-slate-500">Expires:</span> {dateTime(selectedPurchase.expires_at)}</div>
            </section>

            <section>
              <h3 className="mb-2 font-semibold text-white">Payment transactions</h3>
              {(selectedPurchase.payments || []).length ? (
                <div className="space-y-2">
                  {selectedPurchase.payments?.map((payment) => (
                    <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 p-3 text-sm">
                      <div>
                        <div className="font-mono text-cyan-400">{payment.payu_txnid || `TXN-${payment.id}`}</div>
                        <div className="text-xs text-slate-500">{payment.payment_gateway || '—'} · {payment.payment_method || '—'} · {dateTime(payment.created_at)}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-emerald-400">{money(payment.amount, payment.currency || 'INR')}</span>
                        <StatusBadge status={payment.status} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">No payment transactions recorded.</p>}
            </section>

            <section>
              <h3 className="mb-2 font-semibold text-white">Ride usage history</h3>
              {(selectedPurchase.usage || []).length ? (
                <div className="space-y-2">
                  {selectedPurchase.usage?.map((usage) => (
                    <div key={usage.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 p-3 text-sm">
                      <div>
                        <div className="text-white">{usage.booking?.booking_reference || `Booking #${usage.id}`}</div>
                        <div className="text-xs text-slate-500">
                          {usage.booking?.travel_date || '—'} · {usage.rides_count} ride(s) · {usage.booking?.booking_status || '—'}
                        </div>
                      </div>
                      <StatusBadge status={usage.status} />
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">No rides reserved or used yet.</p>}
            </section>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};
