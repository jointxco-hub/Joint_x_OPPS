import { supabase } from '@/lib/supabaseClient';

export type OrderStatus =
  | 'confirmed'
  | 'in_production'
  | 'ready'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type OrderPriority = 'low' | 'normal' | 'high' | 'urgent';
export type PrintType = 'dtf' | 'vinyl' | 'embroidery' | 'screen' | 'none';

export interface OrderProduct {
  name: string;
  quantity: number;
  price: number;
  size?: string;
  color?: string;
}

export interface SupabaseOrder {
  id?: string;
  client_name: string;
  client_email?: string;
  client_phone?: string;
  order_number: string;
  status?: OrderStatus;
  priority?: OrderPriority;
  products?: OrderProduct[];
  total_amount?: number;
  deposit_paid?: number;
  notes?: string;
  special_instructions?: string;
  due_date?: string;
  courier?: string;
  tracking_number?: string;
  file_urls?: string[];
  assigned_team?: string[];
  print_type?: PrintType;
  linked_po_id?: string;
  is_archived?: boolean;
  archived_at?: string;
  archived_by?: string;
  source?: 'opps' | 'xlab' | 'x1_sample';
  created_at?: string;
  updated_at?: string;
}

interface SupabaseResult<T> {
  data: T | null;
  error: string | null;
}

export interface GetOrdersOptions {
  status?: OrderStatus;
  includeArchived?: boolean;
  source?: 'opps' | 'xlab' | 'x1_sample';
  limit?: number;
  offset?: number;
}

function missingClientResult<T>(): SupabaseResult<T> {
  return {
    data: null,
    error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.',
  };
}

export async function createOrderSupabase(
  order: Omit<SupabaseOrder, 'id' | 'created_at' | 'updated_at'>
): Promise<SupabaseResult<SupabaseOrder>> {
  if (!supabase) {
    return missingClientResult();
  }

  const { data, error } = await supabase
    .from('orders')
    .insert({
      ...order,
      status: order.status ?? 'confirmed',
      priority: order.priority ?? 'normal',
      deposit_paid: order.deposit_paid ?? 0,
      is_archived: order.is_archived ?? false,
      file_urls: order.file_urls ?? [],
      assigned_team: order.assigned_team ?? [],
      products: order.products ?? [],
      source: order.source ?? 'opps',
    })
    .select()
    .single();

  if (error) {
    console.error('[createOrderSupabase] Error:', error.message);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export async function getOrdersSupabase(
  options: GetOrdersOptions = {}
): Promise<SupabaseResult<SupabaseOrder[]>> {
  if (!supabase) {
    return missingClientResult();
  }

  const {
    status,
    includeArchived = false,
    source,
    limit = 100,
    offset = 0,
  } = options;

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (!includeArchived) {
    query = query.eq('is_archived', false);
  }

  if (status) {
    query = query.eq('status', status);
  }

  if (source) {
    query = query.eq('source', source);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getOrdersSupabase] Error:', error.message);
    return { data: null, error: error.message };
  }

  return { data: data ?? [], error: null };
}

export async function getOrderByIdSupabase(
  id: string
): Promise<SupabaseResult<SupabaseOrder>> {
  if (!supabase) {
    return missingClientResult();
  }

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('[getOrderByIdSupabase] Error:', error.message);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export async function updateOrderStatusSupabase(
  id: string,
  newStatus: OrderStatus
): Promise<SupabaseResult<SupabaseOrder>> {
  if (!supabase) {
    return missingClientResult();
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ status: newStatus })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[updateOrderStatusSupabase] Error:', error.message);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export async function updateOrderSupabase(
  id: string,
  fields: Partial<Omit<SupabaseOrder, 'id' | 'created_at' | 'updated_at'>>
): Promise<SupabaseResult<SupabaseOrder>> {
  if (!supabase) {
    return missingClientResult();
  }

  const { data, error } = await supabase
    .from('orders')
    .update(fields)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[updateOrderSupabase] Error:', error.message);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export async function archiveOrderSupabase(
  id: string,
  archivedByEmail: string
): Promise<SupabaseResult<SupabaseOrder>> {
  if (!supabase) {
    return missingClientResult();
  }

  const { data, error } = await supabase
    .from('orders')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      archived_by: archivedByEmail,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[archiveOrderSupabase] Error:', error.message);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}
