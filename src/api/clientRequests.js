import { supabase } from "@/lib/supabaseClient";

const EMPTY_RESULT = { data: [], error: null };

function friendlyMissingMessage(message = "") {
  const lower = message.toLowerCase();
  return (
    lower.includes("get_internal_client_requests") ||
    lower.includes("update_internal_client_request_status") ||
    lower.includes("get_internal_client_file_library") ||
    lower.includes("upsert_internal_client_file_folder") ||
    lower.includes("upsert_internal_client_file_link") ||
    lower.includes("copy_internal_client_file_link") ||
    lower.includes("delete_internal_client_file_link") ||
    lower.includes("add_internal_client_message_reply") ||
    lower.includes("could not find the function") ||
    lower.includes("does not exist")
  );
}

export async function saveInternalClientFileFolder({
  clientEmail,
  name,
  folderId = null,
  folderType = null,
  parentFolderId = null,
} = {}) {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("upsert_internal_client_file_folder", {
      p_client_email: clientEmail,
      p_name: name,
      p_folder_id: folderId,
      p_folder_type: folderType,
      p_parent_folder_id: parentFolderId,
    });

    if (error) {
      if (friendlyMissingMessage(error.message)) {
        return { data: null, error: "Client file library management functions are not applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not save client file folder." };
  }
}

export async function saveInternalClientFileLink({
  clientEmail,
  fileUrl,
  fileName,
  fileType = null,
  fileSize = null,
  folderId = null,
  linkedOrderId = null,
  linkedProjectId = null,
  linkedTechPackId = null,
  fileLinkId = null,
} = {}) {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("upsert_internal_client_file_link", {
      p_client_email: clientEmail,
      p_file_url: fileUrl,
      p_file_name: fileName,
      p_file_type: fileType,
      p_file_size: fileSize,
      p_folder_id: folderId,
      p_linked_order_id: linkedOrderId,
      p_linked_project_id: linkedProjectId,
      p_linked_tech_pack_id: linkedTechPackId,
      p_file_link_id: fileLinkId,
    });

    if (error) {
      if (friendlyMissingMessage(error.message)) {
        return { data: null, error: "Client file library management functions are not applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not save client file link." };
  }
}

export async function copyInternalClientFileLink({ fileLinkId, targetFolderId } = {}) {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("copy_internal_client_file_link", {
      p_file_link_id: fileLinkId,
      p_target_folder_id: targetFolderId,
    });

    if (error) {
      if (friendlyMissingMessage(error.message)) {
        return { data: null, error: "Client file library management functions are not applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not copy client file link." };
  }
}

export async function deleteInternalClientFileLink({ fileLinkId } = {}) {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("delete_internal_client_file_link", {
      p_file_link_id: fileLinkId,
    });

    if (error) {
      if (friendlyMissingMessage(error.message)) {
        return { data: null, error: "Client file library management functions are not applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not delete client file link." };
  }
}

export async function listClientRequests({
  type = "all",
  status = "all",
  sourceApp = "all",
  search = "",
  limit = 50,
} = {}) {
  if (!supabase) return { data: [], error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("get_internal_client_requests", {
      p_type: type === "all" ? null : type,
      p_status: status === "all" ? null : status,
      p_source_app: sourceApp === "all" ? null : sourceApp,
      p_search: search || null,
      p_limit: limit,
    });

    if (error) {
      if (friendlyMissingMessage(error.message)) return EMPTY_RESULT;
      return { data: [], error: error.message };
    }

    return { data: data ?? [], error: null };
  } catch {
    return EMPTY_RESULT;
  }
}

export async function updateClientRequestStatus({ type, id, status }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("update_internal_client_request_status", {
      p_type: type,
      p_id: id,
      p_status: status,
    });

    if (error) {
      if (friendlyMissingMessage(error.message)) {
        return { data: null, error: "Client Requests database functions are not applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not update request status." };
  }
}

export async function getInternalClientFileLibrary({ clientEmail, limit = 80 } = {}) {
  if (!supabase) return { data: { folders: [], files: [] }, error: "Supabase not configured" };
  if (!clientEmail) return { data: { folders: [], files: [] }, error: null };

  try {
    const { data, error } = await supabase.rpc("get_internal_client_file_library", {
      p_client_email: clientEmail,
      p_limit: limit,
    });

    if (error) {
      if (friendlyMissingMessage(error.message)) return { data: { folders: [], files: [] }, error: null };
      return { data: { folders: [], files: [] }, error: error.message };
    }

    return { data: data || { folders: [], files: [] }, error: null };
  } catch {
    return { data: { folders: [], files: [] }, error: null };
  }
}

export async function addInternalClientMessageReply({
  clientEmail,
  subject,
  message,
  parentMessageId,
} = {}) {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("add_internal_client_message_reply", {
      p_client_email: clientEmail,
      p_subject: subject || "Joint X reply",
      p_message: message,
      p_parent_message_id: parentMessageId || null,
    });

    if (error) {
      if (friendlyMissingMessage(error.message)) {
        return { data: null, error: "Client message replies database function is not applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not send reply." };
  }
}
