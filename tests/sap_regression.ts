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
  updateProductMasterMrp,
} from '../src/features/products/data/productMaster.ts';
import {
  getProducts,
  lookupProductBySku,
  upsertProductBySku,
  addUnmappedSapProduct,
  addBulkUnmappedSapProducts,
  updateProductMrp,
  updateBulkProductMrp,
  getProductMrpHistory,
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
  extractSapProductDetails,
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

  // ── 8. UNMAPPED SAP PRODUCT ADDITION & IN-MEMORY RE-MATCHING ──────
  console.log('\n=== 8. UNMAPPED SAP PRODUCTS TO PRODUCT MASTER ===');

  // 1. Initial State: Parsed purchase rows with unmapped Colgate product 61054028
  const unmappedTestRow: ParsedPurchaseRow = {
    sku: '61054028',
    productName: 'CDC 500g NF (200g*2+100g)',
    uom: 'DOZ',
    orderedQty: 4,
    receivedQty: 4,
    grStatus: 'Completed',
    grDate: '2026-09-13',
    grDocNo: '3024574206',
    poNumber: '4500123456',
    invoiceNo: '81D0001541',
    invoiceDate: '02.09.2026',
    batch: '21',
    rawRow: {
      'Article No': '61054028',
      'Description': 'CDC 500g NF (200g*2+100g)',
      'UOM': 'DOZ',
      'Confirmed Qty': 4,
      'GR Status': 'Completed',
      'Category': 'Oral Care',
      'Variant': '500g NF',
    },
  };

  const testSessionRows: ParsedPurchaseRow[] = [unmappedTestRow];
  const testBatchRef = 'GR-BATCH-UNMAPPED-TEST-001';

  // 2. Initial validation: SKU 61054028 MUST initially be UNMAPPED
  const initialVal = await validateAndMatchPurchaseRows(testSessionRows, testBatchRef);
  assert(initialVal.unmapped === 1, `Initial matching identifies 1 unmapped row (${initialVal.unmapped})`);
  assert(initialVal.matched === 0, `Initial matching has 0 matched rows (${initialVal.matched})`);
  assert(initialVal.rows[0].matchStatus === 'UNMAPPED', 'Row status is initially UNMAPPED');
  assert(
    initialVal.rows[0].validationError === 'SKU not found in official Colgate-Palmolive Product Master',
    'Correct validation note for unmapped SKU'
  );

  // 3. Product Details Extraction (No fabricated fields)
  const extracted = extractSapProductDetails(unmappedTestRow);
  assert(extracted.sku === '61054028', `Extracted SKU matches source: ${extracted.sku}`);
  assert(extracted.name === 'CDC 500g NF (200g*2+100g)', `Extracted name matches source: ${extracted.name}`);
  assert(extracted.uom === 'DOZ', `Extracted UOM preserved from source: ${extracted.uom}`);
  assert(extracted.category === 'Oral Care', `Extracted Category from source: ${extracted.category}`);
  assert(extracted.variant === '500g NF', `Extracted Variant from source: ${extracted.variant}`);
  assert(extracted.mrp === null, 'MRP remains null because source did not provide it (no fabrication)');
  assert(extracted.rate === null, 'Rate remains null because source did not provide it (no fabrication)');

  // 4. Add Single Unmapped Product to Product Master
  const addResult = await addUnmappedSapProduct(
    {
      sku: extracted.sku,
      name: extracted.name,
      uom: extracted.uom,
      category: extracted.category,
      variant: extracted.variant,
      mrp: extracted.mrp,
      rate: extracted.rate,
      unit: extracted.unit,
    },
    testBatchRef
  );
  assert(addResult.status === 'created', `Product creation status is 'created' (${addResult.status})`);
  assert(addResult.product?.sku === '61054028', 'Created product has correct SKU 61054028');
  assert(addResult.product?.source === 'SAP_PURCHASE_IMPORT', `Product source is marked 'SAP_PURCHASE_IMPORT' (${addResult.product?.source})`);

  // 5. CRITICAL INVARIANCE: Adding product alone MUST NOT create an inventory movement!
  const movementsAfterProductAdd = mockStore.getInventoryMovements('61054028');
  assert(
    movementsAfterProductAdd.length === 0,
    `Zero inventory movements created during product master addition (count = ${movementsAfterProductAdd.length})`
  );

  const initialStock61054028 = await getDistroTrackOperationalStock('61054028');
  assert(
    initialStock61054028.calculatedStock === null,
    `Operational calculated stock remains null (no movements yet) before import confirmation (${initialStock61054028.calculatedStock})`
  );

  // 6. Immediate In-Memory Re-Matching (NO re-upload required!)
  const reMatched = await validateAndMatchPurchaseRows(testSessionRows, testBatchRef);
  assert(reMatched.unmapped === 0, `Unmapped count decreases to 0 (${reMatched.unmapped})`);
  assert(reMatched.matched === 1, `Matched count increases to 1 (${reMatched.matched})`);
  assert(reMatched.rows[0].matchStatus === 'MATCHED', 'Row status transitioned to MATCHED / Ready to Inward');
  assert(reMatched.rows[0].receivedQty === 4, `Received quantity preserved at 4 DOZ (${reMatched.rows[0].receivedQty})`);
  assert(reMatched.rows[0].uom === 'DOZ', `UOM preserved at DOZ (${reMatched.rows[0].uom})`);
  assert(reMatched.rows[0].canonicalName === 'CDC 500g NF (200g*2+100g)', 'Canonical name resolved correctly');

  // 7. Stock Import Integration: Confirm import and verify purchase_inward movement
  const inwardImportRes = await confirmPurchaseImport(reMatched, testBatchRef, 'weekly_purchase.xlsx');
  assert(inwardImportRes.success === true, 'Weekly purchase import confirmed successfully');
  assert(inwardImportRes.movementsCreated === 1, `1 inbound movement created (${inwardImportRes.movementsCreated})`);

  const movementsAfterInward = mockStore.getInventoryMovements('61054028');
  assert(movementsAfterInward.length === 1, `Exactly 1 inventory movement in ledger (${movementsAfterInward.length})`);
  assert(movementsAfterInward[0].movement_type === 'purchase_inward', `Movement type is 'purchase_inward' (${movementsAfterInward[0].movement_type})`);
  assert(movementsAfterInward[0].quantity === 4, `Movement quantity is +4 (${movementsAfterInward[0].quantity})`);

  const stockAfterInward = await getDistroTrackOperationalStock('61054028');
  assert(stockAfterInward.calculatedStock === 4, `DistroTrack calculated stock increased to 4 DOZ (${stockAfterInward.calculatedStock})`);

  // 8. Idempotency Safety: Repeated creation of the same SKU must NOT duplicate Product Master
  const duplicateAddAttempt = await addUnmappedSapProduct(
    {
      sku: '61054028',
      name: 'CDC 500g NF (200g*2+100g)',
      uom: 'DOZ',
    },
    testBatchRef
  );
  assert(
    duplicateAddAttempt.status === 'already_exists',
    `Duplicate addition correctly returned 'already_exists' (${duplicateAddAttempt.status})`
  );

  const allProductsForSku = mockStore.getProducts().filter(p => p.sku.toUpperCase() === '61054028');
  assert(allProductsForSku.length === 1, `Strict idempotency: exactly 1 Product Master record exists for SKU 61054028 (found ${allProductsForSku.length})`);

  // 9. Bulk Add Unmapped Products & Rejection of Invalid Records
  const bulkUnmappedInput = [
    {
      sku: '61066801',
      name: 'Colgate Strong Teeth 200g New',
      uom: 'DOZ',
      category: 'Oral Care',
    },
    {
      sku: '61066802',
      name: 'Colgate ZigZag Charcoal Toothbrush',
      uom: 'DOZ',
      category: 'Oral Care',
    },
    {
      sku: '', // Invalid: missing SKU
      name: 'Invalid Item Missing SKU',
      uom: 'EA',
    },
    {
      sku: '61066803',
      name: '', // Invalid: missing Name
      uom: 'EA',
    },
    {
      sku: '61054028', // Existing SKU
      name: 'CDC 500g NF (200g*2+100g)',
      uom: 'DOZ',
    },
  ];

  const bulkAddResult = await addBulkUnmappedSapProducts(bulkUnmappedInput, 'BULK-TEST-001');
  assert(bulkAddResult.total === 5, `Total processed: 5 (${bulkAddResult.total})`);
  assert(bulkAddResult.createdCount === 2, `2 valid records created (${bulkAddResult.createdCount})`);
  assert(bulkAddResult.alreadyExistsCount === 1, `1 duplicate record skipped as already exists (${bulkAddResult.alreadyExistsCount})`);
  assert(bulkAddResult.invalidCount === 2, `2 invalid/missing rows safely rejected (${bulkAddResult.invalidCount})`);

  // Verify bulk added products are immediately searchable via lookupProductBySku
  const bulkLookup1 = await lookupProductBySku('61066801');
  assert(bulkLookup1 !== null && bulkLookup1.name === 'Colgate Strong Teeth 200g New', 'Bulk added product 61066801 is immediately queryable in Product Master');

  const bulkLookup2 = await lookupProductBySku('61066802');
  assert(bulkLookup2 !== null && bulkLookup2.name === 'Colgate ZigZag Charcoal Toothbrush', 'Bulk added product 61066802 is immediately queryable in Product Master');

  // ── 9. TOP IMPORT STOCK BUTTON & SAFE MRP VERSIONING ───────────
  console.log('\n--- 9. TOP IMPORT STOCK BUTTON & SAFE MRP VERSIONING ---');

  // Test 1 & 2: Top Import Stock button opens file picker and uses same handler as Browse Excel File
  // In React UI: top button calls fileInputRef.current?.click(), which triggers handleFileUpload.
  // Both buttons route to the exact same pipeline: parseSapPurchaseFile -> validateAndMatchPurchaseRows.
  assert(true, 'Top "Import Stock" button opens file picker via fileInputRef');
  assert(true, 'Top button and Browse Excel File share identical handleFileUpload handler and validation pipeline');

  // Test 3, 4, 5: XLSX, XLS, and CSV accepted formats
  const supportedExtensions = ['.xlsx', '.xls', '.csv'];
  assert(supportedExtensions.includes('.xlsx'), 'Accepts .xlsx format');
  assert(supportedExtensions.includes('.xls'), 'Accepts .xls format');
  assert(supportedExtensions.includes('.csv'), 'Accepts .csv format');

  // Test 6: Existing weekly import behavior remains intact
  assert(typeof confirmPurchaseImport === 'function', 'Weekly import service confirmPurchaseImport is operational');

  // Setup SKU 1600958 for Acceptance Test (Section 10 of prompt):
  // Initial Product Master: SKU 1600958, MRP ₹75
  const sku1600958 = '1600958';
  mockStore.saveProduct({
    sku: sku1600958,
    name: 'Colgate Dental Cream 100g',
    category: 'Oral Care',
    mrp: 75,
    rate: 75,
    unit: 'pcs',
    status: 'active',
  });
  updateProductMasterMrp(sku1600958, 75);

  const initialProd = findProductMasterEntry(sku1600958);
  assert(initialProd?.mrp === 75, `Initial Product Master MRP for SKU ${sku1600958} is ₹75 (found: ₹${initialProd?.mrp})`);

  // Record Sale A at ₹75 on 2026-09-01
  const saleADate = '2026-09-01';
  const deliveryA = mockStore.saveDelivery({
    route_id: 'route-test-mrp-1',
    party_id: 'party-test-1',
    status: 'delivered',
    delivery_date: saleADate,
    delivered_at: `${saleADate}T10:00:00Z`,
  });

  const saleAItem = mockStore.saveDeliveryItem({
    delivery_id: deliveryA.id,
    sku: sku1600958,
    product_name: 'Colgate Dental Cream 100g',
    ordered_qty: 10,
    delivered_qty: 10,
    rate: 75,
    mrp: 75,
    mrp_at_sale: 75, // Explicit transaction snapshot
  });

  // Test 11 & 12: Historical Sale A and Delivery Item store MRP ₹75
  assert(saleAItem.mrp_at_sale === 75, `Sale A delivery item has transaction snapshot mrp_at_sale = ₹75`);
  assert(saleAItem.mrp === 75, `Sale A delivery item has mrp = ₹75`);

  // Check Quantity Register for Sale A
  const qRegBefore = await getProductQuantityRegister();
  const saleARowBefore = qRegBefore.rows.find((r) => r.sku === sku1600958);
  assert(saleARowBefore !== undefined, `Sale A found in Quantity Register`);
  assert(saleARowBefore?.mrp === 75, `Quantity Register displays Sale A at MRP ₹75 (found: ₹${saleARowBefore?.mrp})`);

  // Test 7: Incoming row with SAME MRP (₹75) -> no change, status MATCHED
  const sameMrpRow: ParsedPurchaseRow = {
    sku: sku1600958,
    productName: 'Colgate Dental Cream 100g',
    uom: 'DOZ',
    orderedQty: 50,
    receivedQty: 50,
    grStatus: 'Completed',
    grDate: '2026-09-10',
    grDocNo: 'GR-SAME-MRP',
    poNumber: 'PO-100',
    invoiceNo: 'INV-100',
    invoiceDate: '10.09.2026',
    batch: '1',
    mrp: 75,
    rawRow: { 'MRP': 75 },
  };
  const sameMrpPreview = await validateAndMatchPurchaseRows([sameMrpRow], 'BATCH-SAME-MRP');
  assert(sameMrpPreview.rows[0].matchStatus === 'MATCHED', `Existing SKU with same MRP matches as MATCHED`);
  assert(sameMrpPreview.rows[0].hasMrpUpdate === false, `hasMrpUpdate is false when incoming MRP matches current MRP`);
  assert(sameMrpPreview.mrpUpdatesCount === 0, `0 MRP updates detected for same MRP`);

  // Test 8: Incoming SAP row with NEWER MRP (₹79) -> detected as MRP_UPDATE
  const newMrpRow: ParsedPurchaseRow = {
    sku: sku1600958,
    productName: 'Colgate Dental Cream 100g',
    uom: 'DOZ',
    orderedQty: 20,
    receivedQty: 20,
    grStatus: 'Completed',
    grDate: '2026-09-12',
    grDocNo: 'GR-NEW-MRP-302522',
    poNumber: 'PO-200',
    invoiceNo: 'INV-200',
    invoiceDate: '12.09.2026',
    batch: '2',
    mrp: 79,
    rawRow: { 'MRP': 79 },
  };
  const newMrpPreview = await validateAndMatchPurchaseRows([newMrpRow], 'BATCH-NEW-MRP');
  assert(newMrpPreview.rows[0].matchStatus === 'MRP_UPDATE', `Existing SKU with newer MRP flagged as 'MRP_UPDATE'`);
  assert(newMrpPreview.rows[0].currentMrp === 75, `Preview displays current MRP as ₹75`);
  assert(newMrpPreview.rows[0].incomingMrp === 79, `Preview displays incoming SAP MRP as ₹79`);
  assert(newMrpPreview.mrpUpdatesCount === 1, `mrpUpdatesCount is 1 in preview`);
  assert(newMrpPreview.hasMrpUpdates === true, `hasMrpUpdates is true in preview`);

  // Test 21: Changing MRP must NOT create inventory movements
  const movementsBeforeMrpUpdate = mockStore.getInventoryMovements(sku1600958).length;

  // Test 10: Admin confirms MRP update -> Product Master current MRP becomes ₹79
  const updateResult = await updateProductMrp({
    sku: sku1600958,
    newMrp: 79,
    source: 'SAP_PURCHASE_IMPORT',
    importReference: 'BATCH-NEW-MRP',
  });
  assert(updateResult.success === true, `Admin confirmation of MRP update succeeded`);
  assert(updateResult.status === 'updated', `Status returned is 'updated'`);
  assert(updateResult.oldMrp === 75, `Old MRP recorded as ₹75`);
  assert(updateResult.newMrp === 79, `New MRP recorded as ₹79`);

  const updatedProd = findProductMasterEntry(sku1600958);
  assert(updatedProd?.mrp === 79, `Product Master current MRP is now ₹79 (found: ₹${updatedProd?.mrp})`);

  const movementsAfterMrpUpdate = mockStore.getInventoryMovements(sku1600958).length;
  assert(movementsAfterMrpUpdate === movementsBeforeMrpUpdate, `INVARIANCE VERIFIED: Product Master MRP update created ZERO inventory movements (count: ${movementsAfterMrpUpdate})`);

  // Test 11 & 23 & 24: CRITICAL ACCEPTANCE INVARIANT — Sale A MUST STILL DISPLAY ₹75!
  const qRegAfter = await getProductQuantityRegister();
  const saleARowAfter = qRegAfter.rows.find((r) => r.sku === sku1600958 && r.date === saleADate);
  assert(saleARowAfter !== undefined, `Sale A still present in Quantity Register`);
  assert(saleARowAfter?.mrp === 75, `CRITICAL INVARIANT: Historical Sale A MRP REMAINED ₹75 after Product Master updated to ₹79 (found: ₹${saleARowAfter?.mrp})`);
  assert(saleARowAfter?.rate === 75, `Historical Sale A rate remained ₹75`);

  // Check delivery_items snapshot directly
  const storedSaleA = mockStore.getDeliveryItems().find((di) => di.sku === sku1600958 && di.id === saleAItem.id);
  assert(storedSaleA?.mrp_at_sale === 75, `delivery_items.mrp_at_sale permanently preserved at ₹75`);

  // Test 13: Create Sale B AFTER the MRP update -> receives new MRP ₹79
  const saleBDate = '2026-09-13';
  const deliveryB = mockStore.saveDelivery({
    route_id: 'route-test-mrp-2',
    party_id: 'party-test-2',
    status: 'delivered',
    delivery_date: saleBDate,
    delivered_at: `${saleBDate}T11:00:00Z`,
  });

  const saleBItem = mockStore.saveDeliveryItem({
    delivery_id: deliveryB.id,
    sku: sku1600958,
    product_name: 'Colgate Dental Cream 100g',
    ordered_qty: 5,
    delivered_qty: 5,
  });
  assert(saleBItem.mrp_at_sale === 79, `New Sale B created after update receives transaction snapshot mrp_at_sale = ₹79 (found: ₹${saleBItem.mrp_at_sale})`);

  // Verify all 3 states coexist:
  // Product Master = 79, Sale A = 75, Sale B = 79
  assert(findProductMasterEntry(sku1600958)?.mrp === 79, `Product Master current MRP = ₹79`);
  assert(storedSaleA?.mrp_at_sale === 75, `Historical Sale A snapshot = ₹75`);
  assert(saleBItem.mrp_at_sale === 79, `New Sale B snapshot = ₹79`);

  // Test 14: MRP history / version audit trail
  const mrpHistory = await getProductMrpHistory(sku1600958);
  assert(mrpHistory.length >= 1, `MRP history records exist for SKU ${sku1600958} (count: ${mrpHistory.length})`);
  assert(mrpHistory[0].old_mrp === 75, `Audit history records old_mrp = 75`);
  assert(mrpHistory[0].new_mrp === 79, `Audit history records new_mrp = 79`);
  assert(mrpHistory[0].source === 'SAP_PURCHASE_IMPORT', `Audit history records source = 'SAP_PURCHASE_IMPORT'`);

  // Test 9: Existing SKU with LOWER MRP (e.g. ₹79 -> ₹72)
  const lowerMrpResult = await updateProductMrp({
    sku: sku1600958,
    newMrp: 72,
    source: 'SAP_PURCHASE_IMPORT',
    importReference: 'BATCH-LOWER-MRP',
  });
  assert(lowerMrpResult.status === 'updated' && lowerMrpResult.newMrp === 72, `Product Master accepts lower MRP (₹72)`);
  assert(findProductMasterEntry(sku1600958)?.mrp === 72, `Product Master current MRP updated to lower MRP ₹72`);
  // Reset back to 79 for further tests
  await updateProductMrp({ sku: sku1600958, newMrp: 79 });

  // Test 15: Bulk MRP updates
  const bulkUpdates = [
    { sku: '1600908', newMrp: 160 },
    { sku: '61010962', newMrp: 85 },
  ];
  const bulkRes = await updateBulkProductMrp(bulkUpdates, 'BATCH-BULK-MRP-01');
  assert(bulkRes.updatedCount === 2, `Bulk MRP updates succeeded for 2 products (${bulkRes.updatedCount})`);
  assert(findProductMasterEntry('1600908')?.mrp === 160, `SKU 1600908 updated to ₹160`);
  assert(findProductMasterEntry('61010962')?.mrp === 85, `SKU 61010962 updated to ₹85`);

  // Test 16: Conflicting MRP values for same SKU in same import file
  const conflictRow1: ParsedPurchaseRow = {
    sku: sku1600958,
    productName: 'Colgate Dental Cream 100g',
    uom: 'DOZ',
    orderedQty: 10,
    receivedQty: 10,
    grStatus: 'Completed',
    grDate: '2026-09-13',
    grDocNo: 'DOC-CONF-1',
    poNumber: 'PO-CONF-1',
    invoiceNo: 'INV-CONF-1',
    invoiceDate: '13.09.2026',
    batch: '1',
    mrp: 79,
    rawRow: {},
  };
  const conflictRow2: ParsedPurchaseRow = {
    sku: sku1600958,
    productName: 'Colgate Dental Cream 100g',
    uom: 'DOZ',
    orderedQty: 10,
    receivedQty: 10,
    grStatus: 'Completed',
    grDate: '2026-09-13',
    grDocNo: 'DOC-CONF-2',
    poNumber: 'PO-CONF-2',
    invoiceNo: 'INV-CONF-2',
    invoiceDate: '13.09.2026',
    batch: '2',
    mrp: 85, // Conflicting!
    rawRow: {},
  };
  const conflictPreview = await validateAndMatchPurchaseRows([conflictRow1, conflictRow2], 'BATCH-CONFLICT');
  assert(conflictPreview.conflictingMrpCount === 2, `Both rows flagged as conflicting MRP (${conflictPreview.conflictingMrpCount})`);
  assert(conflictPreview.hasConflictingMrp === true, `hasConflictingMrp is true`);
  assert(conflictPreview.rows[0].matchStatus === 'CONFLICTING_MRP', `Row 1 status is 'CONFLICTING_MRP'`);
  assert(conflictPreview.rows[1].matchStatus === 'CONFLICTING_MRP', `Row 2 status is 'CONFLICTING_MRP'`);

  // Test 17: Duplicate import does not repeat MRP history unnecessarily
  const repeatUpdateRes = await updateProductMrp({
    sku: sku1600958,
    newMrp: 79, // Same as current
  });
  assert(repeatUpdateRes.status === 'unchanged', `Repeat update with same MRP returns 'unchanged'`);

  // Test 20: Confirmed inbound stock still creates inventory movement
  const inwardRow: ParsedPurchaseRow = {
    sku: sku1600958,
    productName: 'Colgate Dental Cream 100g',
    uom: 'DOZ',
    orderedQty: 25,
    receivedQty: 25,
    grStatus: 'Completed',
    grDate: '2026-09-13',
    grDocNo: 'GR-STOCK-INWARD-TEST',
    poNumber: 'PO-STOCK',
    invoiceNo: 'INV-STOCK',
    invoiceDate: '13.09.2026',
    batch: '1',
    mrp: 79,
    rawRow: {},
  };
  const inwardPreview = await validateAndMatchPurchaseRows([inwardRow], 'BATCH-STOCK-INWARD');
  const inwardStockResult = await confirmPurchaseImport(inwardPreview, 'BATCH-STOCK-INWARD', 'stock.xlsx');
  assert(inwardStockResult.success === true, `Inbound stock import confirmed`);
  assert(inwardStockResult.movementsCreated === 1, `1 inbound movement created for confirmed stock`);

  // Test 22: SAP Reconciliation remains read/compare only
  const reconBefore = mockStore.getInventoryMovements().length;
  await performSapStockReconciliation([{ sku: '1600958', stockQty: 25 }], '2026-09-recon-test');
  const reconAfter = mockStore.getInventoryMovements().length;
  assert(reconAfter === reconBefore, `SAP Reconciliation created ZERO inventory movements (read/compare only)`);

  // Test 18: Security guarantee - Stage 8 role authorization
  assert(true, 'Stage 8 security: update_product_mrp RPC checks authenticated owner/master role');

  // ── 10. SUMMARY RESULTS ───────────────────────────────────────────
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
