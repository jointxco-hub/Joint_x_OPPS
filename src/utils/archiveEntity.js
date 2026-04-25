/**
 * src/utils/archiveEntity.js
 *
 * Single source of truth for archive and restore across all entities.
 * Every module uses these — no module invents its own version.
 *
 * Usage:
 *   import { archiveEntity, restoreEntity } from "@/utils/archiveEntity";
 *
 *   // Archive
 *   await archiveEntity("Order", order.id);
 *
 *   // Restore
 *   await restoreEntity("Task", task.id);
 */

import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";

/**
 * Entity display names for toast messages.
 * Add new entities here as the system grows.
 */
const ENTITY_LABELS = {
  Order:         "Order",
  Task:          "Task",
  Client:        "Client",
  Supplier:      "Supplier",
  InventoryItem: "Item",
  Project:       "Project",
  PurchaseOrder: "Purchase Order",
};

/**
 * Archives any entity by setting is_archived + archived_at.
 *
 * @param {string} entityName   - Must match a key in dataClient.entities (e.g. "Order")
 * @param {string} id           - The record UUID
 * @param {object} options
 * @param {boolean} options.silent  - If true, suppress toast (default: false)
 * @returns {Promise<object|null>} - Updated record or null on failure
 */
export async function archiveEntity(entityName, id, { silent = false } = {}) {
  try {
    const result = await dataClient.entities[entityName].update(id, {
      is_archived: true,
      archived_at: new Date().toISOString(),
    });

    if (!silent) {
      const label = ENTITY_LABELS[entityName] ?? entityName;
      toast.success(`${label} archived`);
    }

    return result;
  } catch (err) {
    console.error(`[archiveEntity] Failed to archive ${entityName} ${id}:`, err);
    toast.error(`Failed to archive. Please try again.`);
    return null;
  }
}

/**
 * Restores an archived entity by clearing is_archived.
 * archived_at is intentionally left as-is (audit trail).
 *
 * @param {string} entityName
 * @param {string} id
 * @param {object} options
 * @param {boolean} options.silent
 * @returns {Promise<object|null>}
 */
export async function restoreEntity(entityName, id, { silent = false } = {}) {
  try {
    const result = await dataClient.entities[entityName].update(id, {
      is_archived: false,
    });

    if (!silent) {
      const label = ENTITY_LABELS[entityName] ?? entityName;
      toast.success(`${label} restored`);
    }

    return result;
  } catch (err) {
    console.error(`[restoreEntity] Failed to restore ${entityName} ${id}:`, err);
    toast.error(`Failed to restore. Please try again.`);
    return null;
  }
}
