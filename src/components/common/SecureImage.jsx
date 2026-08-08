import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { useSignedFileUrl } from "@/lib/privateFiles";
import { isImageReference } from "@/lib/imageReference";

// Resolves a raw canonical file reference (public URL, legacy Supabase
// storage URL, or private-upload://...) to a browser-loadable <img> at
// render time. Never persists the resolved URL - callers keep storing the
// raw reference in order/product records.
//
// onStatusChange (optional) reports "loading" | "ready" | "error" so a
// caller can gate print readiness on it. "ready" is only reported once the
// <img> itself has actually finished loading/decoding - a resolved signed
// URL is necessary but not sufficient, since a print view that fires as
// soon as signing completes can still capture a half-downloaded image.
/**
 * @param {{ value?: string, alt?: string, className?: string, fallback?: any, loadingMode?: "lazy" | "eager", onStatusChange?: (status: "loading" | "ready" | "error") => void }} props
 */
export default function SecureImage({ value, alt = "", className = "", fallback = null, loadingMode = "lazy", onStatusChange }) {
  const [imgError, setImgError] = useState(false);
  const raw = String(value || "").trim();
  const eligible = Boolean(raw) && isImageReference(raw);
  const { url, loading, error } = useSignedFileUrl(eligible ? raw : "");

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const lastReportedRef = useRef(null);
  const report = useCallback((status) => {
    if (lastReportedRef.current === status) return;
    lastReportedRef.current = status;
    onStatusChangeRef.current?.(status);
  }, []);

  useEffect(() => {
    setImgError(false);
    lastReportedRef.current = null;
  }, [value]);

  // Interim states only: a signed URL being resolved, or resolved but the
  // <img> below hasn't fired onLoad yet, both read as "loading". Only the
  // <img>'s own onLoad/onError report "ready"/"error" for an actual image.
  useEffect(() => {
    if (!raw) return;
    if (!eligible || error) {
      report("error");
      return;
    }
    report("loading");
  }, [raw, eligible, loading, error, report]);

  if (!eligible) {
    return fallback;
  }

  if (error || imgError) {
    return (
      <div className={`flex items-center justify-center bg-secondary/30 text-muted-foreground ${className}`}>
        <ImageOff className="h-1/3 w-1/3 opacity-60" aria-hidden="true" />
        <span className="sr-only">Image unavailable</span>
      </div>
    );
  }

  if (loading || !url) {
    return <div className={`animate-pulse bg-secondary/40 ${className}`} aria-hidden="true" />;
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading={loadingMode}
      onLoad={() => report("ready")}
      onError={() => {
        setImgError(true);
        report("error");
      }}
    />
  );
}
