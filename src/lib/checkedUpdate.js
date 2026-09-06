// Safe, typed single-row UPDATE for Supabase/PostgREST.
//
// Replaces the pattern
//   .from(t).update(rec).eq('id',id).eq('tenant_id',tid).select('*').single()
// whose failure modes all collapse to one opaque PGRST116 ("JSON object
// requested, multiple (or no) rows returned") — so "row belongs to
// another workspace", "someone else already changed it", "you lost
// access" and "not found" were indistinguishable, and the UI could only
// say "Failed to update. Try again." (which, for most of those, is false).
//
// Contract:
//   1 row updated            -> return the row
//   > 1 rows updated          -> ENTITY_UPDATE_AMBIGUOUS  (defensive; id is a PK)
//   0 rows, probe not found   -> ENTITY_UPDATE_NOT_VISIBLE
//   0 rows, wrong tenant      -> ENTITY_UPDATE_NOT_VISIBLE
//   0 rows, updated_at moved  -> ENTITY_STALE_VERSION      (only if an expected
//                                                           version was supplied)
//   0 rows, otherwise         -> ENTITY_UPDATE_NOT_VISIBLE (likely UPDATE-RLS denial)
//   PostgREST/transport error -> NETWORK (retriable) | ENTITY_UPDATE_NOT_VISIBLE
//                                (RLS raise) | ENTITY_UPDATE_FAILED
//
// The client is injected so this module stays pure for `node --test`.

import { OP_ERROR_CODES, createOpError, isOpError } from "./opError.js";

// Map a raw PostgREST/supabase-js error to a typed OpError.
//
// `status` is the HTTP status from the PostgREST *response* (res.status),
// passed in explicitly by the caller — supabase-js keeps it on the
// response, NOT on res.error. It is the most reliable network signal:
// postgrest-js's fetch-failure path (blocked request, offline, DNS, TLS,
// CORS) returns `{ error: { message: '<name>: <msg>', code: '' }, status: 0 }`,
// where the exact message wording is browser/runtime-specific and can't be
// relied on. status === 0 (or ≥ 500) is unambiguous; the message regex is
// only a fallback for callers that can't supply a status.
export function classifySupabaseWriteError(
  error,
  { operation = "entity_update", entityLabel = null, status = undefined } = {},
) {
  if (isOpError(error)) return error;

  const msg = String((error && (error.message || error.hint)) || error || "");
  const code = String((error && error.code) || "");
  const httpStatus =
    typeof status === "number"
      ? status
      : typeof (error && (error.status ?? error.statusCode)) === "number"
        ? error.status ?? error.statusCode
        : null;

  // A PostgREST / Postgres error always carries a code: `PGRST###` or a
  // 5-char SQLSTATE (e.g. 42501, 23505). A client-side transport failure
  // does not.
  const hasUpstreamCode = /^PGRST/i.test(code) || /^[0-9A-Za-z]{5}$/.test(code);
  const looksUpstreamMessage =
    /row-level security|violates|duplicate key|constraint|permission denied|invalid input|out of range/i.test(msg);

  const looksNetwork =
    httpStatus === 0 ||
    (httpStatus != null && httpStatus >= 500) ||
    /^(0|5\d\d)$/.test(code) ||
    /failed to fetch|networkerror|network error|load ?failed|timed? ?out|ECONNRESET|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|network request failed|internet connection appears to be offline/i.test(
      msg,
    ) ||
    // No status, no upstream code, not an upstream-shaped message -> this
    // is the postgrest-js `code:'' / status:0` transport failure even when
    // the message wording is unfamiliar.
    (httpStatus == null && !hasUpstreamCode && code === "" && !looksUpstreamMessage);

  if (looksNetwork) {
    return createOpError({
      code: OP_ERROR_CODES.NETWORK,
      operation,
      retriable: true,
      technical: `${entityLabel ? entityLabel + ": " : ""}status=${httpStatus ?? "n/a"} code=${code || "n/a"} msg=${msg}`,
    });
  }
  if (code === "42501" || /violates row-level security|row-level security|permission denied/i.test(msg)) {
    return createOpError({
      code: OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE,
      operation,
      technical: `RLS denied: ${msg}`,
    });
  }
  return createOpError({
    code: OP_ERROR_CODES.ENTITY_UPDATE_FAILED,
    operation,
    retriable: false,
    technical: entityLabel ? `${entityLabel}: ${msg}` : msg,
  });
}

async function diagnoseZeroRowUpdate({ client, table, id, tenantId, expectedUpdatedAt, operation }) {
  // Only ask for columns we actually branch on — so a table without
  // `tenant_id` (non-tenant-scoped entity) or without `updated_at` doesn't
  // make the diagnostic probe itself fail on an unknown column.
  const cols = ["id"];
  if (expectedUpdatedAt != null) cols.push("updated_at");
  if (tenantId != null) cols.push("tenant_id");

  let probe = null;
  let probeError = null;
  let probeStatus;
  try {
    const res = await client
      .from(table)
      .select(cols.join(", "))
      .eq("id", id)
      .maybeSingle();
    probe = res && res.data;
    probeError = res && res.error;
    probeStatus = res && res.status;
  } catch (e) {
    probeError = e;
  }

  if (probeError) {
    // If the probe ITSELF failed on the network (blocked / offline), the
    // save is a connection problem, not a permissions one — surface that.
    const classified = classifySupabaseWriteError(probeError, { operation, status: probeStatus });
    if (classified.code === OP_ERROR_CODES.NETWORK) throw classified;
    // Otherwise: could not confirm why the update matched nothing — do NOT
    // guess "stale". Fail closed as not-visible with the probe detail logged.
    throw createOpError({
      code: OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE,
      operation,
      technical: `0-row update; classification probe failed: ${probeError.message || probeError}`,
    });
  }

  if (!probe) {
    throw createOpError({
      code: OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE,
      operation,
      technical: `row ${id} is not visible to this session`,
    });
  }

  if (tenantId != null && probe.tenant_id != null && String(probe.tenant_id) !== String(tenantId)) {
    throw createOpError({
      code: OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE,
      operation,
      technical: `row belongs to tenant ${probe.tenant_id}, caller tenant ${tenantId}`,
    });
  }

  if (expectedUpdatedAt != null && String(probe.updated_at) !== String(expectedUpdatedAt)) {
    throw createOpError({
      code: OP_ERROR_CODES.ENTITY_STALE_VERSION,
      operation,
      technical: `expected updated_at ${expectedUpdatedAt}, current ${probe.updated_at}`,
    });
  }

  // Visible, in-tenant, and (where checkable) version-matching, yet the
  // UPDATE still changed nothing — almost always an UPDATE-policy denial
  // that PostgREST expresses as a silent 0-row result rather than a 42501.
  throw createOpError({
    code: OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE,
    operation,
    technical: "0-row update on a visible, in-tenant, version-matching row (likely UPDATE RLS denial)",
  });
}

export async function performCheckedUpdate({
  client,
  table,
  id,
  patch,
  tenantId = null, // null => not tenant-scoped (caller resolved/validated already)
  expectedUpdatedAt = null,
  operation = "entity_update",
  entityLabel = null,
}) {
  if (!client) {
    throw createOpError({ code: OP_ERROR_CODES.ENTITY_UPDATE_FAILED, operation, technical: "no supabase client" });
  }

  let query = client.from(table).update(patch).eq("id", id);
  if (tenantId != null) query = query.eq("tenant_id", tenantId);
  if (expectedUpdatedAt != null) query = query.eq("updated_at", expectedUpdatedAt);

  let data;
  let error;
  let httpStatus;
  try {
    const res = await query.select("*"); // NOT .single() — inspect the rows ourselves
    data = res && res.data;
    error = res && res.error;
    httpStatus = res && res.status; // supabase-js keeps status on the response, not res.error
  } catch (e) {
    error = e;
    httpStatus = e && (e.status ?? e.statusCode);
  }

  if (error) throw classifySupabaseWriteError(error, { operation, entityLabel, status: httpStatus });

  const rows = Array.isArray(data) ? data : data == null ? [] : [data];

  if (rows.length === 1) return rows[0];

  if (rows.length > 1) {
    throw createOpError({
      code: OP_ERROR_CODES.ENTITY_UPDATE_AMBIGUOUS,
      operation,
      technical: `update matched ${rows.length} rows for id=${id}`,
    });
  }

  return diagnoseZeroRowUpdate({ client, table, id, tenantId, expectedUpdatedAt, operation });
}

// UI helper: turn any thrown error from performCheckedUpdate (or a raw
// supabase error) into what a screen needs — a safe message, whether a
// retry makes sense, and whether the caller should refetch first.
export function describeCheckedUpdateError(err, { entityNoun = "record" } = {}) {
  const e = isOpError(err) ? err : classifySupabaseWriteError(err);
  switch (e.code) {
    case OP_ERROR_CODES.ENTITY_STALE_VERSION:
      return {
        code: e.code,
        message: `This ${entityNoun} was updated elsewhere. Reload it before saving your changes.`,
        retriable: false,
        shouldRefetch: true,
      };
    case OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE:
      return {
        code: e.code,
        message: `This ${entityNoun} could not be updated. It may belong to another workspace or you may no longer have access.`,
        retriable: false,
        shouldRefetch: true,
      };
    case OP_ERROR_CODES.ENTITY_UPDATE_AMBIGUOUS:
      return {
        code: e.code,
        message: `This ${entityNoun} could not be updated safely. Reload and try again.`,
        retriable: false,
        shouldRefetch: true,
      };
    case OP_ERROR_CODES.NETWORK:
      return { code: e.code, message: "Connection problem. Try again.", retriable: true, shouldRefetch: false };
    case OP_ERROR_CODES.NO_ACTIVE_TENANT:
    case OP_ERROR_CODES.TENANT_CONTEXT_UNRESOLVED:
      return { code: e.code, message: e.userMessage, retriable: Boolean(e.retriable), shouldRefetch: false };
    default:
      return {
        code: e.code || "ENTITY_UPDATE_FAILED",
        message: `Couldn't save your changes to this ${entityNoun}. Try again.`,
        retriable: true,
        shouldRefetch: false,
      };
  }
}
