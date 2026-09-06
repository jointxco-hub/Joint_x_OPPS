// Human-readable message for a Supabase/PostgREST error.
//
// Extracted from dataClient.js and de-hardcoded: it used to tell the user
// to "run the purchase_orders migration" / "add an INSERT policy for
// purchase_orders" for EVERY entity — so an Order, Client or File failure
// pointed at a table the user was never touching.
//
// Messages are now generic. If the caller knows which entity failed it
// may pass a short label ("Order", "Client", ...) for a slightly more
// specific sentence — but never a fabricated fix for the wrong table.
//
// Pure: no imports, safe for `node --test`.

export function supabaseErrorMessage(error, entityLabel = null) {
  if (!error) return "Unknown error";

  const raw =
    (typeof error === "string" && error) ||
    error.message ||
    error.hint ||
    (() => {
      try {
        return JSON.stringify(error);
      } catch {
        return "Unknown error";
      }
    })();

  const label = typeof entityLabel === "string" && entityLabel.trim() ? entityLabel.trim() : null;
  const subject = label ? `this ${label.toLowerCase()}` : "this record";

  if (raw.includes("does not exist")) {
    return `A database table or column needed for ${subject} is missing — a pending migration has probably not been applied yet. (${raw})`;
  }
  if (raw.includes("violates row-level security") || raw.includes("row-level security")) {
    return `You don't have permission to make this change to ${subject}, or it belongs to another workspace. (${raw})`;
  }
  return raw;
}

export default supabaseErrorMessage;
