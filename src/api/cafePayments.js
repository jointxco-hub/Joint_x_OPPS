import { supabase } from "@/lib/supabaseClient";

export async function getCafeOrderPaymentState(oppsOrderId) {
  const { data, error } = await supabase.rpc("qs_opps_staff_payment_state", { p_opps_order_id: oppsOrderId });
  if (error) throw error;
  return data;
}

export async function recordCafeOrderPayment({ oppsOrderId, method, amount, reference, operationKey }) {
  const { data, error } = await supabase.rpc("qs_opps_record_staff_payment", {
    p_opps_order_id: oppsOrderId,
    p_method: method,
    p_amount: amount,
    p_reference: reference || null,
    p_operation_key: operationKey,
  });
  if (error) throw error;
  return data;
}
