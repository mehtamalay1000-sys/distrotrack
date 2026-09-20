import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Read .env manually
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

console.log('Connecting to Supabase at:', supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSales() {
  // 1. Sign in as admin/master to test authenticated RPCs if needed
  console.log('\n--- 1. Authenticating as master@distrotrack.local ---');
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  if (authErr) {
    console.log('Auth error:', authErr.message);
  } else {
    console.log('Authenticated successfully as:', auth.user?.email, 'User ID:', auth.user?.id);
  }

  // 2. Query sap_sales_imports
  console.log('\n--- 2. Querying sap_sales_imports table ---');
  const { data: salesImports, error: importErr } = await supabase
    .from('sap_sales_imports')
    .select('*');

  if (importErr) {
    console.error('Error fetching sap_sales_imports:', importErr);
  } else {
    console.log(`Found ${salesImports?.length || 0} batches in sap_sales_imports:`);
    console.dir(salesImports, { depth: null });
  }

  // 3. Query sap_sales_import_items count and sample
  console.log('\n--- 3. Querying sap_sales_import_items table ---');
  const { count: itemsCount, error: countErr } = await supabase
    .from('sap_sales_import_items')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.error('Error counting sap_sales_import_items:', countErr);
  } else {
    console.log(`Total rows in sap_sales_import_items: ${itemsCount}`);
  }

  // 4. Query inventory_movements for sap_sales_baseline
  console.log('\n--- 4. Querying inventory_movements for baseline movements ---');
  const { count: movCount, error: movErr } = await supabase
    .from('inventory_movements')
    .select('*', { count: 'exact', head: true })
    .or('movement_type.eq.sap_sales_baseline,idempotency_key.like.sales_import:%');

  if (movErr) {
    console.error('Error counting baseline movements:', movErr);
  } else {
    console.log(`Total sap_sales_baseline movements in inventory_movements: ${movCount}`);
  }

  // 5. Test admin_get_reset_preview RPC
  console.log('\n--- 5. Calling admin_get_reset_preview() RPC ---');
  const { data: previewData, error: previewErr } = await supabase.rpc('admin_get_reset_preview');
  if (previewErr) {
    console.error('admin_get_reset_preview error:', previewErr);
  } else {
    console.log('admin_get_reset_preview returned:');
    console.dir(previewData, { depth: null });
  }
}

inspectSales().catch(console.error);
