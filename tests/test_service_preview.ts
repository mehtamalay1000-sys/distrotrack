import * as fs from 'fs';
import * as path from 'path';

// Read .env manually
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('VITE_SUPABASE_URL=')) {
      process.env.VITE_SUPABASE_URL = trimmed.replace('VITE_SUPABASE_URL=', '').trim();
    }
    if (trimmed.startsWith('VITE_SUPABASE_ANON_KEY=')) {
      process.env.VITE_SUPABASE_ANON_KEY = trimmed.replace('VITE_SUPABASE_ANON_KEY=', '').trim();
    }
  }
}

import { getAdminResetPreview, resolveSapSalesImportId } from '../src/features/inventory/services/adminResetService';

async function testServicePreview() {
  console.log('Testing getAdminResetPreview() with NO arguments (global):');
  const globalPreview = await getAdminResetPreview();
  console.log('Global Preview:');
  console.dir(globalPreview, { depth: null });

  console.log('\nTesting resolveSapSalesImportId("SALES-20260912-H6EQ"):');
  const resolvedUuid = await resolveSapSalesImportId('SALES-20260912-H6EQ');
  console.log('Resolved UUID:', resolvedUuid);

  console.log('\nTesting getAdminResetPreview("SALES-20260912-H6EQ") (targeted via display ref):');
  const targetedPreviewByRef = await getAdminResetPreview('SALES-20260912-H6EQ');
  console.log('Targeted Preview by Ref:');
  console.dir(targetedPreviewByRef, { depth: null });

  console.log('\nTesting getAdminResetPreview(resolvedUuid) (targeted via UUID):');
  const targetedPreviewByUuid = await getAdminResetPreview(resolvedUuid);
  console.log('Targeted Preview by UUID:');
  console.dir(targetedPreviewByUuid, { depth: null });
}

testServicePreview().catch(console.error);
