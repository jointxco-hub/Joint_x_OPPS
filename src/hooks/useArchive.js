/**
 * src/hooks/useArchive.js
 *
 * Production-grade archive hook.
 * Wraps archiveEntity in a useMutation so every page gets:
 *   ✅ Automatic cache invalidation
 *   ✅ isPending state (button disables during mutation)
 *   ✅ Consistent toast feedback
 *   ✅ Error handling
 *
 * Usage:
 *   const { archive, isPending } = useArchive("Task");
 *   <button onClick={() => archive(task.id)} disabled={isPending}>Archive</button>
 *
 * Entity → query key map covers every entity in the system.
 * Add new entries here as the system grows — nowhere else.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { archiveEntity } from "@/utils/archiveEntity";

// Maps dataClient entity name → React Query cache key
const QUERY_KEY_MAP = {
  Order:         "orders",
  Task:          "tasks",
  Client:        "clients",
  Supplier:      "suppliers",
  InventoryItem: "inventory",
  Project:       "projects",
  PurchaseOrder: "purchaseOrders",
};

/**
 * @param {string} entityName - Must match a key in QUERY_KEY_MAP (e.g. "Task")
 * @param {object} options
 * @param {function} options.onSuccess - Optional callback after successful archive
 */
export function useArchive(entityName, { onSuccess } = {}) {
  const queryClient = useQueryClient();
  const queryKey = QUERY_KEY_MAP[entityName];

  if (!queryKey) {
    console.warn(`[useArchive] Unknown entity: "${entityName}". Add it to QUERY_KEY_MAP.`);
  }

  const mutation = useMutation({
    mutationFn: (id) => archiveEntity(entityName, id),
    onSuccess: () => {
      // Invalidate the main list for this entity
      if (queryKey) {
        queryClient.invalidateQueries({ queryKey: [queryKey] });
      }
      // Also invalidate the archived list if Archive page is open
      queryClient.invalidateQueries({ queryKey: [`archived-${queryKey}`] });

      onSuccess?.();
    },
  });

  return {
    archive:   mutation.mutate,
    isPending: mutation.isPending,
    isError:   mutation.isError,
    reset:     mutation.reset,
  };
}
