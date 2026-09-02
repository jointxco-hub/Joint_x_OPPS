import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export function safeInvoiceFileName(value) {
  return String(value || "invoice").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";
}

export async function waitForImages(element) {
  const images = Array.from(element?.querySelectorAll("img") || []);
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
      window.setTimeout(resolve, 5000);
    });
  }));
}

// Never split these sections mid-block when paginating: header summary,
// billed-to/reference, delivery card, each line-item row, the combined
// payment-guidance+totals card, terms, and each attached print proof.
// html2canvas produces one flat raster image with no DOM/section
// awareness, so page breaks have to be computed here from block
// positions rather than left to fixed-height slicing.
function measurePdfBlocks(container, pageWidthMm) {
  const containerRect = container.getBoundingClientRect();
  const mmPerPx = pageWidthMm / container.clientWidth;
  return Array.from(container.querySelectorAll("[data-pdf-block]")).map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: (rect.top - containerRect.top) * mmPerPx,
      bottom: (rect.bottom - containerRect.top) * mmPerPx,
    };
  });
}

function computePageBreaksMm(blocks, totalHeightMm, maxPageHeightMm) {
  const EPS = 0.5;
  const breaks = [0];
  let cursor = 0;
  while (cursor < totalHeightMm - EPS) {
    const naturalPageEnd = cursor + maxPageHeightMm;
    if (naturalPageEnd >= totalHeightMm - EPS) {
      break;
    }
    const straddler = blocks
      .filter((block) => block.top < naturalPageEnd - EPS && block.bottom > naturalPageEnd + EPS && block.top >= cursor - EPS)
      .sort((a, b) => a.top - b.top)[0];
    const breakAt = straddler && straddler.top > cursor + EPS ? straddler.top : naturalPageEnd;
    breaks.push(breakAt);
    cursor = breakAt;
  }
  return breaks;
}

/** Renders a captured invoice DOM node into a paginated jsPDF instance. */
export async function buildInvoicePdf(captureElement) {
  await waitForImages(captureElement);
  const pageWidth = 190;
  const pageHeight = 277;
  const blocks = measurePdfBlocks(captureElement, pageWidth);
  const canvas = await html2canvas(captureElement, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#ffffff",
    logging: false,
    width: 794,
    windowWidth: 1200,
  });
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const imageHeight = (canvas.height * pageWidth) / canvas.width;
  const imageData = canvas.toDataURL("image/jpeg", 0.94);
  const pageBreaksMm = computePageBreaksMm(blocks, imageHeight, pageHeight);
  pageBreaksMm.forEach((breakTopMm, page) => {
    if (page > 0) pdf.addPage("a4", "portrait");
    pdf.addImage(imageData, "JPEG", 10, 10 - breakTopMm, pageWidth, imageHeight, undefined, "FAST");
  });
  return pdf;
}

function money(value) {
  return `R${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function invoiceShareSummaryText(invoice = {}) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const lines = [
    `Invoice ${invoice.invoice_number || ""} for ${invoice.customer_name || "Customer"}`,
    `Date: ${invoice.invoice_date || ""}`,
    `Due: ${invoice.due_date || invoice.payment_terms || ""}`,
    "",
    ...items.flatMap((item) => {
      const line = `${item.quantity || 1} x ${item.item_name || "Item"} @ ${money(item.rate)} = ${money(item.item_total)}`;
      const pb = item.source_metadata && item.source_metadata.price_breakdown;
      const sub = pb && pb.mode === "composed" && Array.isArray(pb.per_unit)
        ? pb.per_unit.map((row) => `    ${row.label}: ${money(row.amount)} / item`)
        : [];
      return [line, ...sub];
    }),
    "",
    `Total: ${money(invoice.total)}`,
    `Balance due: ${money(invoice.balance_due)}`,
  ];
  return lines.join("\n");
}
