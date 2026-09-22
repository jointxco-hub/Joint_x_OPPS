const LEGACY_TO_OPS_STATUS = {
  pending: "not_started",
  todo: "not_started",
  in_progress: "in_progress",
  overdue: "on_hold",
  done: "complete",
  complete: "complete",
};

const OPS_TO_LEGACY_STATUS = {
  not_started: "pending",
  in_progress: "in_progress",
  on_hold: "overdue",
  complete: "done",
};

// Phase 2B: normalize the canonical auth-id field(s) into the same
// unified array shape as assigned_to below, for both entity types, so
// every view/component can read task.assigned_auth_user_ids without
// caring whether the underlying row is a single-assignee Task or an
// array-assignee OpsTask.
function toAuthUserIdArray(task) {
  if (Array.isArray(task.assigned_auth_user_ids)) return task.assigned_auth_user_ids.filter(Boolean);
  return task.assigned_auth_user_id ? [task.assigned_auth_user_id] : [];
}

export function normalizeOpsTaskForViews(task) {
  return {
    ...task,
    _entity: "OpsTask",
    _viewId: `OpsTask:${task.id}`,
    due_date: task.due_date || task.deadline,
    assigned_to: Array.isArray(task.assigned_to) ? task.assigned_to : task.assigned_to ? [task.assigned_to] : [],
    assigned_auth_user_ids: toAuthUserIdArray(task),
    production_type: task.production_type || "general",
  };
}

export function normalizeLegacyTaskForOpsViews(task) {
  const orderId = task.order_id || task.linked_order_id;
  const dueDate = task.due_date || task.deadline;
  return {
    ...task,
    _entity: "Task",
    _viewId: `Task:${task.id}`,
    status: LEGACY_TO_OPS_STATUS[task.status] || "not_started",
    due_date: dueDate,
    deadline: dueDate,
    order_id: orderId,
    linked_order_id: orderId,
    assigned_to: Array.isArray(task.assigned_to) ? task.assigned_to : task.assigned_to ? [task.assigned_to] : [],
    assigned_auth_user_ids: toAuthUserIdArray(task),
    production_type: task.production_type || "general",
    production_stage: task.production_stage || task.department,
    supporting_files: task.supporting_files || (task.file_urls || []).map((url) => ({ name: url, url })),
    notes: task.notes || task.description,
    subtasks: task.subtasks || [],
  };
}

export function mergeTaskLists(opsTasks = [], legacyTasks = []) {
  return [
    ...opsTasks.map(normalizeOpsTaskForViews),
    ...legacyTasks.map(normalizeLegacyTaskForOpsViews),
  ];
}

export function getTaskEntityName(task) {
  return task?._entity === "Task" ? "Task" : "OpsTask";
}

export function isTaskComplete(task) {
  return task?.status === "complete" || task?.status === "done" || task?.status === "completed";
}

export function getTaskCompletionPatch(task) {
  return { status: isTaskComplete(task) ? "not_started" : "complete" };
}

export function toEntityTaskPayload(task, patch = {}) {
  const entityName = getTaskEntityName(task);
  const merged = { ...task, ...patch };

  if (entityName === "Task") {
    const assigned = Array.isArray(merged.assigned_to) ? merged.assigned_to[0] : merged.assigned_to;
    // Phase 2B dual-write: canonical auth id alongside the legacy email,
    // collapsed to a single value to match the Task entity's single-
    // assignee column (assigned_auth_user_id, not the array shape the
    // merged UI view normalizes everything to).
    const assignedAuthUserId = Array.isArray(merged.assigned_auth_user_ids)
      ? merged.assigned_auth_user_ids[0]
      : merged.assigned_auth_user_id;
    return {
      title: merged.title,
      description: merged.description || merged.notes,
      assigned_to: assigned || undefined,
      assigned_auth_user_id: assignedAuthUserId || undefined,
      deadline: merged.deadline || merged.due_date || undefined,
      status: patch.status === "archived" ? undefined : OPS_TO_LEGACY_STATUS[merged.status] || merged.status,
      priority: merged.priority,
      department: merged.department || merged.production_stage,
      linked_order_id: merged.linked_order_id || merged.order_id,
      linked_goal_id: merged.linked_goal_id || merged.project_id,
      file_urls: merged.file_urls,
      comments: merged.comments,
      is_archived: patch.status === "archived" ? true : merged.is_archived,
    };
  }

  // OpsTask: assigned_auth_user_ids already carries through via ...merged
  // (it's already in the array shape ops_tasks.serialize() expects).
  return merged;
}
