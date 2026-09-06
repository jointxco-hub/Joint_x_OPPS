// Minimal typed operational-error structure.
//
// The small, reusable shape callers use to tell a retriable failure
// ("we couldn't confirm your workspace", "connection problem") from a
// terminal one ("you have no workspace", "someone else changed this
// first"), and to keep customer-facing copy free of membership / RLS /
// internal-id detail.
//
//   tenant-context codes  — added by the tenant-context reliability hotfix
//   ENTITY_* / NETWORK     — added by the order-update safety hotfix
//
// Pure: no imports, safe for `node --test`.

export const OP_ERROR_CODES = Object.freeze({
  // tenant context
  NO_ACTIVE_TENANT: "NO_ACTIVE_TENANT",
  TENANT_CONTEXT_UNRESOLVED: "TENANT_CONTEXT_UNRESOLVED",
  // checked entity update
  ENTITY_STALE_VERSION: "ENTITY_STALE_VERSION",
  ENTITY_UPDATE_NOT_VISIBLE: "ENTITY_UPDATE_NOT_VISIBLE",
  ENTITY_UPDATE_AMBIGUOUS: "ENTITY_UPDATE_AMBIGUOUS",
  ENTITY_UPDATE_FAILED: "ENTITY_UPDATE_FAILED",
  NETWORK: "NETWORK",
});

const CODE_DEFAULTS = Object.freeze({
  NO_ACTIVE_TENANT: {
    retriable: false,
    userMessage:
      "Your account isn't linked to an active workspace. Ask an administrator to review your access.",
  },
  TENANT_CONTEXT_UNRESOLVED: {
    retriable: true,
    userMessage: "We couldn't confirm your workspace just now. Please try again.",
  },
  ENTITY_STALE_VERSION: {
    retriable: false, // not retriable until the caller reloads / refetches
    userMessage: "This record was updated elsewhere. Reload it before saving your changes.",
  },
  ENTITY_UPDATE_NOT_VISIBLE: {
    retriable: false,
    userMessage:
      "This record could not be updated. It may belong to another workspace or you may no longer have access.",
  },
  ENTITY_UPDATE_AMBIGUOUS: {
    retriable: false,
    userMessage: "This record could not be updated safely. Reload and try again.",
  },
  ENTITY_UPDATE_FAILED: {
    retriable: false,
    userMessage: "Couldn't save your changes. Try again.",
  },
  NETWORK: {
    retriable: true,
    userMessage: "Connection problem. Try again.",
  },
});

export class OpError extends Error {
  constructor({ code, operation = null, retriable, userMessage, technical = null } = {}) {
    const defaults = CODE_DEFAULTS[code] || {};
    const resolvedUserMessage = userMessage || defaults.userMessage || "Something went wrong.";
    super(resolvedUserMessage);
    this.name = "OpError";
    this.code = code || "OP_ERROR";
    this.operation = operation;
    this.retriable = typeof retriable === "boolean" ? retriable : Boolean(defaults.retriable);
    this.userMessage = resolvedUserMessage;
    // `technical` is for logs only — never rendered to a customer.
    this.technical = technical == null ? null : String(technical);
  }

  toJSON() {
    return {
      code: this.code,
      operation: this.operation,
      retriable: this.retriable,
      userMessage: this.userMessage,
      technical: this.technical,
    };
  }
}

export function createOpError(args) {
  return new OpError(args);
}

export function isOpError(value) {
  return (
    value instanceof OpError ||
    (Boolean(value) && value.name === "OpError" && typeof value.code === "string")
  );
}
