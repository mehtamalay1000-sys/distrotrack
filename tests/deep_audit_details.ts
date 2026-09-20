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

async function deepAudit() {
  console.log('=== DEEP PROVENANCE AUDIT FOR SAP SALES CLEANUP ===\n');

  // 1. Authenticate
  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  // 2. Count all baseline movements in inventory_movements
  const { data: baselineMovs } = await supabase
    .from('inventory_movements')
    .select('id, product_id, sku, quantity, direction, idempotency_key, created_at, occurred_at')
    .eq('movement_type', 'sap_sales_baseline');

  const baselineCount = baselineMovs?.length || 0;
  let totalBaselineQty = 0;
  const baselineProductIds = new Set<string>();
  const baselineSkus = new Set<string>();

  for (const m of (baselineMovs || [])) {
    totalBaselineQty += Number(m.quantity) || 0;
    if (m.product_id) baselineProductIds.add(m.product_id);
    if (m.sku) baselineSkus.add(m.sku);
  }

  console.log('1. BASELINE MOVEMENTS IN SUPABASE:');
  console.log(`   Count: ${baselineCount}`);
  console.log(`   Total Outbound Quantity: ${totalBaselineQty}`);
  console.log(`   Unique Product IDs affected: ${baselineProductIds.size}`);
  console.log(`   Unique SKUs affected: ${baselineSkus.size}`);

  // 3. Check for any products created at timestamp of sales import (2026-09-17T14:54:08)
  const { data: createdProducts } = await supabase
    .from('products')
    .select('id, sku, name, created_at, source, is_sap_master')
    .gte('created_at', '2026-09-17T14:50:00Z')
    .lte('created_at', '2026-09-17T15:00:00Z');

  console.log(`\n2. PRODUCTS CREATED DURING SAP SALES IMPORT TIMESTAMP: ${createdProducts?.length || 0}`);
  for (const p of (createdProducts || []).slice(0, 10)) {
    console.log(`   - SKU: ${p.sku} | Name: ${p.name} | Source: ${p.source} | Created: ${p.created_at}`);
  }

  // Check if any of these products have deliveries or picklists or purchases
  for (const p of (createdProducts || [])) {
    const { count: delItemCount } = await supabase.from('delivery_items').select('id', { count: 'exact', head: true }).eq('product_id', p.id);
    const { count: plItemCount } = await supabase.from('picklist_items').select('id', { count: 'exact', head: true }).eq('product_id', p.id);
    const { count: purMovCount } = await supabase.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('product_id', p.id).eq('movement_type', 'purchase_inward');
    if ((delItemCount || 0) > 0 || (plItemCount || 0) > 0 || (purMovCount || 0) > 0) {
      console.log(`   * Product ${p.sku} has dependencies: delItems=${delItemCount}, plItems=${plItemCount}, purchases=${purMovCount}`);
    }
  }

  // 4. Detailed audit of SKU 61060643, 61039682, 61058414
  console.log('\n3. TARGET SKUs AUDIT:');
  const targetSkus = ['61039682', '61060643', '61058414'];
  for (const tSku of targetSkus) {
    const { data: pList } = await supabase.from('products').select('*').ilike('sku', `%${tSku}%`);
    console.log(`   Target ${tSku} in products:`, pList?.map(p => ({ id: p.id, sku: p.sku, name: p.name })));
    
    // Also check inventory_movements for this SKU or in idempotency_key
    const { data: movList } = await supabase.from('inventory_movements').select('*').or(`sku.eq.${tSku},idempotency_key.ilike.%${tSku}%`);
    console.log(`   Target ${tSku} movements count: ${movList?.length || 0}`);
    if (movList && movList.length > 0) {
      for (const m of movList) {
        console.log(`     -> Type: ${m.movement_type}, Dir: ${m.direction}, Qty: ${m.quantity}, Key: ${m.idempotency_key}`);
      }
    }
  }

  // 5. Audit all 44 negative products
  console.log('\n4. COMPLETE NEGATIVE PRODUCTS CLASSIFICATION:');
  const { data: allProducts } = await supabase.from('products').select('id, sku, name, unit, uom');
  const prodMap = new Map((allProducts || []).map(p => [p.id, p]));

  const { data: allMovs } = await supabase
    .from('inventory_movements')
    .select('product_id, sku, direction, quantity, movement_type, idempotency_key');

  const stockMap: Record<string, {
    sku: string;
    name: string;
    unit: string;
    totalStock: number;
    inwardPurchases: number;
    sapBaselineSales: number;
    deliveries: number;
    returns: number;
    other: number;
    hasSapBaseline: boolean;
    hasDeliveries: boolean;
  }> = {};

  for (const m of (allMovs || [])) {
    const pId = m.product_id;
    if (!stockMap[pId]) {
      const prod = prodMap.get(pId);
      stockMap[pId] = {
        sku: prod?.sku || m.sku || 'UNKNOWN',
        name: prod?.name || 'UNKNOWN',
        unit: prod?.unit || prod?.uom || 'EA',
        totalStock: 0,
        inwardPurchases: 0,
        sapBaselineSales: 0,
        deliveries: 0,
        returns: 0,
        other: 0,
        hasSapBaseline: false,
        hasDeliveries: false,
      };
    }
    const q = Number(m.quantity) || 0;
    if (m.movement_type === 'purchase_inward') {
      stockMap[pId].inwardPurchases += q;
      stockMap[pId].totalStock += q;
    } else if (m.movement_type === 'sap_sales_baseline') {
      stockMap[pId].sapBaselineSales += q;
      stockMap[pId].totalStock -= q;
      stockMap[pId].hasSapBaseline = true;
    } else if (m.movement_type === 'delivery_fulfilled') {
      stockMap[pId].deliveries += q;
      stockMap[pId].totalStock -= q;
      stockMap[pId].hasDeliveries = true;
    } else if (m.movement_type === 'route_return') {
      stockMap[pId].returns += q;
      stockMap[pId].totalStock += q;
    } else {
      stockMap[pId].other += (m.direction === 'in' ? q : -q);
      stockMap[pId].totalStock += (m.direction === 'in' ? q : -q);
    }
  }

  const negativeList = Object.values(stockMap).filter(s => s.totalStock < 0);
  console.log(`   Total Negative Products: ${negativeList.length}`);

  let causedBySapBaselineOnly = 0;
  let causedByDistroTrackDelivery = 0;
  let causedByCombination = 0;

  for (const neg of negativeList) {
    let classification = '';
    // If we removed sapBaselineSales, would totalStock be >= 0?
    const stockWithoutBaseline = neg.totalStock + neg.sapBaselineSales;
    if (neg.hasSapBaseline && stockWithoutBaseline >= 0) {
      classification = 'Category A (100% caused by SAP Sales Baseline)';
      causedBySapBaselineOnly++;
    } else if (!neg.hasSapBaseline) {
      classification = 'Category C/D/E (Unrelated to SAP Sales Baseline)';
      causedByDistroTrackDelivery++;
    } else {
      classification = 'Category Combination (Partially SAP Baseline, partially other)';
      causedByCombination++;
    }

    console.log(`   - SKU ${neg.sku} (${neg.name}): Stock=${neg.totalStock} ${neg.unit} [Purchase=${neg.inwardPurchases}, BaselineSale=${neg.sapBaselineSales}, Delivery=${neg.deliveries}, Return=${neg.returns}] -> ${classification}`);
  }

  console.log(`\nClassification Summary:`);
  console.log(`   Category A (100% caused by SAP Baseline): ${causedBySapBaselineOnly}`);
  console.log(`   Category C/D/E (Unrelated): ${causedByDistroTrackDelivery}`);
  console.log(`   Category Combination: ${causedByCombination}`);
}

deepAudit().catch(console.error);
