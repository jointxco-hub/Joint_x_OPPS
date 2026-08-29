// XOS 2.7C — QA/test order hygiene: classification display helper.
//
// is_test and excluded_from_reports are independent booleans (see the
// 20260829130000_xos_2_7c_test_order_hygiene.sql migration header for the
// full model). This module is the single place that turns those two
// booleans into a display label, so every surface (Orders list/table,
// mobile order card, kanban card, OrderDrawer) renders the exact same
// wording rather than a per-surface reimplementation - same discipline
// already used for tenant identity (src/lib/tenantDisplay.js) and status
// (src/lib/xosOrderStatus.js).
//
// Deliberately conservative: returns null (render nothing) when neither
// flag is set, so ordinary real orders are never overbadged.

export function getOrderClassificationBadge(order) {
  const isTest = Boolean(order?.is_test);
  const excluded = Boolean(order?.excluded_from_reports);

  if (!isTest && !excluded) return null;
  if (isTest && excluded) {
    return {
      key: "test-excluded",
      label: "Test · Excluded",
      title: "QA/test order, excluded from operational counts, finance totals, production queues and XOS.",
    };
  }
  if (isTest) {
    return {
      key: "test",
      label: "Test",
      title: "QA/test order. Still counted operationally unless also excluded from reports.",
    };
  }
  return {
    key: "excluded",
    label: "Excluded",
    title: "Excluded from operational counts, finance totals, production queues and XOS.",
  };
}
