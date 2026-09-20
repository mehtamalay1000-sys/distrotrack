import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve('.env');
let supabaseUrl = '';
let supabaseKey = '';

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('VITE_SUPABASE_URL=')) {
      supabaseUrl = trimmed.replace('VITE_SUPABASE_URL=', '').trim();
    }
    if (trimmed.startsWith('VITE_SUPABASE_ANON_KEY=')) {
      supabaseKey = trimmed.replace('VITE_SUPABASE_ANON_KEY=', '').trim();
    }
  }
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testRemoteDelete() {
  console.log('Testing admin_delete_sap_sales_history on remote Supabase...');
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });
  console.log('Auth result:', { user: auth?.user?.id, authErr });

  const { data: result, error: delErr } = await supabase.rpc('admin_delete_sap_sales_history', {
    p_import_id: null,
  });

  console.log('admin_delete_sap_sales_history returned:');
  console.dir({ result, delErr }, { depth: null });
}

testRemoteDelete().catch(console.error);
