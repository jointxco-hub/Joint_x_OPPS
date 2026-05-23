// ── Revenue categories ───────────────────────────────────────
export const REVENUE_CATEGORIES = {
  product_sales:      'Product Sales',
  custom_orders:      'Custom Orders',
  printing_services:  'Printing Services',
  setup_fees:         'Setup Fees',
  subscription_income:'Subscription Income',
  delivery_income:    'Delivery Income',
  other_income:       'Other Income',
};

// ── Expense categories ───────────────────────────────────────
export const EXPENSE_CATEGORIES = {
  blank_garments:      'Blank Garments',
  printing_supplies:   'Printing Supplies',
  packaging:           'Packaging',
  courier_delivery:    'Courier / Delivery',
  software_subs:       'Software Subscriptions',
  equipment:           'Equipment',
  marketing_ads:       'Marketing / Ads',
  labour_contractor:   'Labour / Contractor',
  rent_utilities:      'Rent & Utilities',
  refunds:             'Refunds',
  bank_fees:           'Bank / Payment Fees',
  admin_operations:    'Admin / Operations',
  other_expense:       'Other Expense',
};

// Map legacy expense_category values (from AddExpenseDrawer) to new keys
export const LEGACY_CATEGORY_MAP = {
  production:      'printing_supplies',
  raw_materials:   'blank_garments',
  packaging:       'packaging',
  shipping:        'courier_delivery',
  marketing:       'marketing_ads',
  software:        'software_subs',
  rent_utilities:  'rent_utilities',
  wages:           'labour_contractor',
  admin:           'admin_operations',
  owner_drawings:  'other_expense',
};

export const TRANSACTION_SOURCES = {
  xlab_order:     'X LAB Order',
  x1_store:       'X1 Store',
  manual_expense: 'Manual Expense',
  manual_income:  'Manual Income',
  payfast:        'PayFast',
  opps:           'OPPS',
  test:           'Test',
  other:          'Other',
};

// ── Buying list categories ───────────────────────────────────
export const BUYING_CATEGORIES = {
  equipment:           'Equipment',
  stock_blanks:        'Stock / Blanks',
  printing_supplies:   'Printing Supplies',
  packaging:           'Packaging',
  software:            'Software',
  marketing:           'Marketing',
  delivery_logistics:  'Delivery / Logistics',
  studio_workspace:    'Studio / Workspace',
  team_labour:         'Team / Labour',
  other:               'Other',
};

// ── Budget bucket categories ─────────────────────────────────
export const BUDGET_CATEGORIES = {
  blanks_garments:    'Blanks & Garments',
  printing_supplies:  'Printing Supplies',
  packaging:          'Packaging',
  courier_costs:      'Courier Costs',
  ads_marketing:      'Ads & Marketing',
  software_tools:     'Software Tools',
  equipment_savings:  'Equipment Savings',
  emergency_buffer:   'Emergency Buffer',
  other:              'Other',
};

// ── Helpers ──────────────────────────────────────────────────
export function getExpenseCategoryLabel(raw) {
  if (!raw) return 'Uncategorized';
  const mapped = LEGACY_CATEGORY_MAP[raw] || raw;
  return EXPENSE_CATEGORIES[mapped] || EXPENSE_CATEGORIES[raw] || raw;
}

export function getRevenueCategoryLabel(raw) {
  if (!raw) return 'Uncategorized';
  return REVENUE_CATEGORIES[raw] || raw;
}
