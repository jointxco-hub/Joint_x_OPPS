import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const PRIVATE_UPLOAD_PREFIX = "private-upload://";
const DEFAULT_EXPIRES_IN = 300;
const signedUrlCache = new Map();

export function toPrivateUploadRef(bucket, path) {
  const cleanBucket = String(bucket || "").trim();
  const cleanPath = String(path || "").replace(/^\/+/, "");
  return `${PRIVATE_UPLOAD_PREFIX}${cleanBucket}/${cleanPath}`;
}

export function parseStorageReference(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (raw.startsWith(PRIVATE_UPLOAD_PREFIX)) {
    const rest = raw.slice(PRIVATE_UPLOAD_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1) return null;
    return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)), isPrivate: true };
  }

  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const bucket = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    if (bucket !== "uploads") return null;
    return { bucket, path, isPrivate: true };
  } catch {
    return null;
  }

  return null;
}

export function isPrivateFileReference(value) {
  return Boolean(parseStorageReference(value));
}

export async function getSignedFileUrl(value, { expiresIn = DEFAULT_EXPIRES_IN } = {}) {
  const ref = parseStorageReference(value);
  if (!ref) return String(value || "");
  if (!supabase) throw new Error("Supabase is not configured.");

  const safeExpires = Math.min(Math.max(Number(expiresIn) || DEFAULT_EXPIRES_IN, 60), 3600);
  const cacheKey = `${ref.bucket}:${ref.path}:${safeExpires}`;
  const cached = signedUrlCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 15000) return cached.url;

  const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, safeExpires);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Could not create signed file URL.");
  }

  signedUrlCache.set(cacheKey, {
    url: data.signedUrl,
    expiresAt: now + safeExpires * 1000,
  });

  return data.signedUrl;
}

export function useSignedFileUrl(value, options = {}) {
  const [state, setState] = useState({ url: String(value || ""), loading: false, error: null, isPrivate: false });
  const optionsKey = JSON.stringify({ expiresIn: options.expiresIn || DEFAULT_EXPIRES_IN });
  const ref = useMemo(() => parseStorageReference(value), [value]);

  useEffect(() => {
    let cancelled = false;
    const raw = String(value || "");

    if (!ref) {
      setState({ url: raw, loading: false, error: null, isPrivate: false });
      return () => { cancelled = true; };
    }

    setState((prev) => ({ ...prev, url: prev.url || raw, loading: true, error: null, isPrivate: true }));
    getSignedFileUrl(raw, options)
      .then((url) => {
        if (!cancelled) setState({ url, loading: false, error: null, isPrivate: true });
      })
      .catch((error) => {
        if (!cancelled) setState({ url: "", loading: false, error, isPrivate: true });
      });

    return () => { cancelled = true; };
  }, [value, ref, optionsKey]);

  return state;
}
