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

async function inspectItemRelationships() {
  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  const { data: items, error: itErr } = await supabase
    .from('sap_sales_import_items')
    .select('id, import_id, sku, quantity, net_val, movement_id, idempotency_key')
    .limit(5);

  console.log('Sample sap_sales_import_items:');
  console.dir(items, { depth: null });

  if (items && items.length > 0 && items[0].movement_id) {
    const { data: mov } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('id', items[0].movement_id);
    console.log('Linked movement via movement_id:');
    console.dir(mov, { depth: null });
  } else if (items && items.length > 0 && items[0].idempotency_key) {
    const { data: mov } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('idempotency_key', items[0].idempotency_key);
    console.log('Linked movement via idempotency_key:');
    console.dir(mov, { depth: null });
  }
}

inspectItemRelationships().catch(console.error);
