import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceKey) return Response.json({ error: 'Missing Supabase environment variables' }, { status: 500, headers: cors });
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: authHeader ? { Authorization: authHeader } : {} } });
  const { data: requester } = await userClient.auth.getUser();
  if (!requester?.user?.email) return Response.json({ error: 'Not signed in' }, { status: 401, headers: cors });
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: requesterProfile } = await adminClient.from('users').select('role, is_active').eq('auth_user_id', requester.user.id).limit(1).maybeSingle();
  if (requesterProfile?.role !== 'admin' || requesterProfile?.is_active === false) return Response.json({ error: 'Admin only' }, { status: 403, headers: cors });
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const userId = String(body?.user_id || '').trim();
  if (!['revoke', 'restore'].includes(action) || !userId) return Response.json({ error: 'action and user_id are required' }, { status: 400, headers: cors });
  if (userId === requester.user.id) return Response.json({ error: 'You cannot revoke your own admin access.' }, { status: 400, headers: cors });
  const isRevoking = action === 'revoke';
  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: isRevoking ? '876000h' : 'none' });
  if (authError) return Response.json({ error: authError.message }, { status: 500, headers: cors });
  const { error: profileError } = await adminClient.from('users').update({ is_active: !isRevoking, updated_at: new Date().toISOString() }).eq('auth_user_id', userId);
  if (profileError) return Response.json({ error: profileError.message }, { status: 500, headers: cors });
  return Response.json({ ok: true, action, user_id: userId }, { headers: cors });
});
