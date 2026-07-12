import { PRICE_BOOK } from "./priceBook";

export const DTF_CLIENT_RATE_PER_METER = PRICE_BOOK.dtf.sellingPricePerMeter;
export const DTF_ROLL_WIDTH_MM = PRICE_BOOK.dtf.rollWidthMm;
export const DTF_ROLL_LENGTH_MM = PRICE_BOOK.dtf.rollLengthMm;
export const DTF_MINIMUM_METERS = 1;

function layout(widthMm, heightMm, quantity) {
  const lanes = Math.max(1, Math.floor(DTF_ROLL_WIDTH_MM / widthMm));
  const rows = Math.ceil(quantity / lanes);
  return { widthMm, heightMm, lanes, rows, lengthMm: rows * heightMm };
}

export function calculateDtfClientPrice({ widthMm, heightMm, quantity = 1 } = {}) {
  const width = Number(widthMm);
  const height = Number(heightMm);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (!(width > 0) || !(height > 0)) return { valid: false, reason: "Enter artwork width and height in millimetres.", total: 0, chargeableMeters: 0 };
  const candidates = [layout(width, height, qty), layout(height, width, qty)].filter(Boolean);
  if (!candidates.length) return { valid: false, reason: `Artwork width must fit within the ${DTF_ROLL_WIDTH_MM}mm roll.`, total: 0, chargeableMeters: 0 };
  const best = candidates.sort((a, b) => a.lengthMm - b.lengthMm)[0];
  const rawMeters = best.lengthMm / DTF_ROLL_LENGTH_MM;
  const chargeableMeters = rawMeters;
  return { valid: true, orientation: `${best.widthMm} × ${best.heightMm} mm`, lanes: best.lanes, rows: best.rows, rawMeters, chargeableMeters, total: chargeableMeters * DTF_CLIENT_RATE_PER_METER };
}
