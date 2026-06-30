export const STOREFRONT_HOST_SUFFIX = ".xlab.jointx.co.za";
export const PRIMARY_STOREFRONT_HOST = "xlab.jointx.co.za";

export function normalizeStorefrontHostname(hostname = window.location.hostname) {
  return String(hostname || "")
    .toLowerCase()
    .trim()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

export function isStorefrontHost(hostname = window.location.hostname) {
  const normalized = normalizeStorefrontHostname(hostname);
  return normalized === PRIMARY_STOREFRONT_HOST || normalized.endsWith(STOREFRONT_HOST_SUFFIX);
}
