// Whether a raw file reference (private-upload://, legacy Supabase storage URL,
// or a plain external URL) points at an image, based on its file extension.
// This is independent of whether the reference is public or private - that
// question belongs to privateFiles.js, which decides how to load the bytes.
// svg is included deliberately: rendered through a plain <img> tag (as every
// caller here does) a browser never executes embedded SVG script content, so
// this is a safe extension to treat as a previewable image.
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i;

export function isImageReference(value = "") {
  return IMAGE_EXTENSION_PATTERN.test(String(value || ""));
}
