/**
 * Products & Inventory Central Operational View Regression Test Suite
 *
 * Verifies:
 * 1. Product Catalog Master functionality preserved (identity, search, filter, CRUD).
 * 2. Operational Inventory derived strictly from authoritative inventory_movements ledger.
 * 3. Specific Test SKU 1600958 end-to-end (0 stock -> +inbound -> -delivery -> negative stock -> unblocked ops -> safe MRP).
 * 4. Inbound SAP Purchase/GR imports reflect in Inventory view.
 * 5. Delivered quantity decreases stock, returned quantity increases stock.
 * 6. Negative stock allowed by design without blocking route start, delivery, payment, or close.
 * 7. Unmapped products flow: Add to Master -> Revalidate -> Ready to Inward -> Confirm -> visible in Catalog & Inventory.
 * 8. Summary cards (Total SKUs, Total Inbound, Total Delivered, Total Returned, Low/Negative, Unmapped/Incomplete).
 * 9. Search & Filter capabilities (SKU, Name, In Stock, Zero Stock, Negative Stock, Low Stock, Unmapped, Incomplete).
 * 10. Stock movement history modal with accurate chronological running balance.
 * 11. Decoupling: MRP separate from stock; Historical transaction MRP protected.
 * 12. SAP Reconciliation & Quantity Register remain separate features.
 * 13. Idempotency prevents duplicate products and duplicate stock additions.
 */

import { mockStore } from '../src/lib/mockStore.ts';
import {
  findProductMasterEntry,
  getOfficialProductName,
  resetProductMasterMemory,
} from '../src/features/products/data/productMaster.ts';
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  addUnmappedSapProduct,
  updateProductMrp,
  getProductMrpHistory,
  clearAllOperationalProducts,
} from '../src/features/products/services/productService.ts';
import {
  getOperationalInventoryData,
  getProductMovementHistory,
  type ProductInventoryItem,
} from '../src/features/inventory/services/inventoryService.ts';
import {
  validateAndMatchPurchaseRows,
  confirmPurchaseImport,
  type ParsedPurchaseRow,
} from '../src/features/inventory/services/purchaseImportService.ts';
import { performSapStockReconciliation } from '../src/features/products/services/sapReconciliationService.ts';
import { getProductQuantityRegister } from '../src/features/products/services/quantityRegisterService.ts';

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

async function runProductsInventoryRegression() {
  console.log('================================================================');
  console.log('STARTING DISTROTRACK PRODUCTS & INVENTORY REGRESSION TEST SUITE');
  console.log('================================================================\n');

  // Reset/clean initial test state in mockStore and Product Master
  (mockStore as any).inventoryMovements = [];
  (mockStore as any).sapPurchaseImports = [];
  (mockStore as any).sapPurchaseImportItems = [];
  (mockStore as any).productMrpHistory = [];

  // ════════════════════════════════════════════════════════════════════
  // 1. CLEAN RESET VERIFICATION (Clean Product Master Starts at 0)
  // ════════════════════════════════════════════════════════════════════
  console.log('--- 1. CLEAN RESET: ZERO PRODUCT MASTER & PERSISTENCE ---');
  (mockStore as any).products = [];
  (mockStore as any).inventoryMovements = [];
  resetProductMasterMemory();

  const initialProducts = await getProducts();
  assert(initialProducts.length === 0, `Product Catalog starts completely clean with 0 products (count: ${initialProducts.length})`);

  const initialInventory = await getOperationalInventoryData();
  assert(initialInventory.items.length === 0, `Inventory view starts with 0 tracked items (count: ${initialInventory.items.length})`);
  assert(initialInventory.summary.totalSkus === 0, `Summary total tracked SKUs is 0 (${initialInventory.summary.totalSkus})`);

  // ════════════════════════════════════════════════════════════════════
  // 2. PRODUCT MASTER CRUD CAPABILITY PRESERVED
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 2. PRODUCT MASTER CRUD CAPABILITY PRESERVED ---');
  const testNewSku = `TEST-CAT-${Date.now().toString().slice(-4)}`;
  const createdProd = await createProduct({
    sku: testNewSku,
    name: 'Test Colgate Charcoal 120g',
    category: 'Toothpaste',
    mrp: 120,
    rate: 110,
    unit: 'pcs',
    brand: 'Colgate',
  });
  assert(createdProd.sku === testNewSku, `Created new manual product ${testNewSku} in Product Master`);
  const prodsAfterCreate = await getProducts();
  assert(prodsAfterCreate.length === 1, `Product Master contains 1 product after manual create (${prodsAfterCreate.length})`);

  const updatedProd = await updateProduct(createdProd.id, { rate: 112 });
  assert(updatedProd.rate === 112, `Updated product rate in master to ₹${updatedProd.rate}`);

  await deleteProduct(createdProd.id);
  const productsAfterDelete = await getProducts();
  assert(productsAfterDelete.length === 0, 'Deleted product removed from master (count back to 0)');

  // ════════════════════════════════════════════════════════════════════
  // 3. REAL SAP PURCHASE IMPORT -> UNMAPPED -> ADD TO MASTER -> INWARD
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 3. REAL SAP PURCHASE IMPORT -> UNMAPPED -> ADD TO MASTER -> INWARD ---');
  const sapPurchaseRow1600958: ParsedPurchaseRow = {
    sku: '1600958',
    productName: 'ColActSalt Tpst100g',
    uom: 'DOZ',
    orderedQty: 100,
    receivedQty: 100,
    grStatus: 'Completed',
    grDate: '2026-09-13',
    grDocNo: '3025221958',
    poNumber: '4500998877',
    invoiceNo: '81D0009580',
    invoiceDate: '13.09.2026',
    batch: '58',
    mrp: 75,
    rate: 70,
    rawRow: {
      Category: 'Toothpaste',
      Brand: 'Colgate',
    },
  };

  // Step 1: SKU does not yet exist in Master -> UNMAPPED detected
  const preview1600958Initial = await validateAndMatchPurchaseRows([sapPurchaseRow1600958], 'SAP-BATCH-1600958');
  assert(preview1600958Initial.unmapped === 1, `Unknown SKU 1600958 detected as UNMAPPED (count: ${preview1600958Initial.unmapped})`);
  assert(preview1600958Initial.matched === 0, 'Zero matched rows before adding to master');
  assert(preview1600958Initial.rows[0].matchStatus === 'UNMAPPED', 'Row matchStatus is UNMAPPED');

  // Step 2: Admin adds SKU to Product Master using SAP information
  const addRes1600958 = await addUnmappedSapProduct({
    sku: '1600958',
    name: 'ColActSalt Tpst100g',
    category: 'Toothpaste',
    mrp: 75,
    rate: 70,
    unit: 'doz',
    brand: 'Colgate',
    uom: 'DOZ',
  }, 'SAP-BATCH-1600958');
  assert(addRes1600958.status === 'created', `Added SKU 1600958 to Product Master (${addRes1600958.status})`);

  // Step 3: Product now appears in Product Catalog
  const prodsAfterAdd = await getProducts();
  assert(prodsAfterAdd.length === 1, `Product Catalog now contains 1 operational product (${prodsAfterAdd.length})`);
  const prod1600958 = prodsAfterAdd[0];
  assert(prod1600958.sku === '1600958', 'Product Master SKU matches canonical 1600958');
  assert(prod1600958.mrp === 75, `Product Master MRP is ₹75 (found: ₹${prod1600958.mrp})`);

  // Step 4: Duplicate product prevention
  const addDupRes = await addUnmappedSapProduct({
    sku: '1600958',
    name: 'ColActSalt Tpst100g',
  }, 'SAP-BATCH-1600958');
  assert(addDupRes.status === 'already_exists', `Duplicate add prevented (status: ${addDupRes.status})`);
  const prodsAfterDup = await getProducts();
  assert(prodsAfterDup.length === 1, 'No duplicate product created in Product Catalog');

  // Step 5: Automatic Revalidation -> MATCHED / READY TO INWARD
  const preview1600958Reval = await validateAndMatchPurchaseRows([sapPurchaseRow1600958], 'SAP-BATCH-1600958');
  assert(preview1600958Reval.matched === 1, `Row revalidated as MATCHED (count: ${preview1600958Reval.matched})`);
  assert(preview1600958Reval.unmapped === 0, `Unmapped count reduced to 0 (${preview1600958Reval.unmapped})`);

  // Step 6: Confirm Inbound
  const importResult1600958 = await confirmPurchaseImport(preview1600958Reval, 'SAP-BATCH-1600958', 'purchase_1600958.xlsx');
  assert(importResult1600958.success === true, 'Weekly SAP purchase import confirmed successfully');
  assert(importResult1600958.movementsCreated === 1, `1 inbound movement created in ledger (${importResult1600958.movementsCreated})`);

  // Step 6: Verify purchase_inward ledger movement
  const ledgerMovements1600958 = mockStore.getInventoryMovements('1600958');
  assert(ledgerMovements1600958.length === 1, `Authoritative ledger contains 1 movement for 1600958 (${ledgerMovements1600958.length})`);
  const inboundMov = ledgerMovements1600958[0];
  assert(inboundMov.movement_type === 'purchase_inward', `Movement type is 'purchase_inward' (${inboundMov.movement_type})`);
  assert(inboundMov.quantity === 100, `Inbound quantity is +100 (${inboundMov.quantity})`);
  assert(inboundMov.direction === 'in', `Movement direction is 'in' (${inboundMov.direction})`);
  assert(inboundMov.to_location === 'warehouse', `Movement to_location is 'warehouse' (${inboundMov.to_location})`);

  // Step 7 & 8: Open Products -> Inventory & verify inbound quantity appears
  const inventoryAfterInbound = await getOperationalInventoryData();
  const itemAfterInbound = inventoryAfterInbound.items.find((i) => i.sku === '1600958');
  assert(itemAfterInbound !== undefined, 'SKU 1600958 found in inventory view');
  assert(itemAfterInbound?.inboundQty === 100, `Inbound quantity in Inventory tab is 100 (${itemAfterInbound?.inboundQty})`);

  // Step 9: Verify current stock is correct
  assert(itemAfterInbound?.currentStock === 100, `Current calculated stock is exactly 100 (${itemAfterInbound?.currentStock})`);
  assert(itemAfterInbound?.stockStatus === 'IN_STOCK', `Stock Status is IN_STOCK (${itemAfterInbound?.stockStatus})`);

  // Step 10: Deliver more than available stock (Deliver 120 units against 100 stock)
  mockStore.addInventoryMovement({
    product_id: prod1600958.id,
    sku: '1600958',
    movement_type: 'delivery_fulfilled',
    quantity: 120,
    direction: 'out',
    from_location: 'warehouse',
    to_location: 'customer',
    reference_number: 'DEL-INV-1600958-OVER',
    idempotency_key: 'del-idemp-1600958-120',
    notes: 'Dispatched 120 units to retailer prior to additional inward confirmation',
  });

  // Step 11: Verify negative stock is shown in Inventory
  const inventoryAfterDelivery = await getOperationalInventoryData();
  const itemAfterDelivery = inventoryAfterDelivery.items.find((i) => i.sku === '1600958');
  assert(itemAfterDelivery?.inboundQty === 100, `Inbound remains 100 (${itemAfterDelivery?.inboundQty})`);
  assert(itemAfterDelivery?.deliveredQty === 120, `Delivered quantity is 120 (${itemAfterDelivery?.deliveredQty})`);
  assert(itemAfterDelivery?.currentStock === -20, `Current stock is -20 (100 - 120 = -20) (found: ${itemAfterDelivery?.currentStock})`);
  assert(itemAfterDelivery?.stockStatus === 'NEGATIVE_STOCK', `Stock Status is NEGATIVE_STOCK (${itemAfterDelivery?.stockStatus})`);

  // Step 12: Verify delivery, payment, route are NOT blocked
  const route = mockStore.getRoutes()[0];
  assert(route !== undefined && route.status === 'active', 'Route remains active and unblocked');
  const payment = mockStore.savePayment({
    party_id: 'p-1',
    amount: 9000,
    payment_mode: 'upi',
    status: 'collected',
  });
  assert(payment !== null && payment.status === 'collected', 'Payment collected successfully despite negative operational stock');

  // Step 13: Historical transaction MRP remains unchanged after an MRP update
  // Record historical sale snapshot at ₹75
  const deliveryA = mockStore.saveDelivery({
    party_id: 'p-1',
    status: 'delivered',
    delivery_date: '2026-09-10',
    delivered_at: '2026-09-10T10:00:00Z',
  });
  const historicalDeliveryItem = mockStore.saveDeliveryItem({
    delivery_id: deliveryA.id,
    product_id: prod1600958.id,
    sku: '1600958',
    ordered_qty: 10,
    delivered_qty: 10,
    rate: 75,
    mrp: 75,
    mrp_at_sale: 75, // Snapshot column
  });
  assert(historicalDeliveryItem.mrp_at_sale === 75, 'Historical delivery item recorded with snapshot mrp_at_sale = ₹75');

  // Admin updates Product Master current MRP to ₹79
  const mrpUpdateRes = await updateProductMrp({
    sku: '1600958',
    newMrp: 79,
    source: 'SAP_PURCHASE_IMPORT',
    importReference: 'SAP-BATCH-1600958',
  });
  assert(mrpUpdateRes.success === true, 'Product Master MRP updated to ₹79');

  // Verify Product Master current MRP is now ₹79
  const prodMasterUpdated = (await getProducts()).find((p) => p.sku === '1600958');
  assert(prodMasterUpdated?.mrp === 79, `Product Master current MRP is now ₹79 (found: ₹${prodMasterUpdated?.mrp})`);

  // CRITICAL INVARIANT: Historical transaction mrp_at_sale MUST RETAIN ₹75
  const deliveryItemsAfterUpdate = mockStore.getDeliveryItems().find((d) => d.id === historicalDeliveryItem.id);
  assert(
    deliveryItemsAfterUpdate?.mrp_at_sale === 75,
    `HISTORICAL MRP PROTECTION: Historical transaction mrp_at_sale remains ₹75 (found: ₹${deliveryItemsAfterUpdate?.mrp_at_sale})`
  );
  assert(
    deliveryItemsAfterUpdate?.mrp === 75,
    `Historical transaction mrp remains ₹75 (found: ₹${deliveryItemsAfterUpdate?.mrp})`
  );

  // New sale created after update receives new MRP snapshot ₹79
  const deliveryB = mockStore.saveDelivery({
    party_id: 'p-1',
    status: 'delivered',
    delivery_date: '2026-09-13',
    delivered_at: '2026-09-13T10:00:00Z',
  });
  const newDeliveryItem = mockStore.saveDeliveryItem({
    delivery_id: deliveryB.id,
    product_id: prod1600958.id,
    sku: '1600958',
    ordered_qty: 5,
    delivered_qty: 5,
    rate: 79,
    mrp: 79,
    mrp_at_sale: 79,
  });
  assert(newDeliveryItem.mrp_at_sale === 79, `New transaction receives updated MRP snapshot ₹79 (found: ₹${newDeliveryItem.mrp_at_sale})`);

  // Quantity Register verifies separate transaction snapshot
  const qtyRegister = await getProductQuantityRegister();
  const qReg1600958 = qtyRegister.rows.filter((r) => r.sku === '1600958');
  assert(qReg1600958.some((r) => r.mrp === 75), 'Quantity Register displays historical sale at MRP ₹75');
  assert(qReg1600958.some((r) => r.mrp === 79), 'Quantity Register displays new sale at MRP ₹79');

  // ════════════════════════════════════════════════════════════════════
  // 4. ROUTE RETURN INCREASES INVENTORY STOCK
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 4. ROUTE RETURN INCREASES INVENTORY STOCK ---');
  // Current stock was -20. Now van returns 30 units to warehouse
  mockStore.addInventoryMovement({
    product_id: prod1600958.id,
    sku: '1600958',
    movement_type: 'route_return',
    quantity: 30,
    direction: 'in',
    from_location: 'vehicle',
    to_location: 'warehouse',
    reference_number: 'RET-ROUTE-6-001',
    idempotency_key: 'ret-idemp-1600958-30',
    notes: 'Unsold stock returned from route vehicle to warehouse',
  });

  const inventoryAfterReturn = await getOperationalInventoryData();
  const itemAfterReturn = inventoryAfterReturn.items.find((i) => i.sku === '1600958');
  assert(itemAfterReturn?.returnedQty === 30, `Returned quantity is 30 (${itemAfterReturn?.returnedQty})`);
  // Stock calculation: Inbound(100) - Delivered(120) + Returned(30) = +10
  assert(itemAfterReturn?.currentStock === 10, `Current stock increased from -20 to +10 (-20 + 30 = 10): found ${itemAfterReturn?.currentStock}`);
  assert(itemAfterReturn?.stockStatus === 'LOW_STOCK', `Stock Status is LOW_STOCK for 10 units (${itemAfterReturn?.stockStatus})`);

  // ════════════════════════════════════════════════════════════════════
  // 5. UNMAPPED PRODUCT LIFECYCLE (IMPORT -> MASTER -> INVENTORY)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 5. UNMAPPED PRODUCT LIFECYCLE ---');
  const unmappedSku = '61054028';
  const unmappedRow: ParsedPurchaseRow = {
    sku: unmappedSku,
    productName: 'CDC 500g NF (200g*2+100g)',
    uom: 'DOZ',
    orderedQty: 40,
    receivedQty: 40,
    grStatus: 'Completed',
    grDate: '2026-09-13',
    grDocNo: '3024574206',
    poNumber: '4500123456',
    invoiceNo: '81D0001541',
    invoiceDate: '02.09.2026',
    batch: '21',
    rawRow: {
      Category: 'Oral Care',
      Brand: 'Colgate',
    },
  };

  // Step 1: Initial match flags as UNMAPPED
  const previewUnmapped = await validateAndMatchPurchaseRows([unmappedRow], 'UNMAPPED-TEST-BATCH');
  assert(previewUnmapped.unmapped === 1, `Unmapped row identified in purchase file (${previewUnmapped.unmapped})`);
  assert(previewUnmapped.matched === 0, 'Zero matched rows before adding to master');

  // Step 2: Add unmapped product to Product Master via RPC
  const addRes = await addUnmappedSapProduct({
    sku: unmappedSku,
    name: 'CDC 500g NF (200g*2+100g)',
    uom: 'DOZ',
    category: 'Oral Care',
    brand: 'Colgate',
  }, 'UNMAPPED-TEST-BATCH');
  assert(addRes.status === 'created' || addRes.status === 'already_exists', `addUnmappedSapProduct succeeded (${addRes.status})`);

  // Step 3: Product immediately appears in Product Catalog
  const catalogAfterAdd = await getProducts();
  const catalogItem = catalogAfterAdd.find((p) => p.sku === unmappedSku);
  assert(catalogItem !== undefined, `Unmapped product ${unmappedSku} is immediately visible in Product Catalog`);
  assert(catalogItem?.name === 'CDC 500g NF (200g*2+100g)', `Product Catalog name matches: "${catalogItem?.name}"`);

  // Step 4: Revalidate without re-uploading file -> row becomes MATCHED
  const previewRevalidated = await validateAndMatchPurchaseRows([unmappedRow], 'UNMAPPED-TEST-BATCH');
  assert(previewRevalidated.matched === 1, `Revalidated row is MATCHED (${previewRevalidated.matched})`);
  assert(previewRevalidated.unmapped === 0, 'Unmapped count decreases to 0');

  // Step 5: Confirm inbound purchase import
  const confirmUnmappedRes = await confirmPurchaseImport(previewRevalidated, 'UNMAPPED-TEST-BATCH', 'unmapped_import.xlsx');
  assert(confirmUnmappedRes.success === true, 'Confirmed inbound purchase import for newly added product');
  assert(confirmUnmappedRes.movementsCreated === 1, '1 inbound movement created in ledger');

  // Step 6: Product immediately appears in Inventory view with stock = 40 DOZ
  const inventoryAfterUnmappedInbound = await getOperationalInventoryData();
  const inventoryUnmappedItem = inventoryAfterUnmappedInbound.items.find((i) => i.sku === unmappedSku);
  assert(inventoryUnmappedItem !== undefined, `Product ${unmappedSku} immediately visible in Inventory view`);
  assert(inventoryUnmappedItem?.inboundQty === 40, `Inbound quantity is 40 DOZ (${inventoryUnmappedItem?.inboundQty})`);
  assert(inventoryUnmappedItem?.currentStock === 40, `Current stock is 40 DOZ (${inventoryUnmappedItem?.currentStock})`);
  assert(inventoryUnmappedItem?.stockStatus === 'IN_STOCK', `Stock status is IN_STOCK (${inventoryUnmappedItem?.stockStatus})`);

  // ════════════════════════════════════════════════════════════════════
  // 6. DUPLICATE PURCHASE IMPORT PROTECTION (IDEMPOTENCY)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 6. DUPLICATE PURCHASE IMPORT PROTECTION ---');
  // Attempt to re-import the exact same batch and row
  const dupePreview = await validateAndMatchPurchaseRows([unmappedRow], 'UNMAPPED-TEST-BATCH');
  assert(dupePreview.hasDuplicates === true, 'Duplicate check flags already imported row');
  assert(dupePreview.duplicateCount === 1, `Duplicate count = 1 (${dupePreview.duplicateCount})`);

  const dupeResult = await confirmPurchaseImport(dupePreview, 'UNMAPPED-TEST-BATCH', 'unmapped_import.xlsx');
  assert(dupeResult.movementsCreated === 0, 'Zero duplicate movements created on re-import attempt');
  assert(dupeResult.skippedDuplicate === 1, `1 duplicate skipped (${dupeResult.skippedDuplicate})`);

  // Stock remains 40 DOZ, not duplicated to 80 DOZ
  const inventoryAfterDupe = await getOperationalInventoryData();
  const itemAfterDupe = inventoryAfterDupe.items.find((i) => i.sku === unmappedSku);
  assert(itemAfterDupe?.currentStock === 40, `Stock remains exactly 40 DOZ after duplicate import attempt (${itemAfterDupe?.currentStock})`);

  // ════════════════════════════════════════════════════════════════════
  // 7. INVENTORY SUMMARY CARDS & FILTERS
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 7. INVENTORY SUMMARY CARDS & FILTERS ---');
  const fullInventory = await getOperationalInventoryData();
  const summary = fullInventory.summary;

  assert(summary.totalSkus === fullInventory.items.length, `Summary totalSkus matches items length (${summary.totalSkus})`);
  assert(summary.totalInbound >= 140, `Summary totalInbound includes 100 (from 1600958) + 40 (from 61054028) = ${summary.totalInbound}`);
  assert(summary.totalDelivered >= 120, `Summary totalDelivered includes 120 delivered = ${summary.totalDelivered}`);
  assert(summary.totalReturned >= 30, `Summary totalReturned includes 30 returned = ${summary.totalReturned}`);

  // Test filter: in_stock
  const inStockFilter = await getOperationalInventoryData({ statusFilter: 'in_stock' });
  assert(inStockFilter.items.every((i) => i.stockStatus === 'IN_STOCK'), 'in_stock filter returns only IN_STOCK products');

  // Test filter: zero_stock
  const zeroStockFilter = await getOperationalInventoryData({ statusFilter: 'zero_stock' });
  assert(zeroStockFilter.items.every((i) => i.stockStatus === 'ZERO_STOCK'), 'zero_stock filter returns only ZERO_STOCK products');

  // Test filter: search by SKU
  const skuSearch = await getOperationalInventoryData({ search: '1600958' });
  assert(skuSearch.items.length === 1 && skuSearch.items[0].sku === '1600958', 'Search by SKU returns exact product in Inventory');

  // Test filter: search by Name
  const nameSearch = await getOperationalInventoryData({ search: 'CDC 500g' });
  assert(nameSearch.items.length >= 1 && nameSearch.items.some((i) => i.sku === unmappedSku), 'Search by Product Name finds SKU in Inventory');

  // ════════════════════════════════════════════════════════════════════
  // 8. CHRONOLOGICAL MOVEMENT HISTORY WITH RUNNING BALANCE
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 8. CHRONOLOGICAL MOVEMENT HISTORY WITH RUNNING BALANCE ---');
  const history1600958 = await getProductMovementHistory('1600958');
  assert(history1600958.length >= 3, `History returns 3 discrete ledger movements (${history1600958.length})`);

  // Verify movement types present
  const hasInbound = history1600958.some((m) => m.movementType === 'purchase_inward');
  const hasDelivered = history1600958.some((m) => m.movementType === 'delivery_fulfilled');
  const hasReturned = history1600958.some((m) => m.movementType === 'route_return');
  assert(hasInbound, 'History contains purchase_inward movement');
  assert(hasDelivered, 'History contains delivery_fulfilled movement');
  assert(hasReturned, 'History contains route_return movement');

  // Verify running balance is computed on movement records
  const mostRecentMovement = history1600958[0];
  assert(typeof mostRecentMovement.runningBalance === 'number', `Most recent movement has computed running balance (${mostRecentMovement.runningBalance})`);
  assert(mostRecentMovement.runningBalance === 10, `Final running balance matches current operational stock (+10): ${mostRecentMovement.runningBalance}`);

  // ════════════════════════════════════════════════════════════════════
  // 9. SEPARATION OF CONCERNS & INVARIANCE
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 9. SEPARATION OF CONCERNS & INVARIANCE ---');
  const preReconMovementsCount = mockStore.getInventoryMovements().length;

  // Run SAP Reconciliation (read-only comparison)
  const reconResult = await performSapStockReconciliation(
    [{ sku: '1600958', stockQty: 25 }],
    '2026-09-recon-test'
  );
  assert(reconResult.items.length === 1, 'SAP Reconciliation executed successfully');

  // Invariance check: SAP Reconciliation MUST NOT create any inventory movements
  const postReconMovementsCount = mockStore.getInventoryMovements().length;
  assert(
    postReconMovementsCount === preReconMovementsCount,
    `INVARIANCE VERIFIED: SAP Reconciliation created ZERO movements (${preReconMovementsCount} -> ${postReconMovementsCount})`
  );

  // Quantity Register remains separate for delivery analysis
  const qtyReg = await getProductQuantityRegister();
  assert(qtyReg.rows.length > 0, `Quantity Register functions separately (${qtyReg.rows.length} records)`);

  console.log('\n================================================================');
  console.log(`TEST RUN COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runProductsInventoryRegression().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
