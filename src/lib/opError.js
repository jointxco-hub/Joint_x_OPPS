// Minimal typed operational-error structure (P0 slice).
//
// This is NOT the full observability contract — only the small, reusable
// shape the tenant-context hardening needs so callers can tell a
// retriable "we couldn't confirm your workspace" apart from a hard
// "you have no workspace", and so customer-facing copy never leaks
// membership / internal detail.
//
// Pure: no imports, safe for `node --test`.

export const OP_ERROR_CODES = Object.freeze({
  NO_ACTIVE_TENANT: "NO_ACTIVE_TENANT",
  TENANT_CONTEXT_UNRESOLVED: "TENANT_CONTEXT_UNRESOLVED",
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
