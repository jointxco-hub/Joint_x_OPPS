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

export function normalizeOpsTaskForViews(task) {
  return {
    ...task,
    _entity: "OpsTask",
    _viewId: `OpsTask:${task.id}`,
    due_date: task.due_date || task.deadline,
    assigned_to: Array.isArray(task.assigned_to) ? task.assigned_to : task.assigned_to ? [task.assigned_to] : [],
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
    return {
      title: merged.title,
      description: merged.description || merged.notes,
      assigned_to: assigned || undefined,
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

  return merged;
}
