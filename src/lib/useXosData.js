import { useQuery } from '@tanstack/react-query';
import { getXosOrderDetail, getXosProductSummary, listXosCapabilities, listXosFiles, listXosOrders, listXosProducts, listXosRequests } from '@/lib/xosModules';

// Each hook is its own query with its own limit, so Overview's small
// summary fetch and a module page's full list fetch are independently
// cached and requested - visiting Overview does not pull every order,
// and visiting Orders does not also pull Requests/Files.
function unwrap(result) {
  if (result.error) throw new Error(result.error);
  return result.data;
}

export function useXosOrders({ hostname, limit, enabled = true }) {
  return useQuery({
    queryKey: ['xos-orders', hostname, limit],
    queryFn: () => listXosOrders({ hostname, limit }).then(unwrap),
    enabled: enabled && Boolean(hostname),
    staleTime: 30_000,
  });
}

// Fetched only when an order detail sheet is actually open (see
// XOSOrders.jsx) - the Orders list never pulls item arrays.
export function useXosOrderDetail({ hostname, orderNumber, enabled = true }) {
  return useQuery({
    queryKey: ['xos-order-detail', hostname, orderNumber],
    queryFn: () => getXosOrderDetail({ hostname, orderNumber }).then(unwrap),
    enabled: enabled && Boolean(hostname) && Boolean(orderNumber),
    staleTime: 30_000,
  });
}

// Gates nav/route visibility, so this fails closed rather than throwing -
// any error resolving capabilities is treated as "nothing enabled"
// rather than breaking the workspace shell.
export function useXosCapabilities({ hostname, enabled = true }) {
  return useQuery({
    queryKey: ['xos-capabilities', hostname],
    queryFn: async () => {
      const result = await listXosCapabilities({ hostname });
      return result.error ? {} : result.data;
    },
    enabled: enabled && Boolean(hostname),
    staleTime: 30_000,
  });
}

export function useXosProducts({ hostname, limit, enabled = true }) {
  return useQuery({
    queryKey: ['xos-products', hostname, limit],
    queryFn: () => listXosProducts({ hostname, limit }).then(unwrap),
    enabled: enabled && Boolean(hostname),
    staleTime: 30_000,
  });
}

// Aggregate counts, not a capped list - see getXosProductSummary(). Used
// by Overview instead of useXosProducts()'s .data.length.
export function useXosProductSummary({ hostname, enabled = true }) {
  return useQuery({
    queryKey: ['xos-product-summary', hostname],
    queryFn: () => getXosProductSummary({ hostname }).then(unwrap),
    enabled: enabled && Boolean(hostname),
    staleTime: 30_000,
  });
}

export function useXosRequests({ hostname, limit, enabled = true }) {
  return useQuery({
    queryKey: ['xos-requests', hostname, limit],
    queryFn: () => listXosRequests({ hostname, limit }).then(unwrap),
    enabled: enabled && Boolean(hostname),
    staleTime: 30_000,
  });
}

export function useXosFiles({ hostname, limit, enabled = true }) {
  return useQuery({
    queryKey: ['xos-files', hostname, limit],
    queryFn: () => listXosFiles({ hostname, limit }).then(unwrap),
    enabled: enabled && Boolean(hostname),
    staleTime: 30_000,
  });
}
