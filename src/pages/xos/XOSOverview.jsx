import { Link } from 'react-router-dom';
import { FileText, FolderOpen, Package, ShoppingBag } from 'lucide-react';
import { useXosCapabilities, useXosFiles, useXosOrders, useXosProductSummary, useXosRequests } from '@/lib/useXosData';
import { getClientSafeOrderStatus } from '@/lib/xosOrderStatus';
import { getClientSafeRequestStatus } from '@/lib/xosRequestStatus';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, StatusBadge, formatCurrency, formatDate } from './xosUi';

// Overview intentionally fetches small, distinct limits from Orders/Requests
// - it is a summary, not the full module list (see useXosData.js). A tenant
// with more than these limits worth of activity will not see an exact
// lifetime count here; that's fine for "what needs my attention right now."
const OVERVIEW_ORDERS_LIMIT = 10;
const OVERVIEW_REQUESTS_LIMIT = 10;
const OVERVIEW_FILES_LIMIT = 5;
// Products intentionally does NOT use a capped list + .length here - see
// useXosProductSummary(). A capped list's length silently reads as an
// accurate total once a tenant exceeds the cap, which get_xos_product_
// summary_for_host's dedicated aggregate avoids by construction.

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function MetricCard({ icon: Icon, label, value, to }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xl font-semibold tracking-tight text-zinc-950">{value}</p>
        <p className="text-xs text-zinc-500">{label}</p>
      </div>
    </Link>
  );
}

export default function XOSOverview({ gate }) {
  const orders = useXosOrders({ hostname: gate.hostname, limit: OVERVIEW_ORDERS_LIMIT });
  const requests = useXosRequests({ hostname: gate.hostname, limit: OVERVIEW_REQUESTS_LIMIT });
  const files = useXosFiles({ hostname: gate.hostname, limit: OVERVIEW_FILES_LIMIT });
  const capabilities = useXosCapabilities({ hostname: gate.hostname });
  const productsEnabled = Boolean(capabilities.data?.products?.enabled);
  const productSummary = useXosProductSummary({ hostname: gate.hostname, enabled: productsEnabled });

  const loading = orders.isLoading || requests.isLoading || files.isLoading || capabilities.isLoading || (productsEnabled && productSummary.isLoading);
  const anyError = orders.error || requests.error || files.error || (productsEnabled && productSummary.error);

  const openRequests = (requests.data || []).filter((r) => r.status !== 'actioned' && r.status !== 'closed');
  const onHoldOrders = (orders.data || []).filter((o) => getClientSafeOrderStatus(o).key === 'on_hold');
  const needsAttention = [...onHoldOrders.map((o) => ({ type: 'order', item: o })), ...openRequests.slice(0, 3).map((r) => ({ type: 'request', item: r }))].slice(0, 5);

  return (
    <div className="pb-12">
      <PageHeader
        title={`${greeting()}${gate.tenant_name ? `, ${gate.tenant_name}` : ''}`}
        description="Here's what needs your attention."
      />

      <div className="px-4 py-6 sm:px-6">
        {loading && <ListSkeleton rows={3} />}

        {!loading && anyError && (
          <ErrorState message="Some data on this page couldn't load. Try Orders, Requests, or Files directly." />
        )}

        {!loading && !anyError && (
          <>
            <section className={`grid gap-3 sm:grid-cols-2 ${productsEnabled ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
              <MetricCard icon={Package} label="Orders" value={orders.data?.length ?? 0} to="/orders" />
              {productsEnabled && (
                <MetricCard icon={ShoppingBag} label="Products" value={productSummary.data?.total ?? 0} to="/products" />
              )}
              <MetricCard icon={FileText} label="Open requests" value={openRequests.length} to="/requests" />
              <MetricCard icon={FolderOpen} label="Files" value={files.data?.length ?? 0} to="/files" />
            </section>

            {needsAttention.length > 0 && (
              <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h2 className="text-sm font-semibold text-amber-900">Needs attention</h2>
                <ul className="mt-3 space-y-2">
                  {needsAttention.map(({ type, item }, i) => (
                    <li key={`${type}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                      <Link
                        to={type === 'order' ? '/orders' : '/requests'}
                        className="min-w-0 truncate text-amber-900 hover:underline"
                      >
                        {type === 'order' ? `Order ${item.order_number}` : item.title}
                      </Link>
                      <StatusBadge
                        label={type === 'order' ? getClientSafeOrderStatus(item).label : getClientSafeRequestStatus(item.status)}
                        tone={type === 'order' ? getClientSafeOrderStatus(item).tone : 'warning'}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-6 grid gap-5 lg:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white">
                <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
                  <h2 className="text-sm font-semibold text-zinc-900">Recent orders</h2>
                  <Link to="/orders" className="text-xs font-medium text-zinc-500 hover:text-zinc-900">
                    View all
                  </Link>
                </div>
                {(orders.data || []).length === 0 ? (
                  <EmptyState title="No orders yet." description="New orders will appear here." />
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {(orders.data || []).slice(0, 5).map((order) => {
                      const clientStatus = getClientSafeOrderStatus(order);
                      return (
                        <li key={order.order_number} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-900">{order.order_number}</p>
                            <p className="text-xs text-zinc-500">{formatDate(order.created_at)} &middot; {formatCurrency(order.total_amount)}</p>
                          </div>
                          <StatusBadge label={clientStatus.label} tone={clientStatus.tone} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white">
                <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
                  <h2 className="text-sm font-semibold text-zinc-900">Recent requests</h2>
                  <Link to="/requests" className="text-xs font-medium text-zinc-500 hover:text-zinc-900">
                    View all
                  </Link>
                </div>
                {(requests.data || []).length === 0 ? (
                  <EmptyState title="No requests yet." description="Requests you send will appear here." />
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {(requests.data || []).slice(0, 5).map((request) => (
                      <li key={request.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-900">{request.title}</p>
                          <p className="text-xs text-zinc-500">{formatDate(request.created_at)}</p>
                        </div>
                        <StatusBadge label={getClientSafeRequestStatus(request.status)} tone="neutral" />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
