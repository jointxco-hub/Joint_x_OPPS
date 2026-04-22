import { supabase } from './supabaseClient';

export async function testSupabaseConnection() {
  if (!supabase) {
    console.error('Supabase env vars are missing. Create a .env file from .env.example first.');
    return;
  }

  console.log('Testing Supabase connection...');

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Supabase error:', error.message);
  } else {
    console.log('Connected to Supabase');
    console.log('Data:', data);
  }
}
