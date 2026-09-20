import { createClient } from '@supabase/supabase-js';

const metaEnv = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};
const procEnv = typeof process !== 'undefined' ? process.env : {};

if ((!procEnv.VITE_SUPABASE_URL || !procEnv.VITE_SUPABASE_ANON_KEY) && typeof process !== 'undefined' && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // ignore
  }
}

const supabaseUrl = (metaEnv?.VITE_SUPABASE_URL || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL : '') || '') as string;
const supabaseAnonKey = (metaEnv?.VITE_SUPABASE_ANON_KEY || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_ANON_KEY : '') || '') as string;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('placeholder') &&
  supabaseAnonKey !== 'placeholder-key'
);

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

// Fast return 400 response when credentials are not configured to avoid DNS/timeout delays and PostgREST retries
const offlineFetch = () => Promise.resolve(new Response(JSON.stringify({ message: 'Supabase credentials not configured' }), {
  status: 400,
  headers: { 'Content-Type': 'application/json' }
}));

// Initialize Supabase client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createClient<any>(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  !isSupabaseConfigured ? { global: { fetch: offlineFetch } } : undefined
);
