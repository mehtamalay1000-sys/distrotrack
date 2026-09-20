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

async function checkRpcs() {
  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  // Check if execute_sql or exec_sql exists
  const { data: d1, error: e1 } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
  console.log('exec_sql:', { d1, e1 });

  const { data: d2, error: e2 } = await supabase.rpc('execute_sql', { query: 'SELECT 1;' });
  console.log('execute_sql:', { d2, e2 });

  // Can we delete directly via PostgREST tables if authenticated as master?
  // Let's test table delete permissions with a dummy non-existent ID
  const { data: dDel, error: eDel } = await supabase
    .from('sap_sales_imports')
    .delete()
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .select();
  console.log('Direct PostgREST DELETE permission on sap_sales_imports:', { dDel, eDel });
}

checkRpcs().catch(console.error);
