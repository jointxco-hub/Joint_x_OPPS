// Phase 2B Step 3 - translates known Postgres constraint-violation and
// duplication-RPC error messages into staff-facing text. Falls through to
// the raw message (RPC exception messages are already written to be
// staff-readable, e.g. "GARMENT_VARIANT_CLONE_IDEMPOTENCY_CONFLICT:
// idempotency key already used with a different request" - just strip the
// leading CODE: prefix) rather than hiding unknown errors behind a generic
// string, so a genuinely new failure is never silently swallowed.

const CONSTRAINT_MESSAGES = [
  { match: /_active_name_uidx/, message: "An active garment variant/treatment with this name already exists." },
  { match: /_name_not_blank/, message: "Name cannot be blank." },
  { match: /_idempotency_uidx/, message: "This action was already submitted - refreshing the list." },
];

export function toStaffMessage(rawMessage) {
  const message = (rawMessage || "").toString();
  const constraintHit = CONSTRAINT_MESSAGES.find((c) => c.match.test(message));
  if (constraintHit) return constraintHit.message;

  // Phase 1F-B - a raw row-level-security / grant rejection is never
  // staff-readable ("new row violates row-level security policy for table
  // ..."). Production-configuration writes (product_components,
  // client_product_garment_variants / _treatments / _variant_treatments)
  // are gated by inventory_can_review_tenant() - owner/admin tenant role -
  // which is stricter than ordinary staff access. The capability-based
  // permission system is Phase 1G; until then, translate the rejection
  // into one clear sentence rather than surfacing Postgres.
  if (/row-level security policy|permission denied for (table|relation|schema|function)/i.test(message)) {
    return "You don't have permission to make this production change. Ask a workspace owner or admin.";
  }

  // RPC exceptions are formatted as "SOME_CODE: human text" - the human
  // text alone is already what staff should see.
  const codeMatch = message.match(/^[A-Z_]+:\s*(.+)$/);
  if (codeMatch) return codeMatch[1];

  return message || "Something went wrong.";
}
