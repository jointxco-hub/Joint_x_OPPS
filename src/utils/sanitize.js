export function sanitizeValue(value) {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }
  return value;
}