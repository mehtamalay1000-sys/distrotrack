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

async function checkFunctions() {
  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  console.log('\n--- Checking what functions exist in remote Supabase ---');
  
  // Test if admin_delete_sap_sales_history exists
  const { data: delData, error: delErr } = await supabase.rpc('admin_delete_sap_sales_history', {
    p_import_id: '00000000-0000-0000-0000-000000000000'
  });
  console.log('admin_delete_sap_sales_history response:', { delData, delErr });

  // Test if admin_clear_inventory exists
  const { data: clearData, error: clearErr } = await supabase.rpc('admin_clear_inventory');
  console.log('admin_clear_inventory response:', { clearData, clearErr });

  // Test if admin_reset_test_inventory exists
  const { data: resetData, error: resetErr } = await supabase.rpc('admin_reset_test_inventory');
  console.log('admin_reset_test_inventory response:', { resetData, resetErr });

  // Check what migrations have been applied if supabase_migrations table is readable
  const { data: migrations, error: migErr } = await supabase
    .from('_prisma_migrations')
    .select('*');
  console.log('_prisma_migrations:', { migrations, migErr });

  const { data: sbMigrations, error: sbMigErr } = await supabase
    .from('supabase_migrations')
    .select('*');
  console.log('supabase_migrations:', { sbMigrations, sbMigErr });
}

checkFunctions().catch(console.error);
