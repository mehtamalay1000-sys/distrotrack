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

async function testSingleDelete() {
  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  // Find 1 sap_sales_baseline movement
  const { data: movs } = await supabase
    .from('inventory_movements')
    .select('id, movement_type, idempotency_key')
    .eq('movement_type', 'sap_sales_baseline')
    .limit(1);

  console.log('Target movement to delete test:', movs);
  if (!movs || movs.length === 0) {
    console.log('No sap_sales_baseline movements found.');
    return;
  }

  const targetId = movs[0].id;
  const { data: delResult, error: delErr } = await supabase
    .from('inventory_movements')
    .delete()
    .eq('id', targetId)
    .select();

  console.log('Delete attempt result:', { delResult, delErr });
}

testSingleDelete().catch(console.error);
