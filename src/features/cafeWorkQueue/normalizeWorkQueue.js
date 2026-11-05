// Read-only display normalization. Server RPC must authorize and tenant-scope records.
export function normalizeWorkQueue(response) {
  if (!response || !Array.isArray(response.items)) {
    throw new Error('Invalid Cafe work queue response');
  }
  const seen = new Set();
  const items = [];
  for (const item of response.items) {
    if (!item || !['invoice', 'order'].includes(item.type) || typeof item.id !== 'string') continue;
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const balance = item.balanceDue == null ? null : Number(item.balanceDue);
    items.push({
      key,
      id: item.id,
      type: item.type,
      number: String(item.number || ''),
      status: String(item.status || 'unknown'),
      balanceDue: balance !== null && Number.isFinite(balance) && balance >= 0 ? balance : null,
      reviewRequired: item.reviewRequired === true,
    });
  }
  return {items, nextCursor: typeof response.nextCursor === 'string' ? response.nextCursor : null};
}
