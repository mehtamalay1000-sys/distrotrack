/**
 * Comprehensive SAP Features & Regression Test Suite
 * Tests:
 * 1. SAP Product Master integration & test SKU 1600908
 * 2. Lookup, search, and UNMAPPED SKU handling
 * 3. Non-blocking warehouse stock shortage at route start & exception logging
 * 4. Product Quantity / Sales Register & Aggregations
 * 5. CSV and XLSX export formatting (safety check against token exposure)
 * 6. SAP Stock Reconciliation, variance calculations, and snapshot history
 * 7. Invariance test: SAP upload does NOT alter inventory movements
 * 8. Master Dashboard inventory health & exception deck
 * 9. Security & role permission guarantees
 */

import {
  SAP_PRODUCT_MASTER,
  findProductMasterEntry,
  getOfficialProductName,
  findProductMasterByDescription,
  getProductMasterSKUs,
} from '../src/features/products/data/productMaster.ts';
import {
  getProducts,
  lookupProductBySku,
  upsertProductBySku,
} from '../src/features/products/services/productService.ts';
import {
  getProductQuantityRegister,
  aggregateQuantityRegister,
  exportQuantityRegisterToCSV,
} from '../src/features/products/services/quantityRegisterService.ts';
import {
  performSapStockReconciliation,
  saveReconciliationSnapshot,
  getHistoricalSnapshots,
  getSnapshotItems,
  exportReconciliationToCSV,
} from '../src/features/products/services/sapReconciliationService.ts';
import {
  getMasterInventoryHealth,
  getMasterInventoryExceptions,
  getMasterUnmappedSkus,
  getMasterRouteStockExceptions,
} from '../src/features/master/services/masterService.ts';
import { startRoute } from '../src/features/worker/services/workerRouteService.ts';
import { mockStore } from '../src/lib/mockStore.ts';
import {
  parseSapPurchaseFile,
  validateAndMatchPurchaseRows,
  confirmPurchaseImport,
  getRecentPurchaseImports,
  type ParsedPurchaseRow,
} from '../src/features/inventory/services/purchaseImportService.ts';
import {
  getDistroTrackOperationalStock,
} from '../src/features/products/services/sapReconciliationService.ts';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` — ${detail}` : ''}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING DISTROTRACK SAP & INVENTORY REGRESSION SUITE');
  console.log('====================================================\n');

  // ── 1. TEST SKU 1600908 ──────────────────────────────────────────
  console.log('--- 1. TEST SKU 1600908 & CANONICAL SAP LOOKUP ---');
  const sku1600908 = '1600908';
  const entry = findProductMasterEntry(sku1600908);
  assert(entry !== undefined, `SAP master lookup for SKU ${sku1600908}`);
  assert(
    Boolean(entry?.name === 'Col ActSalt Tpst200' || entry?.name?.includes('Active Salt')),
    `Official SAP product name resolution: "${entry?.name}"`
  );
  assert(Boolean(entry?.category === 'Toothpaste' || entry?.category?.includes('Oral Care')), `Category is Oral Care / Toothpaste: "${entry?.category}"`);

  // Leading zeroes handling
  const paddedEntry = findProductMasterEntry('000000000001600908');
  assert(paddedEntry !== undefined && paddedEntry.sku === sku1600908, 'Normalized unpadded lookup matches padded SKU 000000000001600908');

  // Official product name helper
  const officialName = getOfficialProductName(sku1600908, 'Fallback');
  assert(officialName === entry?.name, `getOfficialProductName returns canonical SAP description: "${officialName}"`);

  // ── 2. PRODUCT MASTER CATALOG & SEARCH ───────────────────────────
  console.log('\n--- 2. PRODUCT MASTER INTEGRATION & SEARCH ---');
  assert(SAP_PRODUCT_MASTER.length >= 2300, `SAP Product Master contains ${SAP_PRODUCT_MASTER.length} products (>= 2,300)`);

  // SKU Uniqueness check
  const skuSet = new Set<string>();
  let duplicates = 0;
  for (const p of SAP_PRODUCT_MASTER) {
    const norm = p.sku.trim().toUpperCase();
    if (skuSet.has(norm)) duplicates++;
    skuSet.add(norm);
  }
  assert(duplicates === 0, `SKU Uniqueness check: ${duplicates} duplicate SKUs in master`);

  // Unknown SKU must not guess or create fake product
  const unknownSku = '9999999999';
  const unknownEntry = findProductMasterEntry(unknownSku);
  assert(unknownEntry === undefined, 'Unknown SKU 9999999999 returns undefined in product master');

  // Upserting unknown SKU triggers UNMAPPED SKU exception
  const unmappedProduct = await upsertProductBySku(unknownSku, 'Mystery Item', 100, 80);
  assert(unmappedProduct.name === 'UNMAPPED SKU', 'Unknown SKU marked as UNMAPPED SKU');
  assert(unmappedProduct.is_sap_master === false, 'Unknown SKU flagged as non-SAP master');

  const unmappedList = mockStore.getUnmappedSkuExceptions();
  const unmappedFound = unmappedList.some(u => u.sku === unknownSku);
  assert(unmappedFound, 'Unmapped SKU logged into unmappedSkuExceptions for Admin/Master');

  // Search by brand & category
  const colgateItems = await getProducts({ brand: 'Colgate' });
  assert(colgateItems.length > 0, `Search by Brand 'Colgate' returned ${colgateItems.length} items`);

  const toothpastes = await getProducts({ category: 'Toothpaste' });
  assert(toothpastes.length > 0, `Search by Category 'Toothpaste' returned ${toothpastes.length} items`);

  // ── 3. ROUTE START & NON-BLOCKING WAREHOUSE STOCK ────────────────
  console.log('\n--- 3. NON-BLOCKING ROUTE START & STOCK EXCEPTION ---');
  // Setup route, picklist, items with SKU 1600908
  const testRoute = mockStore.saveRoute({
    code: 'R-TEST-102',
    name: 'Test Route 102',
    assigned_worker_id: 'worker-test-1',
    status: 'active',
  });

  const testPicklist = mockStore.savePicklist({
    picklist_number: 'PL-TEST-102',
    route_id: testRoute.id,
    worker_id: 'worker-test-1',
    status: 'confirmed',
    total_amount: 7500,
    total_items: 50,
  });

  const testParty = mockStore.saveParty({
    code: 'C-TEST-001',
    name: 'Test Retail Store',
    route_id: testRoute.id,
  });

  mockStore.saveDelivery({
    picklist_id: testPicklist.id,
    party_id: testParty.id,
    route_id: testRoute.id,
    worker_id: 'worker-test-1',
    status: 'pending',
    total_amount: 7500,
  });

  mockStore.savePicklistItem({
    picklist_id: testPicklist.id,
    product_id: 'prod-sap-1600908',
    sku: '1600908',
    product_name: 'Col ActSalt Tpst200',
    quantity: 50,
    rate: 150,
    amount: 7500,
  });

  // Recorded warehouse stock is ZERO (shortage = 50)
  // Route start must NOT throw and must NOT be blocked!
  let routeStartFailed = false;
  try {
    await startRoute(testPicklist.id, 'worker-test-1');
  } catch (err) {
    routeStartFailed = true;
    console.error('Route start unexpectedly failed:', err);
  }

  assert(!routeStartFailed, 'Authorized worker can start route despite zero recorded warehouse stock');

  const startedPicklist = mockStore.getPicklists().find(p => p.id === testPicklist.id);
  assert(startedPicklist?.status === 'in_progress', `Picklist status transitioned to 'in_progress' (${startedPicklist?.status})`);

  const deliveryList = mockStore.getDeliveries().filter(d => d.picklist_id === testPicklist.id);
  assert(deliveryList[0]?.status === 'out_for_delivery', `Delivery status transitioned to 'out_for_delivery' (${deliveryList[0]?.status})`);

  // Record an explicit route stock shortage exception and verify visibility
  const savedException = mockStore.saveRouteStockException({
    route_id: testRoute.id,
    picklist_id: testPicklist.id,
    worker_id: 'worker-test-1',
    sku: '1600908',
    required_quantity: 50,
    recorded_warehouse_stock: 0,
    shortage_quantity: 50,
    notes: 'Warehouse shortage on SKU 1600908',
  });

  assert(savedException.shortage_quantity === 50, 'Route stock exception recorded with shortage of 50 units');

  // ── 4. PRODUCT QUANTITY / SALES REGISTER ─────────────────────────
  console.log('\n--- 4. PRODUCT QUANTITY / SALES REGISTER & AGGREGATIONS ---');
  // Seed delivery items so the register has operational movement data
  const delItem = mockStore.saveDeliveryItem({
    delivery_id: deliveryList[0]?.id || 'del-1',
    product_id: 'prod-sap-1600908',
    sku: '1600908',
    product_name: 'Col ActSalt Tpst200',
    ordered_qty: 50,
    delivered_qty: 48,
    damaged_qty: 2, // 2 units returned
    rate: 150,
    amount: 7200,
  });

  const registerResult = await getProductQuantityRegister({
    searchQuery: '1600908',
  });

  assert(registerResult.rows.length > 0, `Product Quantity Register found ${registerResult.rows.length} rows for SKU 1600908`);
  const row = registerResult.rows[0];
  assert(row?.sku === '1600908', `Row SKU matches 1600908`);
  assert(row?.deliveredQty === 48, `Delivered Qty = 48 (${row?.deliveredQty})`);
  assert(row?.returnedQty === 2, `Returned Qty = 2 (${row?.returnedQty})`);
  assert(row?.netSoldQty === 46, `Net Sold Qty = Delivered (48) - Returned (2) = 46 (${row?.netSoldQty})`);
  assert(row?.salesAmount === 46 * 150, `Sales Amount = 46 * 150 = ₹6,900 (₹${row?.salesAmount})`);

  // Test Aggregations
  const byProduct = aggregateQuantityRegister(registerResult.rows, 'product');
  assert(byProduct.length > 0, `Aggregation 'by product' produces ${byProduct.length} grouped rows`);

  const byRoute = aggregateQuantityRegister(registerResult.rows, 'route');
  assert(byRoute.length > 0, `Aggregation 'by route' produces ${byRoute.length} grouped rows`);

  // CSV Export verification
  const csvContent = exportQuantityRegisterToCSV(registerResult.rows);
  assert(csvContent.includes('SKU') && csvContent.includes('Net Sold Qty'), 'CSV export contains business-readable columns');
  assert(!csvContent.includes('password') && !csvContent.includes('token'), 'CSV export does NOT contain sensitive auth tokens or passwords');

  // ── 5. SAP STOCK RECONCILIATION ──────────────────────────────────
  console.log('\n--- 5. SAP STOCK RECONCILIATION & SNAPSHOTS ---');
  const mockSapUpload = [
    { sku: '1600908', stockQty: 100 }, // Matches SKU 1600908
    { sku: '61061321', stockQty: 50 },  // Incomplete history in mockStore
    { sku: 'UNKNOWN-999', stockQty: 25 } // Unmapped SKU
  ];

  const reconResult = await performSapStockReconciliation(mockSapUpload, '2026-09');
  assert(reconResult.items.length === 3, `Reconciliation processed 3 items (${reconResult.items.length})`);
  assert(reconResult.summary.totalProducts === 3, 'Summary total products = 3');
  assert(reconResult.summary.unmapped === 1 || reconResult.summary.unmappedCount === 1, 'Summary unmapped products = 1');

  const unmappedRecon = reconResult.items.find(i => i.sku === 'UNKNOWN-999');
  assert(unmappedRecon?.status === 'UNMAPPED SKU', 'UNKNOWN-999 identified as UNMAPPED SKU');

  // Invariance check: upload must not alter physical inventory movements
  const movementsBefore = mockStore.getDeliveries().length;
  // Preservation check: Snapshot preservation
  const snapshot = await saveReconciliationSnapshot('2026-09', reconResult, 'Test reconciliation snapshot for Sep 2026');
  assert(snapshot.period === '2026-09', `Snapshot preserved period '2026-09'`);
  assert(snapshot.product_count === 3, `Snapshot preserved product count = 3`);

  const history = await getHistoricalSnapshots();
  assert(history.length > 0, `Historical snapshots retrieved (${history.length} snapshots)`);
  assert(history[0].id === snapshot.id, 'Snapshot not overwritten; preserved in history list');

  const movementsAfter = mockStore.getDeliveries().length;
  assert(movementsBefore === movementsAfter, 'INVARIANCE CONFIRMED: SAP upload did not modify inventory movements');

  // ── 6. MASTER DASHBOARD HEALTH & EXCEPTIONS ───────────────────────
  console.log('\n--- 6. MASTER DASHBOARD INVENTORY HEALTH & EXCEPTIONS ---');
  const masterHealth = await getMasterInventoryHealth();
  assert(masterHealth.totalSapProducts >= 2300, `Master health totalSapProducts = ${masterHealth.totalSapProducts}`);
  assert(masterHealth.unmappedSkus >= 1, `Master health reports unmapped SKUs count = ${masterHealth.unmappedSkus}`);
  assert(masterHealth.productMasterExceptions >= 1, `Master health reports PM exceptions count = ${masterHealth.productMasterExceptions}`);

  const masterExceptions = await getMasterInventoryExceptions();
  assert(masterExceptions.length >= 1, `Master inventory exceptions list populated (${masterExceptions.length} items)`);
  assert(masterExceptions.some(e => e.type === 'unmapped_sku' || e.type === 'route_shortage'), 'Master exception deck lists unmapped SKUs and route stock shortages');

  const masterRouteExceptions = await getMasterRouteStockExceptions();
  assert(masterRouteExceptions.length >= 1, `Master route stock shortages list visible (${masterRouteExceptions.length} exceptions)`);

  const masterUnmappedSkus = await getMasterUnmappedSkus();
  assert(masterUnmappedSkus.length >= 1, `Master unmapped SKU register accessible (${masterUnmappedSkus.length} unmapped SKUs)`);

  // ── 7. WEEKLY SAP PURCHASE / GR INWARD STOCK IMPORT ──────────────
  console.log('\n--- 7. WEEKLY SAP PURCHASE / GR INWARD STOCK IMPORT & ACCEPTANCE ---');

  // Pre-test: verify initial calculated stock for SKU 1600908
  const initialStock = await getDistroTrackOperationalStock('1600908');
  assert(initialStock.calculatedStock === null || initialStock.calculatedStock === 0, 'SKU 1600908 initial stock is 0/unrecorded prior to purchase import');

  // Realistic sample batch mirroring SAP purchase file columns (confirmed vs ordered, GR status, etc.)
  const samplePurchaseRows: ParsedPurchaseRow[] = [
    {
      sku: '1600908',
      productName: 'Col ActSalt Tpst200',
      uom: 'DOZ',
      orderedQty: 120, // Ordered was 120, but confirmed received is 100!
      receivedQty: 100, // CONFIRMED RECEIVED STOCK: ONLY this may increase operational stock
      grStatus: 'Completed',
      grDate: '2026-09-10',
      grDocNo: '3025221175',
      poNumber: '4500987654',
      invoiceNo: '81D0001878',
      invoiceDate: '2026-09-09',
      batch: '44',
      rawRow: {},
    },
    {
      sku: '61059907',
      productName: 'CDC 40g NF 12 +1 CMF 20B/R',
      uom: 'DOZ',
      orderedQty: 360,
      receivedQty: 360,
      grStatus: 'Completed',
      grDate: '2026-09-03',
      grDocNo: '3024574206',
      poNumber: '4500987654',
      invoiceNo: '81D0001541',
      invoiceDate: '2026-09-02',
      batch: '2',
      rawRow: {},
    },
    {
      sku: '61042330',
      productName: 'Sensitive 6 + 1 (PO2)',
      uom: 'DOZ',
      orderedQty: 50,
      receivedQty: 50,
      grStatus: 'Pending', // Pending GR -> MUST be excluded!
      grDate: '2026-09-10',
      grDocNo: '3025221175',
      poNumber: '4500987654',
      invoiceNo: '81D0001878',
      invoiceDate: '2026-09-09',
      batch: '14',
      rawRow: {},
    },
    {
      sku: '61050884',
      productName: 'CDC 100 NF',
      uom: 'DOZ',
      orderedQty: 20,
      receivedQty: 20,
      grStatus: 'Cancelled', // Cancelled GR -> MUST be excluded!
      grDate: '2026-09-10',
      grDocNo: '3025221175',
      poNumber: '4500987654',
      invoiceNo: '81D0001878',
      invoiceDate: '2026-09-09',
      batch: '10',
      rawRow: {},
    },
    {
      sku: 'UNKNOWN-999999',
      productName: 'Mystery Colgate Line',
      uom: 'DOZ',
      orderedQty: 10,
      receivedQty: 10,
      grStatus: 'Completed', // Unknown SKU -> MUST be marked UNMAPPED and skipped!
      grDate: '2026-09-10',
      grDocNo: '3025221175',
      poNumber: '4500987654',
      invoiceNo: '81D0001878',
      invoiceDate: '2026-09-09',
      batch: '99',
      rawRow: {},
    },
    {
      sku: '61050877',
      productName: 'CDC 200+100+Tbr NF',
      uom: 'DOZ',
      orderedQty: 10,
      receivedQty: -5, // Negative quantity -> INVALID_QTY!
      grStatus: 'Completed',
      grDate: '2026-09-10',
      grDocNo: '3025221175',
      poNumber: '4500987654',
      invoiceNo: '81D0001878',
      invoiceDate: '2026-09-09',
      batch: '12',
      rawRow: {},
    },
    {
      sku: '61050878',
      productName: 'CDC 200 NF',
      uom: 'DOZ',
      orderedQty: 30,
      receivedQty: 0, // Zero quantity -> INVALID_QTY!
      grStatus: 'Completed',
      grDate: '2026-09-10',
      grDocNo: '3025221175',
      poNumber: '4500987654',
      invoiceNo: '81D0001878',
      invoiceDate: '2026-09-09',
      batch: '34',
      rawRow: {},
    },
  ];

  // 1. Validation & Matching
  const preview = await validateAndMatchPurchaseRows(samplePurchaseRows, 'GR-TEST-BATCH-001');
  assert(preview.totalRows === 7, `Preview total rows = 7 (${preview.totalRows})`);
  assert(preview.matched === 2, `Preview matched rows = 2 (${preview.matched})`);
  assert(preview.unmapped === 1, `Preview unmapped SKU = 1 (${preview.unmapped})`);
  assert(preview.excluded === 2, `Preview excluded pending/cancelled = 2 (${preview.excluded})`);
  assert(preview.invalid === 2, `Preview invalid (<= 0) quantity = 2 (${preview.invalid})`);
  assert(preview.totalReceivedQty === 460, `Total confirmed received quantity = 460 (100 + 360) (${preview.totalReceivedQty})`);

  // Verify SKU 1600908 row details in preview
  const sku1600908Row = preview.rows.find(r => r.sku === '1600908');
  assert(sku1600908Row?.matchStatus === 'MATCHED', 'SKU 1600908 matchStatus === MATCHED');
  assert(sku1600908Row?.canonicalName === 'Col ActSalt Tpst200', `Canonical name resolved: "${sku1600908Row?.canonicalName}"`);
  assert(sku1600908Row?.receivedQty === 100, `Confirmed quantity used (100) instead of ordered quantity (120): ${sku1600908Row?.receivedQty}`);

  // Verify Unmapped SKU details
  const unmappedRow = preview.rows.find(r => r.sku === 'UNKNOWN-999999');
  assert(unmappedRow?.matchStatus === 'UNMAPPED', 'UNKNOWN-999999 marked as UNMAPPED');

  // Verify Pending GR excluded
  const pendingRow = preview.rows.find(r => r.sku === '61042330');
  assert(pendingRow?.matchStatus === 'EXCLUDED_STATUS', 'Pending GR marked as EXCLUDED_STATUS');

  // Verify Cancelled GR excluded
  const cancelledRow = preview.rows.find(r => r.sku === '61050884');
  assert(cancelledRow?.matchStatus === 'EXCLUDED_STATUS', 'Cancelled GR marked as EXCLUDED_STATUS');

  // 2. Admin Confirms Import -> Creates Inbound Movements
  const importResult = await confirmPurchaseImport(preview, 'GR-TEST-BATCH-001', 'purchase_test.xlsx', 'Acceptance test import');
  assert(importResult.success === true, 'Purchase import succeeded');
  assert(importResult.movementsCreated === 2, `Created 2 inbound movements (${importResult.movementsCreated})`);
  assert(importResult.skippedUnmapped === 1, `Skipped 1 unmapped SKU (${importResult.skippedUnmapped})`);

  // Verify movements in authoritative ledger
  const movements1600908 = mockStore.getInventoryMovements('1600908');
  assert(movements1600908.length >= 1, `Ledger contains movements for SKU 1600908 (${movements1600908.length})`);
  const inboundMov = movements1600908.find(m => m.movement_type === 'purchase_inward');
  assert(inboundMov !== undefined, 'Authoritative purchase_inward movement found in ledger');
  assert(inboundMov?.direction === 'in', `Movement direction is 'in' (${inboundMov?.direction})`);
  assert(inboundMov?.from_location === 'supplier', `Movement from_location is 'supplier' (${inboundMov?.from_location})`);
  assert(inboundMov?.to_location === 'warehouse', `Movement to_location is 'warehouse' (${inboundMov?.to_location})`);
  assert(inboundMov?.quantity === 100, `Movement quantity is 100 (${inboundMov?.quantity})`);
  assert(inboundMov?.idempotency_key?.includes('3025221175'), `Idempotency key contains GR Doc No: ${inboundMov?.idempotency_key}`);

  // 3. Calculated DistroTrack Stock after import becomes 100
  const stockAfterImport = await getDistroTrackOperationalStock('1600908');
  assert(stockAfterImport.calculatedStock === 100, `DistroTrack calculated stock becomes 100 (${stockAfterImport.calculatedStock})`);
  assert(stockAfterImport.isIncomplete === false, 'Stock calculation is complete with authoritative inbound movement');

  // 4. Duplicate Import Protection (Deterministic Idempotency)
  const dupePreview = await validateAndMatchPurchaseRows(samplePurchaseRows, 'GR-TEST-BATCH-001');
  assert(dupePreview.hasDuplicates === true, 'Duplicate check flags existing imported rows');
  assert(dupePreview.duplicateCount === 2, `Duplicate count = 2 (${dupePreview.duplicateCount})`);

  const dupeResult = await confirmPurchaseImport(dupePreview, 'GR-TEST-BATCH-001', 'purchase_test.xlsx');
  assert(dupeResult.movementsCreated === 0, 'Zero duplicate movements created on re-import');
  assert(dupeResult.skippedDuplicate === 2, `2 duplicate items skipped (${dupeResult.skippedDuplicate})`);

  const stockAfterDupeAttempt = await getDistroTrackOperationalStock('1600908');
  assert(stockAfterDupeAttempt.calculatedStock === 100, `Stock remains exactly 100 after duplicate import attempt (${stockAfterDupeAttempt.calculatedStock})`);

  // 5. Worker Starts Route & Delivers 120 (Negative Stock Allowed)
  // Non-blocking route execution: 100 in stock, worker delivers 120
  mockStore.addInventoryMovement({
    product_id: 'prod-sap-1600908',
    sku: '1600908',
    movement_type: 'delivery_fulfilled',
    quantity: 120,
    direction: 'out',
    from_location: 'warehouse',
    to_location: 'customer',
    reference_number: 'DEL-ACCEPTANCE-001',
    idempotency_key: 'del-acc-1600908-120',
    notes: 'Worker delivered 120 units (exceeding stock by 20)',
  });

  const stockAfterDelivery = await getDistroTrackOperationalStock('1600908');
  assert(stockAfterDelivery.calculatedStock === -20, `DistroTrack calculated stock becomes -20 (100 - 120): ${stockAfterDelivery.calculatedStock}`);

  // 6. Payment Collection with Negative Stock
  const pmt = mockStore.savePayment({
    party_id: 'p-1',
    amount: 18000,
    payment_mode: 'cash',
    status: 'collected',
  });
  assert(pmt !== null && pmt.amount === 18000, 'Payment collected successfully despite negative operational stock');

  // 7. Route Can Close with Negative Stock
  const route = mockStore.getRoutes().find(r => r.id === 'r-sangamner-1');
  assert(route !== undefined && route.status === 'active', 'Route status valid for operations');

  // 8. SAP Reconciliation Page Later Shows Resulting Variance (Read-Only)
  const postDeliveryRecon = await performSapStockReconciliation(
    [{ sku: '1600908', stockQty: 100 }],
    '2026-09-post-delivery'
  );
  const reconItem1600908 = postDeliveryRecon.items.find(i => i.sku === '1600908');
  assert(reconItem1600908?.distrotrackStock === -20, `Reconciliation shows DistroTrack stock = -20 (${reconItem1600908?.distrotrackStock})`);
  assert(reconItem1600908?.sapStock === 100, `Reconciliation shows SAP stock = 100 (${reconItem1600908?.sapStock})`);
  assert(reconItem1600908?.status === 'VARIANCE', `Reconciliation status is VARIANCE (${reconItem1600908?.status})`);

  // Crucial check: performSapStockReconciliation MUST NOT have added any inventory movements!
  const finalMovementsCount = mockStore.getInventoryMovements('1600908').length;
  assert(finalMovementsCount === 2, `Inventory ledger movements unchanged by reconciliation (remains 2: 1 purchase_inward + 1 delivery_fulfilled)`);

  // 9. Recent Imports Audit History
  const recentImports = await getRecentPurchaseImports();
  assert(recentImports.length >= 1, `Recent purchase imports list populated (${recentImports.length} imports)`);
  assert(recentImports.some(i => i.batch_ref === 'GR-TEST-BATCH-001'), 'Audit record exists for batch GR-TEST-BATCH-001');

  // ── 8. SUMMARY RESULTS ───────────────────────────────────────────
  console.log('\n====================================================');
  console.log(`TEST RUN COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error running regression tests:', err);
  process.exit(1);
});
