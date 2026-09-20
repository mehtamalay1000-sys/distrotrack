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

async function runAudit() {
  console.log('=== SAP SALES PROVENANCE & DATABASE AUDIT ===');
  
  // 1. Authenticate
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });
  if (authErr) {
    console.error('Auth failed:', authErr);
  } else {
    console.log('Authenticated as master:', auth.user?.id);
  }

  // 2. Check sap_sales_imports
  const { data: sImports } = await supabase.from('sap_sales_imports').select('*');
  console.log('\nsap_sales_imports count:', sImports?.length || 0);
  if (sImports && sImports.length > 0) {
    console.dir(sImports, { depth: null });
  }

  // 3. Check sap_sales_import_items
  const { count: itemsCount } = await supabase.from('sap_sales_import_items').select('*', { count: 'exact', head: true });
  console.log('sap_sales_import_items count:', itemsCount || 0);

  // 4. Sample baseline inventory movements
  const { data: movSample, error: movErr } = await supabase
    .from('inventory_movements')
    .select('id, movement_type, direction, quantity, product_id, reference_type, reference_id, idempotency_key, created_at, from_location, to_location')
    .eq('movement_type', 'sap_sales_baseline')
    .limit(10);
  
  console.log('\nsample sap_sales_baseline movements (first 5):');
  console.dir(movSample?.slice(0, 5), { depth: null });

  // 5. Total counts by movement_type in inventory_movements
  const { data: allMovs, error: allMovErr } = await supabase
    .from('inventory_movements')
    .select('movement_type');
  
  const typeCounts: Record<string, number> = {};
  if (allMovs) {
    for (const m of allMovs) {
      typeCounts[m.movement_type] = (typeCounts[m.movement_type] || 0) + 1;
    }
  }
  console.log('\ninventory_movements by movement_type:', typeCounts);

  // 6. Check specific negative SKUs: 61039682, 61060643, 61058414
  console.log('\n--- TRACING NEGATIVE SKUs ---');
  const targetSkus = ['61039682', '61060643', '61058414'];
  
  for (const sku of targetSkus) {
    console.log(`\n>>> Checking SKU: ${sku}`);
    const { data: pData } = await supabase.from('products').select('*').eq('sku', sku);
    console.log('Product Master record:', pData);

    if (pData && pData.length > 0) {
      const prodId = pData[0].id;
      const { data: pMovs } = await supabase
        .from('inventory_movements')
        .select('*')
        .eq('product_id', prodId);
      
      console.log(`Inventory movements for ${sku} (count: ${pMovs?.length || 0}):`);
      for (const m of (pMovs || [])) {
        console.log(`  - Type: ${m.movement_type}, Dir: ${m.direction}, Qty: ${m.quantity}, Ref: ${m.reference_type}/${m.reference_id}, Key: ${m.idempotency_key}, Created: ${m.created_at}`);
      }
    } else {
      // Look for movements with idempotency_key containing this SKU
      const { data: keyMovs } = await supabase
        .from('inventory_movements')
        .select('*')
        .ilike('idempotency_key', `%${sku}%`);
      console.log(`Movements matching SKU in idempotency_key (count: ${keyMovs?.length || 0}):`, keyMovs);
    }
  }

  // 7. Find all negative stock products
  console.log('\n--- CALCULATING ALL NEGATIVE STOCK SKUs ---');
  const { data: allProducts } = await supabase.from('products').select('id, sku, name, unit');
  const prodMap = new Map((allProducts || []).map(p => [p.id, p]));

  const { data: fullMovs } = await supabase
    .from('inventory_movements')
    .select('product_id, direction, quantity, movement_type, idempotency_key, reference_type, reference_id');
  
  const stockByProduct: Record<string, { total: number; inQty: number; outQty: number; movements: any[] }> = {};
  for (const m of (fullMovs || [])) {
    if (!stockByProduct[m.product_id]) {
      stockByProduct[m.product_id] = { total: 0, inQty: 0, outQty: 0, movements: [] };
    }
    const qty = Number(m.quantity) || 0;
    if (m.direction === 'in') {
      stockByProduct[m.product_id].total += qty;
      stockByProduct[m.product_id].inQty += qty;
    } else if (m.direction === 'out') {
      stockByProduct[m.product_id].total -= qty;
      stockByProduct[m.product_id].outQty += qty;
    }
    stockByProduct[m.product_id].movements.push(m);
  }

  const negativeProducts: any[] = [];
  for (const [prodId, data] of Object.entries(stockByProduct)) {
    if (data.total < 0) {
      const prod = prodMap.get(prodId);
      negativeProducts.push({
        productId: prodId,
        sku: prod?.sku || 'UNKNOWN',
        name: prod?.name || 'UNKNOWN',
        unit: prod?.unit || '',
        stock: data.total,
        inQty: data.inQty,
        outQty: data.outQty,
        movements: data.movements,
      });
    }
  }

  console.log(`Found ${negativeProducts.length} negative stock products:`);
  for (const np of negativeProducts.slice(0, 15)) {
    console.log(`\nSKU: ${np.sku} (${np.name}) -> Stock: ${np.stock} ${np.unit} (In: ${np.inQty}, Out: ${np.outQty})`);
    console.log('Movements breakdown:');
    const movTypeBreakdown: Record<string, { count: number; qty: number }> = {};
    for (const m of np.movements) {
      const key = `${m.movement_type} (${m.direction})`;
      if (!movTypeBreakdown[key]) movTypeBreakdown[key] = { count: 0, qty: 0 };
      movTypeBreakdown[key].count++;
      movTypeBreakdown[key].qty += Number(m.quantity) || 0;
    }
    console.log('  Types:', movTypeBreakdown);
    for (const m of np.movements) {
      console.log(`    * Type=${m.movement_type}, Dir=${m.direction}, Qty=${m.quantity}, Key=${m.idempotency_key}`);
    }
  }

  // 8. Check historical_sales_products
  console.log('\n--- CHECKING historical_sales_products TABLE ---');
  const { count: histCount, error: histErr } = await supabase
    .from('historical_sales_products')
    .select('*', { count: 'exact', head: true });
  console.log('historical_sales_products count:', histCount, 'error:', histErr);

  // 9. Check master_audit_log for deletion event
  console.log('\n--- CHECKING master_audit_log FOR RECENT DELETIONS ---');
  const { data: auditEvents } = await supabase
    .from('master_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('Recent audit events:');
  for (const a of (auditEvents || [])) {
    console.log(`  - [${a.created_at}] Action: ${a.action}, Module: ${a.module}, Status: ${a.status}, Detail: ${a.detail}`);
  }
}

runAudit().catch(console.error);
