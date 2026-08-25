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

  // RPC exceptions are formatted as "SOME_CODE: human text" - the human
  // text alone is already what staff should see.
  const codeMatch = message.match(/^[A-Z_]+:\s*(.+)$/);
  if (codeMatch) return codeMatch[1];

  return message || "Something went wrong.";
}
