import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import {
  getOrderProductionReadiness,
  isValidReadinessOrderId,
} from "@/api/productionReadiness";

const PAYMENTS_STALE_TIME = 60_000;
const PAYMENTS_GC_TIME = 10 * 60_000;
const TASKS_STALE_TIME = 30_000;
const READINESS_STALE_TIME = 30_000;
const CLIENT_STALE_TIME = 120_000;
const DIRECTORY_STALE_TIME = 300_000;
const PURCHASE_ORDERS_STALE_TIME = 60_000;
const READINESS_GC_TIME = 10 * 60_000;
const readinessAuthBlockedOrderIds = new Set();

function isReadinessAuthError(message = "") {
  const lower = String(message || "").toLowerCase();
  return lower.includes("not authorised")
    || lower.includes("not authorized")
    || lower.includes("permission denied")
    || lower.includes("row-level security");
}

function markDrawerDataPerf(name) {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  try {
    performance.mark(name);
  } catch {
    // Dev-only diagnostics should never affect drawer behavior.
  }
}

function measureDrawerDataPerf(name, start, end) {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  try {
    performance.measure(name, start, end);
  } catch {
    // Missing marks are fine during partial manual testing.
  }
}

async function fetchOrderProductionReadiness(orderId) {
  if (readinessAuthBlockedOrderIds.has(orderId)) {
    throw new Error("Not authorised to view production readiness.");
  }
  if (import.meta.env.DEV) {
    console.debug("[OrderDrawer readiness query]", {
      orderId,
      activeTab: "readiness",
      queryKey: ["productionReadiness", orderId],
      at: new Date().toISOString(),
      caller: "useOrderDrawerData",
    });
  }
  const result = await getOrderProductionReadiness(orderId);
  if (result.error) {
    if (isReadinessAuthError(result.error)) {
      readinessAuthBlockedOrderIds.add(orderId);
    }
    throw new Error(result.error);
  }
  return result.data;
}

async function fetchLinkedClient(clientId) {
  if (!clientId) return null;
  const rows = await dataClient.entities.Client.filter({ id: clientId }, "-updated_date", 1);
  return rows?.[0] || null;
}

export function useOrderDrawerData(order, activeTab = "details") {
  const queryClient = useQueryClient();
  const orderId = order?.id;
  const clientId = order?.client_id;
  const canLoadReadiness = isValidReadinessOrderId(orderId);
  const readinessAuthBlocked = readinessAuthBlockedOrderIds.has(orderId);

  const paymentsQuery = useQuery({
    queryKey: ["payments", orderId],
    queryFn: () => dataClient.entities.Payment.filter({ order_id: orderId }),
    enabled: Boolean(orderId),
    staleTime: PAYMENTS_STALE_TIME,
    gcTime: PAYMENTS_GC_TIME,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === orderId ? previousData : undefined,
  });

  const legacyTasksQuery = useQuery({
    queryKey: ["orderTasks", orderId],
    queryFn: () => dataClient.entities.Task.filter({ linked_order_id: orderId }),
    enabled: activeTab === "tasks" && Boolean(orderId),
    staleTime: TASKS_STALE_TIME,
  });

  const opsTasksQuery = useQuery({
    queryKey: ["orderOpsTasks", orderId],
    queryFn: () => dataClient.entities.OpsTask.filter({ order_id: orderId }),
    enabled: activeTab === "tasks" && Boolean(orderId),
    staleTime: TASKS_STALE_TIME,
  });

  const purchaseOrdersQuery = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => dataClient.entities.PurchaseOrder.list("-created_date", 100),
    enabled: activeTab === "po" || Boolean(order?.linked_po_id),
    staleTime: PURCHASE_ORDERS_STALE_TIME,
  });

  const usersQuery = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => dataClient.entities.User.list("name", 100),
    enabled: activeTab === "details" || activeTab === "tasks",
    staleTime: DIRECTORY_STALE_TIME,
  });

  const linkedClientQuery = useQuery({
    queryKey: ["orderClient", clientId],
    queryFn: () => fetchLinkedClient(clientId),
    enabled: Boolean(clientId),
    staleTime: CLIENT_STALE_TIME,
  });

  const readinessQuery = useQuery({
    queryKey: ["productionReadiness", orderId],
    queryFn: () => fetchOrderProductionReadiness(orderId),
    enabled: activeTab === "readiness" && canLoadReadiness && !readinessAuthBlocked,
    staleTime: READINESS_STALE_TIME,
    gcTime: READINESS_GC_TIME,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    markDrawerDataPerf("opps:drawer-data-hook-started");
    markDrawerDataPerf("opps:critical-tab-prefetch-started");

    const prefetches = [
      queryClient.prefetchQuery({
        queryKey: ["orderTasks", orderId],
        queryFn: () => dataClient.entities.Task.filter({ linked_order_id: orderId }),
        staleTime: TASKS_STALE_TIME,
      }),
      queryClient.prefetchQuery({
        queryKey: ["orderOpsTasks", orderId],
        queryFn: () => dataClient.entities.OpsTask.filter({ order_id: orderId }),
        staleTime: TASKS_STALE_TIME,
      }),
    ];

    if (clientId) {
      prefetches.push(queryClient.prefetchQuery({
        queryKey: ["orderClient", clientId],
        queryFn: () => fetchLinkedClient(clientId),
        staleTime: CLIENT_STALE_TIME,
      }));
    }

    Promise.allSettled(prefetches).finally(() => {
      if (cancelled) return;
      markDrawerDataPerf("opps:critical-tab-prefetch-completed");
      measureDrawerDataPerf(
        "opps:critical-tab-prefetch-duration",
        "opps:critical-tab-prefetch-started",
        "opps:critical-tab-prefetch-completed"
      );
    });

    return () => {
      cancelled = true;
    };
  }, [clientId, orderId, queryClient]);

  const payments = Array.isArray(paymentsQuery.data) ? paymentsQuery.data : [];
  const legacyTasks = Array.isArray(legacyTasksQuery.data) ? legacyTasksQuery.data : [];
  const opsTasks = Array.isArray(opsTasksQuery.data) ? opsTasksQuery.data : [];
  const linkedTasks = useMemo(() => [...legacyTasks, ...opsTasks], [legacyTasks, opsTasks]);
  const purchaseOrders = Array.isArray(purchaseOrdersQuery.data) ? purchaseOrdersQuery.data : [];
  const users = Array.isArray(usersQuery.data) ? usersQuery.data : [];
  const linkedClient = linkedClientQuery.data || null;
  const invoiceFiles = Array.isArray(order?.invoice_files) ? order.invoice_files : [];
  const fileUrls = Array.isArray(order?.file_urls) ? order.file_urls.filter(Boolean) : [];
  const portalVisibleFileUrls = Array.isArray(order?.portal_visible_file_urls) ? order.portal_visible_file_urls.filter(Boolean) : [];

  const linkedPO = useMemo(
    () => purchaseOrders.find((po) => po.id === order?.linked_po_id),
    [order?.linked_po_id, purchaseOrders]
  );

  const activePOs = useMemo(
    () => purchaseOrders.filter((po) => ["draft", "pending", "approved", "ordered", "partial"].includes(po.status)),
    [purchaseOrders]
  );

  const displayClientEmail = order?.client_email || linkedClient?.email || linkedClient?.client_email || "";
  const displayWhatsappName = order?.whatsapp_name || linkedClient?.whatsapp_name || "";
  const displaySavedContactName = order?.saved_contact_name || linkedClient?.saved_contact_name || "";
  const clientDisplay = {
    name: order?.client_name || linkedClient?.name || linkedClient?.client_name || "Client",
    email: displayClientEmail,
    whatsappName: displayWhatsappName,
    savedContactName: displaySavedContactName,
    source: linkedClient ? "client" : "order",
  };

  const fetchedTotalPaid = useMemo(
    () => payments
      .filter((payment) => payment.status === "completed")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [payments]
  );

  const totalPaid = paymentsQuery.isLoading && payments.length === 0
    ? Number(order?.deposit_paid || 0)
    : fetchedTotalPaid;
  const latestInvoiceTotal = [...invoiceFiles]
    .reverse()
    .map((invoice) => Number(invoice?.invoice_total || 0))
    .find((amount) => amount > 0) || 0;
  const payableTotal = Number(latestInvoiceTotal || order?.total_amount || 0);
  const balance = Math.max(payableTotal - totalPaid, 0);
  const paymentCount = payments.length;
  const legacyTaskCount = legacyTasks.length;
  const opsTaskCount = opsTasks.length;
  const linkedTaskCount = linkedTasks.length;
  const linkedPOCount = linkedPO ? 1 : 0;
  const invoiceCount = invoiceFiles.length;
  const fileCount = fileUrls.length;
  const portalVisibleFileCount = portalVisibleFileUrls.length;
  const hasLinkedPO = Boolean(linkedPO);
  const hasPayments = paymentCount > 0;
  const hasTasks = linkedTaskCount > 0;
  const hasInvoices = invoiceCount > 0;
  const hasFiles = fileCount > 0;
  const paymentsLoading = paymentsQuery.isLoading && paymentCount === 0;
  const tasksLoading = (legacyTasksQuery.isLoading || opsTasksQuery.isLoading) && linkedTaskCount === 0;
  const paymentsError = paymentsQuery.error || null;
  const tasksError = legacyTasksQuery.error || opsTasksQuery.error || null;
  const purchaseOrdersError = purchaseOrdersQuery.error || null;

  const readinessSummary = readinessQuery.data?.summary || null;

  const criticalReady = !paymentsQuery.isLoading
    && !linkedClientQuery.isLoading
    && (legacyTasksQuery.data !== undefined || activeTab !== "tasks")
    && (opsTasksQuery.data !== undefined || activeTab !== "tasks");

  useEffect(() => {
    if (!criticalReady) return;
    markDrawerDataPerf("opps:drawer-critical-data-ready");
    measureDrawerDataPerf(
      "opps:drawer-critical-data-duration",
      "opps:drawer-data-hook-started",
      "opps:drawer-critical-data-ready"
    );
  }, [criticalReady, orderId]);

  return {
    payments,
    paymentsQuery,
    legacyTasks,
    legacyTasksQuery,
    opsTasks,
    opsTasksQuery,
    linkedTasks,
    purchaseOrders,
    purchaseOrdersQuery,
    users,
    usersQuery,
    linkedClient,
    linkedClientQuery,
    linkedPO,
    activePOs,
    hasLinkedPO,
    readiness: readinessQuery.data,
    readinessSummary,
    readinessQuery: {
      ...readinessQuery,
      isAuthorizationBlocked: readinessAuthBlocked,
      canLoad: canLoadReadiness,
      queryKey: ["productionReadiness", orderId],
    },
    displayClientEmail,
    displayWhatsappName,
    displaySavedContactName,
    clientDisplay,
    totalPaid,
    balance,
    payableTotal,
    paymentCount,
    legacyTaskCount,
    opsTaskCount,
    linkedTaskCount,
    linkedPOCount,
    invoiceCount,
    fileCount,
    portalVisibleFileCount,
    hasPayments,
    hasTasks,
    hasInvoices,
    hasFiles,
    paymentsLoading,
    tasksLoading,
    paymentsError,
    tasksError,
    purchaseOrdersError,
    isCriticalDataReady: criticalReady,
    errors: {
      payments: paymentsQuery.error,
      legacyTasks: legacyTasksQuery.error,
      opsTasks: opsTasksQuery.error,
      purchaseOrders: purchaseOrdersQuery.error,
      users: usersQuery.error,
      linkedClient: linkedClientQuery.error,
      readiness: readinessQuery.error,
    },
  };
}
