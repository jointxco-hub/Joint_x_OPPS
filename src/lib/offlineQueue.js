import { dataClient } from "@/api/dataClient";

const QUEUE_KEY = "jx_offline_queue";

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(items) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("jx-offline-queue-change", { detail: items.length }));
}

export function getOfflineQueueCount() {
  return readQueue().length;
}

export function enqueueOfflineCreate(entityName, payload) {
  const item = {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action: "create",
    entityName,
    payload,
    queuedAt: new Date().toISOString(),
  };
  writeQueue([item, ...readQueue()]);
  return item;
}

export async function createWithOfflineQueue(entityName, payload) {
  if (!navigator.onLine) {
    enqueueOfflineCreate(entityName, payload);
    return { ...payload, id: `offline-${Date.now()}`, isQueuedOffline: true };
  }

  try {
    return await dataClient.entities[entityName].create({ ...payload, __queueOnFailure: true });
  } catch (error) {
    enqueueOfflineCreate(entityName, payload);
    return { ...payload, id: `offline-${Date.now()}`, isQueuedOffline: true };
  }
}

export async function flushOfflineQueue() {
  if (!navigator.onLine) return { synced: 0, remaining: getOfflineQueueCount() };

  const queue = readQueue();
  const remaining = [];
  let synced = 0;

  for (const item of queue.reverse()) {
    try {
      if (item.action === "create") {
        await dataClient.entities[item.entityName].create({ ...item.payload, __offlineQueueFlush: true });
        synced += 1;
      }
    } catch {
      remaining.unshift(item);
    }
  }

  writeQueue(remaining);
  return { synced, remaining: remaining.length };
}
