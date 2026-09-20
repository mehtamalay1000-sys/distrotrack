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

async function checkMorePermissions() {
  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  const { data: dItems, error: eItems } = await supabase
    .from('sap_sales_import_items')
    .delete()
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .select();
  console.log('Direct PostgREST DELETE on sap_sales_import_items:', { dItems, eItems });

  const { data: dMovs, error: eMovs } = await supabase
    .from('inventory_movements')
    .delete()
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .select();
  console.log('Direct PostgREST DELETE on inventory_movements:', { dMovs, eMovs });
}

checkMorePermissions().catch(console.error);
