const BRIDGE_NAMES = ["OPPSPrinter", "IminPrinter", "iminPrinter", "AndroidPrinter", "Android"];
const PRINT_METHODS = ["printText", "print", "sendText", "printReceipt", "printRaw"];
const DEFAULT_WIDTH = 32;
const PAPER_WIDTHS = {
  58: 32,
  80: 48,
};

export function isIminPrintingEnabled() {
  return String(import.meta.env.VITE_ENABLE_IMIN_PRINTING ?? "true").toLowerCase() !== "false";
}

export function getIminBridge() {
  if (typeof window === "undefined") return null;

  for (const name of BRIDGE_NAMES) {
    const bridge = window[name];
    if (bridge && (typeof bridge === "object" || typeof bridge === "function")) {
      return { name, bridge };
    }
  }

  return null;
}

export function detectIminPrinter() {
  const found = isIminPrintingEnabled() ? getIminBridge() : null;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";

  return {
    available: Boolean(found),
    bridgeName: found?.name ?? null,
    userAgent,
    likelyImin: /imin|android/i.test(userAgent),
    enabled: isIminPrintingEnabled(),
  };
}

export async function printIminReceipt(payload, options = {}) {
  if (!isIminPrintingEnabled()) {
    return { ok: false, reason: "disabled" };
  }

  const found = getIminBridge();
  if (!found) {
    return { ok: false, reason: "not_detected" };
  }

  const receiptText = typeof payload === "string"
    ? sanitizeReceiptText(payload, options)
    : formatOpsThermalReceipt(payload, options);

  for (const method of PRINT_METHODS) {
    const fn = found.bridge?.[method];
    if (typeof fn !== "function") continue;

    try {
      await Promise.resolve(fn.call(found.bridge, receiptText));
      return { ok: true, method, bridgeName: found.name };
    } catch (error) {
      return {
        ok: false,
        reason: "bridge_error",
        method,
        bridgeName: found.name,
        error: error?.message || String(error),
      };
    }
  }

  if (typeof found.bridge === "function") {
    try {
      await Promise.resolve(found.bridge(receiptText));
      return { ok: true, method: "function", bridgeName: found.name };
    } catch (error) {
      return {
        ok: false,
        reason: "bridge_error",
        method: "function",
        bridgeName: found.name,
        error: error?.message || String(error),
      };
    }
  }

  return { ok: false, reason: "no_supported_method", bridgeName: found.name };
}

export function fallbackBrowserPrint() {
  if (typeof window !== "undefined" && typeof window.print === "function") {
    window.print();
  }
}

export function formatOpsThermalReceipt(payload = {}, options = {}) {
  const width = getLineWidth(options);
  const typeLabel = {
    order_brief: "ORDER BRIEF",
    production_brief: "PRODUCTION BRIEF",
    invoice_summary: "INVOICE SUMMARY",
    test: "TEST RECEIPT",
  }[payload.type] || "OPPS RECEIPT";

  const lines = [
    center(payload.storeName || payload.tenantName || "Joint X OPPS", width),
    center(typeLabel, width),
    divider(width),
    row("Order", payload.orderNumber, width),
    row("Invoice", payload.invoiceNumber, width),
    row("Client", payload.customerName, width),
    row("Phone", payload.phone, width),
    row("Date", payload.dateTime || new Date().toLocaleString(), width),
    row("Status", payload.status, width),
    row("Stage", payload.stage, width),
  ].filter(Boolean);

  const items = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  if (items.length) {
    lines.push(divider(width), "ITEMS");
    items.forEach((item, index) => {
      const qty = item.qty || item.quantity || 1;
      const title = item.itemName || item.name || item.title || "Item";
      lines.push(...wrapLine(`${index + 1}. x${qty} ${title}`, width));
      [
        labelValue("Size", item.size),
        labelValue("Colour", item.color || item.colour),
        labelValue("Print", item.printPosition || item.placement || item.print),
        labelValue("Notes", item.notes),
      ].filter(Boolean).forEach((detail) => lines.push(...wrapLine(`   ${detail}`, width)));
    });
  }

  const totals = Array.isArray(payload.totals) ? payload.totals : [];
  if (totals.length) {
    lines.push(divider(width));
    totals.forEach((item) => {
      if (!item) return;
      const label = item.label || item.name;
      const value = item.value ?? item.amount;
      lines.push(row(label, value, width));
    });
  }

  if (payload.internalNotes) {
    lines.push(divider(width), "INTERNAL NOTES", ...wrapLine(payload.internalNotes, width));
  }

  if (payload.codeText) {
    lines.push(divider(width), "CODE", ...wrapLine(payload.codeText, width));
  }

  lines.push(divider(width), center(payload.footer || "Printed from OPPS", width), "");

  return sanitizeReceiptText(lines.join("\n"), { ...options, width });
}

export function sanitizeReceiptText(value = "", options = {}) {
  const width = Number(options.width) || getLineWidth(options);
  const maxLines = Number(options.maxLines) || 240;
  const maxChars = Number(options.maxChars) || 8000;
  const text = String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/private-upload:\/\/[^\s]+/gi, "[private file]")
    .replace(/([?&](?:token|access_token|apikey|authorization|signature)=)[^&\s]+/gi, "$1[redacted]");

  return text
    .split("\n")
    .slice(0, maxLines)
    .map((line) => line.slice(0, Math.max(width * 3, width)))
    .join("\n")
    .slice(0, maxChars);
}

function getLineWidth(options = {}) {
  const width = Number(options.paperWidth || localPaperWidth());
  return PAPER_WIDTHS[width] || DEFAULT_WIDTH;
}

function localPaperWidth() {
  if (typeof window === "undefined") return 58;
  const stored = window.localStorage?.getItem("opps:imin-paper-width");
  return stored === "80" ? 80 : 58;
}

function divider(width) {
  return "-".repeat(width);
}

function center(value, width) {
  const text = sanitizeInline(value);
  if (!text) return "";
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return `${" ".repeat(left)}${text}`;
}

function row(label, value, width) {
  if (value === null || value === undefined || value === "") return "";
  const safeLabel = sanitizeInline(label);
  const safeValue = sanitizeInline(value);
  const gap = width - safeLabel.length - safeValue.length;
  if (gap > 1) return `${safeLabel}${" ".repeat(gap)}${safeValue}`;
  return wrapLine(`${safeLabel}: ${safeValue}`, width).join("\n");
}

function labelValue(label, value) {
  if (value === null || value === undefined || value === "") return "";
  return `${label}: ${sanitizeInline(Array.isArray(value) ? value.join(", ") : value)}`;
}

function wrapLine(value, width) {
  const text = sanitizeInline(value);
  if (!text) return [];
  const words = text.split(" ");
  const lines = [];
  let line = "";

  words.forEach((word) => {
    if (word.length > width) {
      if (line) lines.push(line);
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      line = "";
      return;
    }

    const next = line ? `${line} ${word}` : word;
    if (next.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });

  if (line) lines.push(line);
  return lines;
}

function sanitizeInline(value) {
  return sanitizeReceiptText(value, { width: 96, maxLines: 1, maxChars: 512 }).replace(/\n/g, " ").trim();
}
