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

const candidateRpcs = [
  'is_current_user_master',
  'is_current_user_admin_or_master',
  'get_current_app_role',
  'log_system_event',
  'get_financial_summary',
  'get_route_profitability',
  'check_route_stock',
  'confirm_purchase_import',
  'import_sap_sales_baseline',
  'add_unmapped_sap_product',
  'update_product_mrp',
  'admin_delete_sap_sales_history',
  'admin_clear_inventory',
  'admin_reset_test_inventory',
  'admin_get_reset_preview',
  'delete_sap_sales_history',
  'reverse_payment',
  'approve_expense',
  'reject_expense',
  'reconcile_route_finances',
  'close_route_reconciliation',
  'start_route',
  'complete_party_delivery',
];

async function probe() {
  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  console.log('Probing RPCs on remote Supabase:');
  for (const rpc of candidateRpcs) {
    const { data, error } = await supabase.rpc(rpc as any, {});
    const notFound = error?.code === 'PGRST202' && error?.message?.includes('Could not find the function');
    if (notFound) {
      console.log(`❌ ${rpc}: NOT FOUND`);
    } else {
      console.log(`✅ ${rpc}: EXISTS (response: code=${error?.code || 'SUCCESS'}, msg=${error?.message || 'OK'})`);
    }
  }
}

probe().catch(console.error);
