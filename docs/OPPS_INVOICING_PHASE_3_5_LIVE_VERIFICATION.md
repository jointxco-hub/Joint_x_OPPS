# OPPS Invoicing Phase 3.5 Live Verification Pack

Use this guide to verify OPPS Invoicing in the real deployed environment with real Supabase roles and Zoho Books sample CSV files.

Do not request, paste, commit, or store credentials. Do not add direct Zoho API sync. Keep `/Invoices` as PascalCase. Keep `orders.invoice_files` and `orders.invoice_numbers` separate from OPPS-generated invoices.

## Live Verification Progress

Current confirmed status:

```md
## Migration
- Migration applied: yes
- Tables present: yes
- RPC present: yes
- RLS enabled: yes
```

Confirmed objects:

| Check | Result |
| --- | --- |
| `opps_invoice_number_sequences` table | Passed |
| `opps_invoices` table | Passed |
| `opps_invoice_items` table | Passed |
| `opps_invoice_exports` table | Passed |
| `public.next_opps_invoice_number()` RPC | Passed |
| RLS on `opps_invoices` | Passed |
| RLS on `opps_invoice_items` | Passed |
| RLS on `opps_invoice_exports` | Passed |

Next step: test the deployed OPPS app at `/Invoices` with admin, finance level 1, finance level 2, and unauthorized/non-finance users.

## 1. Supabase Migration Verification

Verify in the target Supabase project after deployment.

| Check | Expected | Result | Notes |
| --- | --- | --- | --- |
| Migration `202606180001_opps_invoicing.sql` applied | Yes |  |  |
| Table `opps_invoice_number_sequences` exists | Yes |  |  |
| Table `opps_invoices` exists | Yes |  |  |
| Table `opps_invoice_items` exists | Yes |  |  |
| Table `opps_invoice_exports` exists | Yes |  |  |
| RPC `public.next_opps_invoice_number()` exists | Yes |  |  |
| RLS enabled on `opps_invoices` | Yes |  |  |
| RLS enabled on `opps_invoice_items` | Yes |  |  |
| RLS enabled on `opps_invoice_exports` | Yes |  |  |

Suggested SQL checks:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'opps_invoice_number_sequences',
    'opps_invoices',
    'opps_invoice_items',
    'opps_invoice_exports'
  )
order by table_name;

select routine_schema, routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'next_opps_invoice_number';

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('opps_invoices', 'opps_invoice_items', 'opps_invoice_exports');
```

If a valid role fails access, inspect helper functions and policies first. Do not weaken RLS to make tests pass.

## 2. Role And RLS Test Checklist

Run these checks with real or temporary test users. Record the exact user role, finance level, browser, and timestamp.

Expected access:

| Role | Expected Access |
| --- | --- |
| Admin | Allowed |
| Finance level 1 | Allowed |
| Finance level 2 | Allowed |
| Unauthorized/non-finance | Blocked |

### Admin

| Check | Expected | Result | Notes |
| --- | --- | --- | --- |
| Sees Invoices nav item | Yes |  |  |
| Can open `/Invoices` | Yes |  |  |
| Can select invoice records | Yes |  |  |
| Can create invoice | Yes |  |  |
| Can update invoice | Yes |  |  |
| Can create export record | Yes |  |  |

### Finance Level 1

| Check | Expected | Result | Notes |
| --- | --- | --- | --- |
| Sees Invoices nav item | Yes |  |  |
| Can open `/Invoices` | Yes |  |  |
| Can select invoice records | Yes |  |  |
| Can create invoice | Yes |  |  |
| Can update invoice | Yes |  |  |
| Can create export record | Yes |  |  |

### Finance Level 2

| Check | Expected | Result | Notes |
| --- | --- | --- | --- |
| Sees Invoices nav item | Yes |  |  |
| Can open `/Invoices` | Yes |  |  |
| Can select invoice records | Yes |  |  |
| Can create invoice | Yes |  |  |
| Can update invoice | Yes |  |  |
| Can create export record | Yes |  |  |

### Unauthorized / Non-Finance User

| Check | Expected | Result | Notes |
| --- | --- | --- | --- |
| Sees Invoices nav item | No |  |  |
| Can open `/Invoices` successfully | No |  |  |
| Can select invoice records | No |  |  |
| Can create invoice | No |  |  |
| Can update invoice | No |  |  |
| Can create export record | No |  |  |

For blocked table checks, verify through the app if possible and through a safe Supabase SQL/API test using that user's session. Do not use service-role credentials for user-level RLS checks.

## 3. Browser QA Checklist

Use a safe test customer and make it obvious the record is for testing.

| Check | Expected | Result | Notes |
| --- | --- | --- | --- |
| Open `/Invoices` | Page loads |  |  |
| Create draft invoice | Draft saved with invoice number |  |  |
| Edit draft invoice | Changes save, invoice number does not regenerate |  |  |
| Approve invoice | Status becomes `approved` |  |  |
| Confirm approved invoice is locked | Edit action hidden/blocked with helper text |  |  |
| Duplicate approved invoice as new draft | New draft created with new invoice number |  |  |
| Mark partially paid | Status `partially_paid`, balance due recalculates |  |  |
| Mark paid | Status `paid`, amount paid equals total, balance due 0 |  |  |
| Mark void with confirmation | Confirmation appears, invoice becomes `void`, invoice is not deleted |  |  |
| Export customer CSV | CSV downloads, invoices are not marked exported |  |  |
| Export invoice CSV | CSV downloads |  |  |
| Export history before status update | Export history record exists for exported invoices |  |  |
| Mark exported invoice imported to Zoho | Status becomes `imported_to_zoho` with timestamp |  |  |
| Wording check | UI says manual upload/import, never direct Zoho sync |  |  |

Also confirm the existing uploaded Zoho invoice file/reference flow still works and that `orders.invoice_files` and `orders.invoice_numbers` are not changed by OPPS-generated invoices.

## 4. Mobile QA Checklist

Test at common mobile widths, for example 390 px and 430 px. Use browser dev tools or a real device.

| Area | Expected | Result | Notes |
| --- | --- | --- | --- |
| Invoice list | Readable, no unusable horizontal overflow |  |  |
| Create invoice flow | Steps and form controls fit and remain clear |  |  |
| Line item editor | Items can be added/edited without layout breakage |  |  |
| Invoice detail drawer | Scrolls correctly, actions are reachable |  |  |
| Partial payment dialog | Amount/note controls fit, buttons visible |  |  |
| Export Center | Step cards and actions stack cleanly |  |  |
| CSV preview tables | Horizontal scroll works, no page-breaking overflow |  |  |
| Long customer names | Truncate/wrap cleanly |  |  |
| Long item descriptions | Wrap cleanly without overlapping totals/actions |  |  |
| Buttons and stacked actions | No clipped labels, destructive action clear |  |  |

Fix only invoicing-related mobile issues found during this pass.

## 5. Zoho Books Sample CSV Alignment

Download the actual sample files from the organization's Zoho Books account. Do not guess final headers.

Invoice sample:

1. Open Zoho Books.
2. Go to `Sales > Invoices`.
3. Open `More > Import Invoices`.
4. Download the sample CSV/XLS file offered by Zoho.
5. Save it outside the repo or attach it only if it contains no sensitive data.

Customer/contact sample, if available:

1. Open Zoho Books.
2. Go to the customer/contact import area.
3. Download the sample CSV/XLS file offered by Zoho.
4. Save it outside the repo or attach it only if it contains no sensitive data.

Compare samples against:

- `src/features/invoices/zohoInvoiceExportConfig.js`
- `src/features/invoices/zohoCustomerExportConfig.js`

### Invoice Header Comparison

| OPPS Header | Zoho Sample Header | Match Type | Action Required |
| --- | --- | --- | --- |
| Invoice Number |  | exact match / mapped equivalent / missing / not needed |  |
| Reference Number |  | exact match / mapped equivalent / missing / not needed |  |
| Invoice Date |  | exact match / mapped equivalent / missing / not needed |  |
| Due Date |  | exact match / mapped equivalent / missing / not needed |  |
| Payment Terms |  | exact match / mapped equivalent / missing / not needed |  |
| Customer Name |  | exact match / mapped equivalent / missing / not needed |  |
| Customer Email |  | exact match / mapped equivalent / missing / not needed |  |
| Customer Phone |  | exact match / mapped equivalent / missing / not needed |  |
| Billing Address |  | exact match / mapped equivalent / missing / not needed |  |
| Currency Code |  | exact match / mapped equivalent / missing / not needed |  |
| Salesperson Name |  | exact match / mapped equivalent / missing / not needed |  |
| Item Name |  | exact match / mapped equivalent / missing / not needed |  |
| Item Description |  | exact match / mapped equivalent / missing / not needed |  |
| Item Type |  | exact match / mapped equivalent / missing / not needed |  |
| Quantity |  | exact match / mapped equivalent / missing / not needed |  |
| Unit |  | exact match / mapped equivalent / missing / not needed |  |
| Rate |  | exact match / mapped equivalent / missing / not needed |  |
| Discount |  | exact match / mapped equivalent / missing / not needed |  |
| Tax Name |  | exact match / mapped equivalent / missing / not needed |  |
| Tax Percentage |  | exact match / mapped equivalent / missing / not needed |  |
| Account |  | exact match / mapped equivalent / missing / not needed |  |
| Shipping Charge |  | exact match / mapped equivalent / missing / not needed |  |
| Adjustment |  | exact match / mapped equivalent / missing / not needed |  |
| Notes |  | exact match / mapped equivalent / missing / not needed |  |
| Terms |  | exact match / mapped equivalent / missing / not needed |  |
| OPPS Invoice ID |  | exact match / mapped equivalent / missing / not needed | Keep unless it breaks Zoho import |
| OPPS Order ID |  | exact match / mapped equivalent / missing / not needed | Keep unless it breaks Zoho import |

Add rows for Zoho-required fields that OPPS does not currently provide:

| Zoho Required Header | OPPS Source Available? | Recommended Action |
| --- | --- | --- |
|  | yes / no |  |

### Customer Header Comparison

| OPPS Header | Zoho Sample Header | Match Type | Action Required |
| --- | --- | --- | --- |
| Customer Name |  | exact match / mapped equivalent / missing / not needed |  |
| Company Name |  | exact match / mapped equivalent / missing / not needed |  |
| Email |  | exact match / mapped equivalent / missing / not needed |  |
| Phone |  | exact match / mapped equivalent / missing / not needed |  |
| Billing Address |  | exact match / mapped equivalent / missing / not needed |  |
| Currency Code |  | exact match / mapped equivalent / missing / not needed |  |
| Payment Terms |  | exact match / mapped equivalent / missing / not needed |  |
| OPPS Customer ID |  | exact match / mapped equivalent / missing / not needed | Keep unless it breaks Zoho import |

Only update centralized config files if the real Zoho sample proves a change is needed.

## 6. Real CSV Test Invoice

Create one safe test invoice. Use obvious test labels so it is not mistaken for a real customer invoice.

Required test data:

- Multiple line items
- Comma in item description, for example `Test item, with comma`
- Quote in item description, for example `Test item "quoted"`
- Line break in notes
- Discount
- Shipping
- Tax percentage
- Adjustment

CSV verification:

| Check | Expected | Result | Notes |
| --- | --- | --- | --- |
| UTF-8 opens correctly | File opens in spreadsheet app without garbled text |  |  |
| Headers are correct | Match current OPPS config or approved Zoho-aligned config |  |  |
| One row per line item | Yes |  |  |
| Invoice-level fields repeat on each row | Yes |  |  |
| Commas escaped correctly | Values are quoted where needed |  |  |
| Quotes escaped correctly | Quotes are doubled inside quoted values |  |  |
| Line breaks escaped correctly | Value stays within the correct CSV field |  |  |
| Totals match OPPS | Detail drawer total/balance match exported invoice values |  |  |
| Zoho import preview accepts file | Yes, after manual mapping |  |  |

Do not import a real invoice into Zoho unless it is clearly a test invoice and the team intends to keep it in Zoho.

## 7. Performance Confirmation

Confirm these boundaries again during live browser testing.

| Check | Expected | Result | Notes |
| --- | --- | --- | --- |
| Dashboard initial load has invoice queries | No |  |  |
| Order list initial load has invoice queries | No |  |  |
| Order drawer initial open has invoice queries | No |  |  |
| Invoice queries happen on `/Invoices` | Yes |  |  |
| Invoice queries happen inside opened invoice tab/section | Yes, only when opened |  |  |
| Invoice list fetches line items | No |  |  |
| CSV generation happens before preview/download click | No |  |  |

Use browser network tools and search for requests involving:

- `opps_invoices`
- `opps_invoice_items`
- `opps_invoice_exports`
- `next_opps_invoice_number`

## 8. Final Report Format

Use this format after live verification is done.

```md
# OPPS Invoicing Live Verification Report

Date:
Tester:
Environment:
Build/version/commit:

## Migration
- Migration applied: yes/no
- Tables present: yes/no
- RPC present: yes/no
- RLS enabled: yes/no

## RLS Result By Role
| Role | Result | Notes |
| --- | --- | --- |
| Admin | pass/fail |  |
| Finance level 1 | pass/fail |  |
| Finance level 2 | pass/fail |  |
| Unauthorized/non-finance | pass/fail |  |

## Browser QA Result
Pass/fail:
Notes:

## Mobile QA Result
Pass/fail:
Notes:

## Zoho Invoice Sample Alignment
Pass/fail:
Header/config changes needed:

## Zoho Customer Sample Alignment
Pass/fail:
Header/config changes needed:

## CSV Import Preview Result
Pass/fail:
Notes:

## Bugs Found
- 

## Fixes Made
- 

## Files Changed
- 

## Phase 4
Safe to start: yes/no
Reason:
```

## Phase 4 Deployment

- Commit: c4c1eb6
- Production: https://ops.jointx.co.za
- Database tables present: yes
- RLS enabled: yes
- Vercel production build: passed

## Phase 4 QA

- Export settings persistence: passed
- Client invoice template settings: passed
- Activity history: passed
- Duplicate management: passed
- Performance check: passed
