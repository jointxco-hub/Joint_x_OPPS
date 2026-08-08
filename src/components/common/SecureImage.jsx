import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { useSignedFileUrl } from "@/lib/privateFiles";
import { isImageReference } from "@/lib/imageReference";

// Resolves a raw canonical file reference (public URL, legacy Supabase
// storage URL, or private-upload://...) to a browser-loadable <img> at
// render time. Never persists the resolved URL - callers keep storing the
// raw reference in order/product records.
export default function SecureImage({ value, alt = "", className = "", fallback = null }) {
  const [imgError, setImgError] = useState(false);
  const raw = String(value || "").trim();
  const eligible = Boolean(raw) && isImageReference(raw);
  const { url, loading, error } = useSignedFileUrl(eligible ? raw : "");

  useEffect(() => {
    setImgError(false);
  }, [value]);

  if (!eligible) {
    return fallback;
  }

  if (loading) {
    return <div className={`animate-pulse bg-secondary/40 ${className}`} aria-hidden="true" />;
  }

  if (error || !url || imgError) {
    return (
      <div className={`flex items-center justify-center bg-secondary/30 text-muted-foreground ${className}`}>
        <ImageOff className="h-1/3 w-1/3 opacity-60" aria-hidden="true" />
        <span className="sr-only">Image unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setImgError(true)}
    />
  );
}
