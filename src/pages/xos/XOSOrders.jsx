import { useMemo, useState } from 'react';
import { ImageOff, Search } from 'lucide-react';
import { useXosOrderDetail, useXosOrders } from '@/lib/useXosData';
import { getClientSafeOrderStatus, getOrderStageDetail } from '@/lib/xosOrderStatus';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, StatusBadge, formatCurrency, formatDate } from './xosUi';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'in_production', label: 'In Production' },
  { value: 'quality_check', label: 'Quality Check' },
  { value: 'ready', label: 'Ready' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'completed', label: 'Completed' },
  { value: 'on_hold', label: 'On Hold' },
];

function ItemThumb({ imageUrl, name }) {
  if (!imageUrl) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400">
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={imageUrl}
      alt={name || 'Item'}
      className="h-12 w-12 shrink-0 rounded-lg object-cover"
      loading="lazy"
    />
  );
}

function OrderItemsSection({ hostname, orderNumber, open }) {
  const { data, isLoading, error, refetch } = useXosOrderDetail({ hostname, orderNumber, enabled: open });

  if (isLoading) {
    return (
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Items</p>
        <ListSkeleton rows={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Items</p>
        <ErrorState message={error.message} onRetry={refetch} />
      </div>
    );
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Items</p>
      <ul className="space-y-3">
        {items.map((item, i) => {
          const variant = [item.size, item.color].filter(Boolean).join(' / ');
          return (
            <li key={i} className="flex items-center gap-3">
              <ItemThumb imageUrl={item.image_url} name={item.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">{item.name}</p>
                <p className="text-xs text-zinc-500">
                  {[variant, item.quantity ? `Qty ${item.quantity}` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              {item.price != null && (
                <p className="shrink-0 text-sm font-medium text-zinc-900">{formatCurrency(item.price)}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OrderDetailSheet({ order, hostname, onClose }) {
  const clientStatus = order ? getClientSafeOrderStatus(order) : null;
  const open = Boolean(order);
  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {order && (
          <>
            <SheetHeader>
              <SheetTitle>{order.order_number}</SheetTitle>
            </SheetHeader>
            <div className="mt-5 space-y-5">
              <div>
                <StatusBadge label={clientStatus.label} tone={clientStatus.tone} />
                <p className="mt-2 text-sm leading-6 text-zinc-600">{getOrderStageDetail(order)}</p>
              </div>

              {order.summary && (
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Update</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-700">{order.summary}</p>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-zinc-500">Placed</dt>
                  <dd className="mt-0.5 font-medium text-zinc-900">{formatDate(order.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Due</dt>
                  <dd className="mt-0.5 font-medium text-zinc-900">{formatDate(order.due_date)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Items</dt>
                  <dd className="mt-0.5 font-medium text-zinc-900">{order.item_count ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Total</dt>
                  <dd className="mt-0.5 font-medium text-zinc-900">{formatCurrency(order.total_amount)}</dd>
                </div>
                {order.client_name && (
                  <div className="col-span-2">
                    <dt className="text-xs text-zinc-500">Customer</dt>
                    <dd className="mt-0.5 font-medium text-zinc-900">{order.client_name}</dd>
                  </div>
                )}
                {order.tracking_reference && (
                  <div className="col-span-2">
                    <dt className="text-xs text-zinc-500">Tracking reference</dt>
                    <dd className="mt-0.5 font-medium text-zinc-900">{order.tracking_reference}</dd>
                  </div>
                )}
              </dl>

              <OrderItemsSection hostname={hostname} orderNumber={order.order_number} open={open} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function XOSOrders({ gate }) {
  const { data, isLoading, error, refetch } = useXosOrders({ hostname: gate.hostname, limit: 50 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);

  const filtered = useMemo(() => {
    const orders = data || [];
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      const clientStatus = getClientSafeOrderStatus(order);
      if (statusFilter !== 'all' && clientStatus.key !== statusFilter) return false;
      if (!term) return true;
      return (
        order.order_number?.toLowerCase().includes(term) ||
        order.client_name?.toLowerCase().includes(term)
      );
    });
  }, [data, search, statusFilter]);

  return (
    <div className="pb-12">
      <PageHeader title="Orders" description="Read-only progress for orders in this workspace." />

      <div className="border-b border-zinc-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order number or customer"
              aria-label="Search orders"
              className="h-9 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <ListSkeleton />}
      {!isLoading && error && <ErrorState message={error.message} onRetry={refetch} />}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          title={data?.length ? 'No orders match your search.' : 'No orders yet.'}
          description={data?.length ? 'Try a different search or filter.' : 'New orders will appear here.'}
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden px-4 py-4 sm:px-6 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tracking</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((order) => {
                  const clientStatus = getClientSafeOrderStatus(order);
                  return (
                    <TableRow
                      key={order.order_number}
                      className="cursor-pointer"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <TableCell className="font-medium text-zinc-900">{order.order_number}</TableCell>
                      <TableCell className="text-zinc-600">{order.client_name}</TableCell>
                      <TableCell className="text-zinc-600">{formatDate(order.created_at)}</TableCell>
                      <TableCell className="text-zinc-600">{order.item_count}</TableCell>
                      <TableCell className="text-zinc-600">{formatCurrency(order.total_amount)}</TableCell>
                      <TableCell><StatusBadge label={clientStatus.label} tone={clientStatus.tone} /></TableCell>
                      <TableCell className="text-zinc-500">{order.tracking_reference || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 px-4 py-4 sm:px-6 md:hidden">
            {filtered.map((order) => {
              const clientStatus = getClientSafeOrderStatus(order);
              return (
                <button
                  key={order.order_number}
                  type="button"
                  onClick={() => setSelectedOrder(order)}
                  className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-950">{order.order_number}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{order.client_name}</p>
                    </div>
                    <StatusBadge label={clientStatus.label} tone={clientStatus.tone} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                    <span>{formatDate(order.created_at)}</span>
                    <span>{formatCurrency(order.total_amount)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <OrderDetailSheet order={selectedOrder} hostname={gate.hostname} onClose={() => setSelectedOrder(null)} />
    </div>
  );
}
