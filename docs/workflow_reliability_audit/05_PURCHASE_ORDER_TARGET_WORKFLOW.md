# Purchase order target workflow

## Current workflow trace

| Current state | Action/location | Next state | Finding |
|---|---|---|---|
| New | `TypeformPOForm` saves | `draft` | One generic Save/Create action; no role-specific send action |
| Draft | Open card → modal → Submit | `pending` | Extra modal required; no pending disable/success state |
| Pending | Modal Approve or Back to Draft | `approved` / `draft` | Any tenant member can invoke it; rejection reason/state absent |
| Approved | Modal Mark Ordered | `ordered` | Separate extra step even for authorized direct purchase |
| Ordered | Modal Mark Received | `received` | No quantities, location, receipt evidence, or inventory movement; `received_date` is not set by the action |
| Partial | Listed as active | none in modal | Status is recognized but no transition creates or resolves it |
| Cancelled/received | Completed tab | none | No closed state |

Every state is stored in one `status` field. There is no separate approval model, no transition service, and no database validation/audit of allowed transitions. Comments are JSON on the PO.

## Target state model

Use existing equivalent fields if discovered during implementation; otherwise add:

- `approval_status`: `draft`, `pending`, `approved`, `rejected`
- `procurement_status`: `not_ordered`, `ordered`, `partially_received`, `received`, `cancelled`, `closed`

Do not infer approval from procurement. Migration mapping should be documented and reversible; preserve legacy `status` during a compatibility window or expose a derived view.

## Role-based commands

Authorization must be enforced in both UI and database/RPC:

- Restricted: Save Draft; Submit for Approval.
- Authorized buyer/approver: Approve; Reject/Return with reason; Approve and Mark as Ordered; Save and Send to Supplier.
- Receiver: Receive against an ordered PO at an allowed location.
- Admin: archive and narrowly constrained delete.

The existing PO RLS (`can_access_tenant`) is insufficient because it grants all tenant members all writes.

## Fast actions

Cards may expose only valid, permission-checked commands: approve, mark ordered, receive, edit, duplicate, add note, link order, archive. Commands call a central transition service/RPC and return the new record plus an audit event. Disable the command while pending and show the result.

## Bulk review drawer

Selection should open a review drawer showing count, record numbers, eligibility, skipped records, exact changes, and preview. Useful commands: submit, approve, reject/return, mark ordered, partial/complete receive, assign buyer, expected date, location, note, archive, export/print.

Execute through a bulk command that returns one result per PO. Never report full success when only a prefix of a sequential loop succeeded. Allow retry of failed rows. Archive is secondary. Delete appears only in a danger menu and only for unused drafts with no receipts, inventory movements, exports/sends, or downstream links.

## Receiving workflow

Create receipt headers and lines rather than mutating only PO JSON:

- ordered, previously received, received now, outstanding
- damaged, missing, substituted quantities
- exact supplier item/variant and accepted substitute authorization
- receiving location and receiver/time
- receipt document/photo
- linked inventory movement(s)
- linked order impact

Receipt and inventory movements commit atomically and are idempotent. Partial receipts derive `partially_received`; completion derives `received`. Never change the existing inventory identity strategy during this work.

## Relationship rules

- Add real same-tenant FKs for supplier, project, and linked order where current data permits.
- Select one authoritative PO↔order direction; current needs fit many POs to one order through `purchase_orders.linked_order_id`.
- Create explicit demand links if a PO line fulfills a replenishment need; do not infer by matching item names.
- Link receipts to inventory movements and surface the relationship from both PO and inventory history.
- Audit every link/unlink.

