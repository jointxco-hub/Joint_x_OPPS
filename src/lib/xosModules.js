import { supabase } from "@/lib/supabaseClient";

function missingRpc(message = "") {
  const lower = message.toLowerCase();
  return lower.includes("get_xos_requests_for_host")
    || lower.includes("get_xos_files_for_host")
    || lower.includes("get_xos_orders_for_host")
    || lower.includes("create_xos_request_for_host")
    || lower.includes("could not find the function")
    || lower.includes("does not exist");
}

export async function createXosRequest({ hostname, title, message, category = "general", priority = "normal" } = {}) {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("create_xos_request_for_host", {
      p_hostname: hostname,
      p_title: title,
      p_message: message,
      p_category: category,
      p_priority: priority,
    });

    if (error) {
      if (missingRpc(error.message)) return { data: null, error: "XOS request creation is not deployed yet." };
      return { data: null, error: error.message };
    }

    return { data: data || null, error: null };
  } catch {
    return { data: null, error: "Could not create XOS request." };
  }
}

export async function listXosOrders({ hostname, limit = 20 } = {}) {
  if (!supabase) return { data: [], error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("get_xos_orders_for_host", {
      p_hostname: hostname,
      p_limit: limit,
    });

    if (error) {
      if (missingRpc(error.message)) return { data: [], error: "XOS Orders are not deployed yet." };
      return { data: [], error: error.message };
    }

    return { data: Array.isArray(data) ? data : [], error: null };
  } catch {
    return { data: [], error: "Could not load XOS orders." };
  }
}

export async function listXosRequests({ hostname, limit = 20 } = {}) {
  if (!supabase) return { data: [], error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("get_xos_requests_for_host", {
      p_hostname: hostname,
      p_limit: limit,
    });

    if (error) {
      if (missingRpc(error.message)) return { data: [], error: "XOS Requests are not deployed yet." };
      return { data: [], error: error.message };
    }

    return { data: Array.isArray(data) ? data : [], error: null };
  } catch {
    return { data: [], error: "Could not load XOS requests." };
  }
}

export async function listXosFiles({ hostname, limit = 20 } = {}) {
  if (!supabase) return { data: [], error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("get_xos_files_for_host", {
      p_hostname: hostname,
      p_limit: limit,
    });

    if (error) {
      if (missingRpc(error.message)) return { data: [], error: "XOS Files are not deployed yet." };
      return { data: [], error: error.message };
    }

    return { data: Array.isArray(data) ? data : [], error: null };
  } catch {
    return { data: [], error: "Could not load XOS files." };
  }
}
