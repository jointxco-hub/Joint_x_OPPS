// Whether a raw file reference (private-upload://, legacy Supabase storage URL,
// or a plain external URL) points at an image, based on its file extension.
// This is independent of whether the reference is public or private - that
// question belongs to privateFiles.js, which decides how to load the bytes.
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i;

export function isImageReference(value = "") {
  return IMAGE_EXTENSION_PATTERN.test(String(value || ""));
}
