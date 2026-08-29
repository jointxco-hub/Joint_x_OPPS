import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImageOff, Search } from 'lucide-react';
import { useXosProducts } from '@/lib/useXosData';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, StatusBadge, formatCurrency } from './xosUi';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'out_of_stock', label: 'Out of stock' },
];

const STATUS_TONE = { published: 'success', draft: 'neutral', archived: 'neutral' };

function matchesFilter(product, filter) {
  if (filter === 'all') return true;
  if (filter === 'out_of_stock') return product.availability === 'out_of_stock';
  return product.status === filter;
}

function displayPrice(product) {
  const hasSale = product.sale_price != null && product.price != null && Number(product.sale_price) < Number(product.price);
  return {
    main: formatCurrency(hasSale ? product.sale_price : product.price),
    strikethrough: hasSale ? formatCurrency(product.price) : null,
  };
}

function ProductThumb({ imageUrl, name, className = 'h-12 w-12' }) {
  if (!imageUrl) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 ${className}`}>
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return <img src={imageUrl} alt={name || 'Product'} className={`shrink-0 rounded-lg object-cover ${className}`} loading="lazy" />;
}

function ProductDetailSheet({ product, onClose }) {
  const open = Boolean(product);
  const price = product ? displayPrice(product) : null;
  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {product && (
          <>
            <SheetHeader>
              <SheetTitle>{product.name}</SheetTitle>
            </SheetHeader>
            <div className="mt-5 space-y-5">
              <ProductThumb imageUrl={product.primary_image_url} name={product.name} className="h-40 w-full" />

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={product.status} tone={STATUS_TONE[product.status] || 'neutral'} />
                <StatusBadge
                  label={product.availability?.replace(/_/g, ' ')}
                  tone={product.availability === 'available' ? 'success' : product.availability === 'out_of_stock' ? 'destructive' : 'warning'}
                />
              </div>

              {product.description && (
                <p className="text-sm leading-6 text-zinc-600">{product.description}</p>
              )}

              <div>
                <p className="text-xs text-zinc-500">Price</p>
                <p className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-lg font-semibold text-zinc-950">{price.main}</span>
                  {price.strikethrough && <span className="text-sm text-zinc-400 line-through">{price.strikethrough}</span>}
                </p>
              </div>

              {product.variants?.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Variants ({product.variants.length})
                  </p>
                  <ul className="space-y-2">
                    {product.variants.map((variant) => {
                      const variantLabel = [variant.title, variant.size, variant.color].filter(Boolean).join(' / ') || variant.sku || 'Variant';
                      return (
                        <li key={variant.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-zinc-900">{variantLabel}</p>
                            {variant.sku && <p className="text-xs text-zinc-500">SKU {variant.sku}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {variant.price_override != null && (
                              <span className="text-xs text-zinc-500">{formatCurrency(variant.price_override)}</span>
                            )}
                            <StatusBadge
                              label={variant.availability?.replace(/_/g, ' ')}
                              tone={variant.availability === 'available' ? 'success' : variant.availability === 'out_of_stock' ? 'destructive' : 'warning'}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function XOSProducts({ gate }) {
  const { data, isLoading, error, refetch } = useXosProducts({ hostname: gate.hostname, limit: 50 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState(null);

  const filtered = useMemo(() => {
    const products = data || [];
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      if (!matchesFilter(product, statusFilter)) return false;
      if (!term) return true;
      const skuMatch = (product.variants || []).some((v) => v.sku?.toLowerCase().includes(term));
      return product.name?.toLowerCase().includes(term) || skuMatch;
    });
  }, [data, search, statusFilter]);

  return (
    <div className="pb-12">
      <PageHeader title="Products" description="Your managed product catalog." />

      {!isLoading && !error && (data || []).length > 0 && (
        <div className="border-b border-zinc-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or SKU"
                aria-label="Search products"
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
      )}

      {isLoading && <ListSkeleton />}
      {!isLoading && error && <ErrorState message={error.message} onRetry={refetch} />}

      {!isLoading && !error && (data || []).length === 0 && (
        <div className="px-4 py-14 text-center sm:px-6">
          <p className="text-sm font-medium text-zinc-700">No products yet</p>
          <p className="mt-1 text-sm text-zinc-500">Products managed for this workspace will appear here.</p>
          <Link
            to="/requests"
            className="mx-auto mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Request product setup
          </Link>
        </div>
      )}

      {!isLoading && !error && (data || []).length > 0 && filtered.length === 0 && (
        <EmptyState title="No products match your search." description="Try a different search or filter." />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden px-4 py-4 sm:px-6 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Variants</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((product) => {
                  const price = displayPrice(product);
                  return (
                    <TableRow key={product.id} className="cursor-pointer" onClick={() => setSelectedProduct(product)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ProductThumb imageUrl={product.primary_image_url} name={product.name} />
                          <span className="font-medium text-zinc-900">{product.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-zinc-600">
                        <span className="flex items-baseline gap-2">
                          {price.main}
                          {price.strikethrough && <span className="text-xs text-zinc-400 line-through">{price.strikethrough}</span>}
                        </span>
                      </TableCell>
                      <TableCell className="text-zinc-600">{product.variants?.length ?? 0}</TableCell>
                      <TableCell>
                        <StatusBadge
                          label={product.availability?.replace(/_/g, ' ')}
                          tone={product.availability === 'available' ? 'success' : product.availability === 'out_of_stock' ? 'destructive' : 'warning'}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusBadge label={product.status} tone={STATUS_TONE[product.status] || 'neutral'} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 px-4 py-4 sm:px-6 md:hidden">
            {filtered.map((product) => {
              const price = displayPrice(product);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => setSelectedProduct(product)}
                  className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-left"
                >
                  <ProductThumb imageUrl={product.primary_image_url} name={product.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-950">{product.name}</p>
                    <p className="mt-0.5 flex items-baseline gap-2 text-xs text-zinc-500">
                      {price.main}
                      {price.strikethrough && <span className="line-through">{price.strikethrough}</span>}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge label={product.status} tone={STATUS_TONE[product.status] || 'neutral'} />
                      <StatusBadge
                        label={product.availability?.replace(/_/g, ' ')}
                        tone={product.availability === 'available' ? 'success' : product.availability === 'out_of_stock' ? 'destructive' : 'warning'}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <ProductDetailSheet product={selectedProduct} onClose={() => setSelectedProduct(null)} />
    </div>
  );
}
