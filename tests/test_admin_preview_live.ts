import * as fs from 'fs';
import * as path from 'path';

// Pre-load .env into process.env before importing supabase or adminResetService
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0 && !trimmed.startsWith('#')) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      process.env[k] = v;
    }
  }
}

async function run() {
  const { getAdminResetPreview, resolveSapSalesImportId } = await import('../src/features/inventory/services/adminResetService');
  const { supabase } = await import('../src/lib/supabase');

  console.log('--- Signing in as master@distrotrack.local ---');
  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  console.log('\n--- Testing resolveSapSalesImportId with display code ---');
  const resolved = await resolveSapSalesImportId('SALES-20260912-H6EQ');
  console.log('Resolved SALES-20260912-H6EQ ->', resolved);

  console.log('\n--- Testing getAdminResetPreview() (GLOBAL) ---');
  const globalPreview = await getAdminResetPreview();
  console.log('Global Preview:');
  console.dir(globalPreview, { depth: null });

  console.log('\n--- Testing getAdminResetPreview(UUID) (TARGETED) ---');
  const targetedUuid = await getAdminResetPreview('3b83e1ab-54cd-461d-ad63-eb992d7f0426');
  console.log('Targeted UUID Preview:');
  console.dir(targetedUuid.sap_sales, { depth: null });

  console.log('\n--- Testing getAdminResetPreview(DISPLAY_CODE) (TARGETED) ---');
  const targetedRef = await getAdminResetPreview('SALES-20260912-H6EQ');
  console.log('Targeted Ref Preview:');
  console.dir(targetedRef.sap_sales, { depth: null });
}

run().catch(console.error);
