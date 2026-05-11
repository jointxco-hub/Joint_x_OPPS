import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return Response.json({ error: 'Missing Supabase environment variables' }, { status: 500, headers: cors });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });
  const { data: requester } = await userClient.auth.getUser();
  const requesterEmail = requester?.user?.email;

  if (!requesterEmail) {
    return Response.json({ error: 'Not signed in' }, { status: 401, headers: cors });
  }

  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await adminClient
    .from('users')
    .select('role, email')
    .eq('email', requesterEmail)
    .maybeSingle();

  if (profile?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403, headers: cors });
  }

  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return Response.json({ error: error.message }, { status: 500, headers: cors });

  const users = (data.users || []).map((user) => ({
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    confirmed_at: user.confirmed_at,
    user_metadata: user.user_metadata || {},
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
  }));

  return Response.json({ users }, { headers: cors });
});
