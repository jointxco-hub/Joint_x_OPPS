export const XOS_HOST_SUFFIX = ".xos.jointx.co.za";

export function isXosAdminHost(hostname = window.location.hostname) {
  const normalized = String(hostname || "").toLowerCase().trim();
  return normalized.endsWith(XOS_HOST_SUFFIX);
}
