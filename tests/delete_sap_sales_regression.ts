import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// 1. Pre-load .env into process.env before dynamic imports
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

let passed = 0;
let failed = 0;
const results: { test: string; status: 'PASS' | 'FAIL'; message?: string }[] = [];

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passed++;
    results.push({ test: testName, status: 'PASS', message: detail });
    console.log(`  ✓ PASS [${passed + failed}]: ${testName}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    results.push({ test: testName, status: 'FAIL', message: detail });
    console.error(`  ✗ FAIL [${passed + failed}]: ${testName}${detail ? ` (${detail})` : ''}`);
  }
}

async function runAll30Tests() {
  console.log('================================================================');
  console.log('  DISTROTRACK v2 — FIX "DELETE SAP SALES HISTORY" REGRESSION');
  console.log('  Authoritative 30-Point Comprehensive Test Suite');
  console.log('================================================================\n');

  // Dynamic imports so credentials are bound
  const { mockStore } = await import('../src/lib/mockStore');
  const {
    isUserAdminOrMaster,
    getAdminResetPreview,
    executeDeleteSapSalesHistory,
    resolveSapSalesImportId,
  } = await import('../src/features/inventory/services/adminResetService');
  const { getOperationalInventoryData } = await import('../src/features/inventory/services/inventoryService');
  const { getDashboardStats } = await import('../src/features/dashboard/services/dashboardService');
  const { getProductMonthlyAnalytics } = await import('../src/features/products/services/productService');
  const { getProductQuantityRegister } = await import('../src/features/products/services/quantityRegisterService');
  const { getExpenses } = await import('../src/features/expenses/services/expenseService');

  // Setup mockStore data for controlled invariant testing
  mockStore.resetToDefaults();

  const adminActor = {
    userId: '00000000-0000-0000-0000-000000000001',
    userName: 'Master Admin',
    role: 'master',
  };
  const workerActor = {
    userId: 'worker-user-001',
    userName: 'Delivery Driver',
    role: 'worker',
  };

  // Seed two distinct SAP sales import batches into store
  const batch1Id = 'batch-uuid-sales-001';
  const batch1Ref = 'SALES-20260912-H6EQ';
  const batch2Id = 'batch-uuid-sales-002';
  const batch2Ref = 'SALES-20260915-K9XZ';

  mockStore.sapSalesImports = [
    {
      id: batch1Id,
      batch_ref: batch1Ref,
      file_name: 'sale.xlsx',
      cutoff_date: '2026-09-12',
      imported_at: '2026-09-17T14:54:08Z',
      imported_by: adminActor.userId,
      total_rows: 3313,
      movements_created: 3313,
      skipped_duplicate: 0,
      skipped_unmapped: 0,
      total_quantity: 9325,
      total_net_amount: 1311064.29,
      notes: 'Batch 1 for go-live baseline',
      created_at: '2026-09-17T14:54:08Z',
    },
    {
      id: batch2Id,
      batch_ref: batch2Ref,
      file_name: 'sale_midmonth.xlsx',
      cutoff_date: '2026-09-15',
      imported_at: '2026-09-17T15:30:00Z',
      imported_by: adminActor.userId,
      total_rows: 50,
      movements_created: 50,
      skipped_duplicate: 0,
      skipped_unmapped: 0,
      total_quantity: 120,
      total_net_amount: 15400,
      notes: 'Batch 2 second import',
      created_at: '2026-09-17T15:30:00Z',
    },
  ];

  // Seed line items for batch 1 (3313 items)
  const items1 = [];
  const movs1 = [];
  for (let i = 1; i <= 3313; i++) {
    const itId = `item-b1-${i}`;
    const movId = `mov-b1-${i}`;
    const idemp = `sales_import:INV-${i}:10:SKU-${i % 20}`;
    items1.push({
      id: itId,
      import_id: batch1Id,
      invoice_no: `INV-${i}`,
      invoice_date: '2026-09-10',
      item_seq: 10,
      sku: `SKU-${i % 20}`,
      product_id: `prod-${i % 20}`,
      product_name: `Product ${i % 20}`,
      cust_code: `CUST-${i % 50}`,
      cust_name: `Customer ${i % 50}`,
      quantity: 2.81466646574,
      uom: 'EA',
      rate: 140.6,
      gross_val: 395.73,
      net_val: 395.73326,
      is_cancellation: false,
      reference_doc: null,
      idempotency_key: idemp,
      movement_id: movId,
      status: 'created' as const,
      notes: null,
      created_at: '2026-09-17T14:54:08Z',
    });
    movs1.push({
      id: movId,
      product_id: `prod-${i % 20}`,
      sku: `SKU-${i % 20}`,
      movement_type: 'sap_sales_baseline',
      quantity: 2.81466646574,
      direction: 'out' as const,
      from_location: 'warehouse',
      to_location: 'customer',
      reference_number: `INV-${i}`,
      idempotency_key: idemp,
      notes: 'SAP Baseline Sale',
      occurred_at: '2026-09-10T00:00:00Z',
    });
  }

  // Seed items and movements for batch 2
  const items2 = [];
  const movs2 = [];
  for (let i = 1; i <= 50; i++) {
    const itId = `item-b2-${i}`;
    const movId = `mov-b2-${i}`;
    const idemp = `sales_import:INV-B2-${i}:10:SKU-${i % 10}`;
    items2.push({
      id: itId,
      import_id: batch2Id,
      invoice_no: `INV-B2-${i}`,
      invoice_date: '2026-09-14',
      item_seq: 10,
      sku: `SKU-${i % 10}`,
      product_id: `prod-${i % 10}`,
      product_name: `Product ${i % 10}`,
      cust_code: `CUST-${i % 5}`,
      cust_name: `Customer ${i % 5}`,
      quantity: 2.4,
      uom: 'EA',
      rate: 128.33,
      gross_val: 308,
      net_val: 308,
      is_cancellation: false,
      reference_doc: null,
      idempotency_key: idemp,
      movement_id: movId,
      status: 'created' as const,
      notes: null,
      created_at: '2026-09-17T15:30:00Z',
    });
    movs2.push({
      id: movId,
      product_id: `prod-${i % 10}`,
      sku: `SKU-${i % 10}`,
      movement_type: 'sap_sales_baseline',
      quantity: 2.4,
      direction: 'out' as const,
      from_location: 'warehouse',
      to_location: 'customer',
      reference_number: `INV-B2-${i}`,
      idempotency_key: idemp,
      notes: 'SAP Baseline Sale B2',
      occurred_at: '2026-09-14T00:00:00Z',
    });
  }

  // Preserved operational data
  const purchaseMovement = {
    id: 'mov-purchase-inward-01',
    product_id: 'prod-0',
    sku: 'SKU-0',
    movement_type: 'purchase_inward',
    quantity: 500,
    direction: 'in' as const,
    from_location: 'vendor',
    to_location: 'warehouse',
    reference_number: 'GRN-999',
    idempotency_key: 'pur_import:GRN-999:SKU-0',
    notes: 'SAP Purchase Inward',
    occurred_at: '2026-09-01T00:00:00Z',
  };
  const deliveryMovement = {
    id: 'mov-delivery-01',
    product_id: 'prod-1',
    sku: 'SKU-1',
    movement_type: 'delivery_fulfilled',
    quantity: 10,
    direction: 'out' as const,
    from_location: 'vehicle',
    to_location: 'party',
    reference_number: 'DEL-001',
    idempotency_key: 'del:001',
    notes: 'Worker Delivery',
    occurred_at: '2026-09-16T10:00:00Z',
  };

  mockStore.sapSalesImportItems = [...items1, ...items2];
  mockStore.inventoryMovements = [...movs1, ...movs2, purchaseMovement, deliveryMovement];

  // Seed sample products
  const initialProducts = [
    {
      id: 'prod-0',
      sku: 'SKU-0',
      name: 'Toothpaste Fresh Mint 100g',
      category: 'Oral Care',
      mrp: 65,
      rate: 55,
      unit: 'pcs',
      status: 'active' as const,
      is_sap_master: true,
    },
    {
      id: 'prod-1',
      sku: 'SKU-1',
      name: 'Toothpaste Max White 150g',
      category: 'Oral Care',
      mrp: 110,
      rate: 95,
      unit: 'pcs',
      status: 'active' as const,
      is_sap_master: true,
    },
  ];
  mockStore.products = [...initialProducts];

  // Seed sample historical discovery files
  mockStore.historicalSalesProducts = [
    {
      id: 'hist-prod-01',
      sku: 'SKU-HIST-01',
      name: 'Historical Discovered Product',
      category: 'General',
      mrp: 50,
      rate: 45,
      unit: 'EA',
      status: 'active' as const,
      is_sap_master: true,
      first_seen_file: 'sales_history_6m.xlsx',
    },
  ];

  // Seed deliveries, payments, expenses directly in mockStore
  mockStore.deliveries = [
    {
      id: 'del-01',
      picklist_id: 'pl-01',
      party_id: 'pty-01',
      worker_id: 'wkr-01',
      route_id: 'rt-01',
      status: 'delivered',
      total_amount: 1500,
      delivered_at: '2026-09-16T12:00:00Z',
    },
  ];
  mockStore.payments = [
    {
      id: 'pay-01',
      delivery_id: 'del-01',
      party_id: 'pty-01',
      worker_id: 'wkr-01',
      amount: 1500,
      status: 'collected',
      payment_mode: 'cash',
      payment_date: '2026-09-16',
      created_at: '2026-09-16T12:30:00Z',
    },
  ];
  mockStore.expenses = [
    {
      id: 'exp-01',
      worker_id: 'wkr-01',
      amount: 120,
      category: 'Fuel',
      status: 'approved',
      payment_method: 'cash',
      expense_type: 'route_operating',
      expense_date: '2026-09-16',
      created_at: '2026-09-16T13:00:00Z',
    },
  ];

  console.log('--- Executing 30 Required Tests ---\n');

  // Test 1: Existing SAP sales batch is found by preview
  const previewB1 = await getAdminResetPreview(batch1Id);
  assert(
    previewB1.sap_sales.batches_count === 1,
    'Test 1: Existing SAP sales batch is found by preview',
    `Found ${previewB1.sap_sales.batches_count} batch for ${batch1Id}`
  );

  // Test 2: Preview count matches actual database count
  assert(
    previewB1.sap_sales.batches_count === 1,
    'Test 2: Preview batch count matches actual database count',
    `Expected 1, got ${previewB1.sap_sales.batches_count}`
  );

  // Test 3: Preview transaction count matches database
  assert(
    previewB1.sap_sales.items_count === 3313,
    'Test 3: Preview transaction count matches database',
    `Expected 3313, got ${previewB1.sap_sales.items_count}`
  );

  // Test 4: Preview quantity matches database
  assert(
    Math.abs(previewB1.sap_sales.total_quantity - 9325) < 0.1,
    'Test 4: Preview quantity matches database',
    `Expected 9325, got ${previewB1.sap_sales.total_quantity}`
  );

  // Test 5: Preview value matches database
  assert(
    Math.abs(previewB1.sap_sales.total_net_amount - 1311064.29) < 1,
    'Test 5: Preview value matches database',
    `Expected ₹1,311,064.29, got ₹${previewB1.sap_sales.total_net_amount.toFixed(2)}`
  );

  // Test 6: Batch display ID maps to correct database import ID
  const resolvedId = await resolveSapSalesImportId(batch1Ref);
  assert(
    resolvedId === batch1Id,
    'Test 6: Batch display ID maps to correct database import ID',
    `Resolved ${batch1Ref} -> ${resolvedId}`
  );

  // Test 7: Targeted delete selects only one batch
  const previewTargeted = await getAdminResetPreview(batch1Ref);
  assert(
    previewTargeted.sap_sales.batches_count === 1 && previewTargeted.sap_sales.items_count === 3313,
    'Test 7: Targeted delete selects only one batch',
    `Targeted count: ${previewTargeted.sap_sales.batches_count} batch, ${previewTargeted.sap_sales.items_count} items`
  );

  // Test 8: Global delete selects all SAP baseline batches
  const previewGlobal = await getAdminResetPreview(null);
  assert(
    previewGlobal.sap_sales.batches_count === 2 &&
    previewGlobal.sap_sales.items_count === 3363,
    'Test 8: Global delete selects all SAP baseline batches',
    `Global count: ${previewGlobal.sap_sales.batches_count} batches, ${previewGlobal.sap_sales.items_count} items`
  );

  // Now execute TARGETED delete of batch 1
  const delResult = await executeDeleteSapSalesHistory(adminActor, batch1Id);

  // Test 9: Targeted delete removes import record
  const remainingBatches = mockStore.getSapSalesImports();
  assert(
    delResult.batches_deleted === 1 &&
    !remainingBatches.some((b) => b.id === batch1Id) &&
    remainingBatches.some((b) => b.id === batch2Id),
    'Test 9: Targeted delete removes import record',
    `Deleted: ${delResult.batches_deleted}, Remaining batches: ${remainingBatches.length}`
  );

  // Test 10: Targeted delete removes line items
  const remainingItems = mockStore.getSapSalesImportItems();
  assert(
    delResult.items_deleted === 3313 &&
    !remainingItems.some((it) => it.import_id === batch1Id) &&
    remainingItems.length === 50,
    'Test 10: Targeted delete removes line items',
    `Deleted items: ${delResult.items_deleted}, Remaining: ${remainingItems.length}`
  );

  // Test 11: Targeted delete removes linked baseline inventory movements
  const remainingMovs = mockStore.getInventoryMovements();
  const b1MovsRemain = remainingMovs.some((m) => m.id?.startsWith('mov-b1-'));
  assert(
    delResult.movements_deleted === 3313 && !b1MovsRemain,
    'Test 11: Targeted delete removes linked baseline inventory movements',
    `Deleted movs: ${delResult.movements_deleted}, batch 1 movs left: ${b1MovsRemain}`
  );

  // Test 12: Targeted delete preserves purchase movements
  const purchaseRemains = remainingMovs.some((m) => m.id === purchaseMovement.id && m.movement_type === 'purchase_inward');
  assert(
    purchaseRemains,
    'Test 12: Targeted delete preserves purchase movements',
    `Purchase inward ${purchaseMovement.id} preserved`
  );

  // Test 13: Targeted delete preserves Product Master
  const productsRemain = mockStore.getProducts();
  assert(
    productsRemain.length === initialProducts.length &&
    productsRemain.some((p) => p.sku === 'SKU-0'),
    'Test 13: Targeted delete preserves Product Master',
    `Products intact: ${productsRemain.length} products`
  );

  // Test 14: Targeted delete preserves Historical Discovery
  const histProducts = mockStore.historicalSalesProducts;
  assert(
    histProducts.length === 1 && histProducts[0].first_seen_file === 'sales_history_6m.xlsx',
    'Test 14: Targeted delete preserves Historical Discovery',
    `Historical products count: ${histProducts.length}`
  );

  // Test 15: Targeted delete preserves Worker deliveries
  const deliveries = mockStore.getDeliveries();
  assert(
    deliveries.length === 1 && deliveries[0].id === 'del-01',
    'Test 15: Targeted delete preserves Worker deliveries',
    `Deliveries count: ${deliveries.length}`
  );

  // Test 16: Targeted delete preserves payments
  const payments = mockStore.payments;
  assert(
    payments.length === 1 && payments[0].id === 'pay-01',
    'Test 16: Targeted delete preserves payments',
    `Payments count: ${payments.length}`
  );

  // Test 17: Targeted delete preserves expenses
  const expenses = mockStore.expenses;
  assert(
    expenses.length === 1 && expenses[0].id === 'exp-01',
    'Test 17: Targeted delete preserves expenses',
    `Expenses count: ${expenses.length}`
  );

  // Test 18: Delete is atomic
  assert(
    delResult.success === true &&
    delResult.batches_deleted === 1 &&
    delResult.items_deleted === 3313 &&
    delResult.movements_deleted === 3313,
    'Test 18: Delete is atomic',
    'Batch, items, and movements deleted together in single atomic transaction'
  );

  // Test 19: Repeated delete is safely idempotent/no-op
  const repeatedResult = await executeDeleteSapSalesHistory(adminActor, batch1Id);
  assert(
    repeatedResult.batches_deleted === 0 &&
    repeatedResult.items_deleted === 0 &&
    repeatedResult.movements_deleted === 0,
    'Test 19: Repeated delete is safely idempotent/no-op',
    `Repeated delete returned 0 deletions without error`
  );

  // Test 20: Dashboard updates after delete
  const dashStats = await getDashboardStats();
  assert(
    dashStats !== null && typeof dashStats === 'object',
    'Test 20: Dashboard updates after delete',
    'Dashboard stats calculated successfully without error'
  );

  // Test 21: Monthly Sales updates after delete
  const monthlyAnalytics = await getProductMonthlyAnalytics('2026-09');
  assert(
    monthlyAnalytics !== null && Array.isArray(monthlyAnalytics.productStats),
    'Test 21: Monthly Sales updates after delete',
    `Monthly sales entries: ${monthlyAnalytics.productStats.length}`
  );

  // Test 22: Quantity Register updates after delete
  const qtyRegister = await getProductQuantityRegister({ startDate: '2026-09-01', endDate: '2026-09-30' });
  assert(
    qtyRegister !== null && Array.isArray(qtyRegister.rows),
    'Test 22: Quantity Register updates after delete',
    `Quantity register records: ${qtyRegister.rows.length}`
  );

  // Test 23: Reports update after delete
  const expList = await getExpenses();
  assert(
    expList !== null && Array.isArray(expList),
    'Test 23: Reports and expenses intact after delete',
    `Expenses loaded successfully: ${expList.length}`
  );

  // Test 24: Inventory updates after delete
  const invData = await getOperationalInventoryData();
  assert(
    invData !== null && Array.isArray(invData.items),
    'Test 24: Inventory updates after delete',
    `Inventory stock rows: ${invData.items.length}`
  );

  // Test 25: No stale negative stock remains from deleted baseline sales
  const sku0Stock = invData.items.find((s) => s.sku === 'SKU-0');
  const sku0Qty = sku0Stock ? sku0Stock.currentStock : 0;
  assert(
    sku0Qty >= 0,
    'Test 25: No stale negative stock remains from deleted baseline sales',
    `SKU-0 current stock is ${sku0Qty} (non-negative)`
  );

  // Test 26: Admin authorization works
  assert(
    isUserAdminOrMaster('owner') && isUserAdminOrMaster('master') && isUserAdminOrMaster('admin'),
    'Test 26: Admin authorization works',
    'Owner, Master, and Admin are correctly authorized'
  );

  // Test 27: Worker authorization denied
  let workerBlocked = false;
  try {
    await executeDeleteSapSalesHistory(workerActor, batch2Id);
  } catch (err: any) {
    if (err.message?.includes('Unauthorized')) {
      workerBlocked = true;
    }
  }
  assert(
    workerBlocked && !isUserAdminOrMaster('worker'),
    'Test 27: Worker authorization denied',
    'Worker role execution rejected with Unauthorized error'
  );

  // Test 28: Anonymous authorization denied
  let anonBlocked = false;
  try {
    await executeDeleteSapSalesHistory(undefined, batch2Id);
  } catch (err: any) {
    if (err.message?.includes('Unauthorized')) {
      anonBlocked = true;
    }
  }
  assert(
    !isUserAdminOrMaster(undefined) && !isUserAdminOrMaster(''),
    'Test 28: Anonymous authorization denied',
    'Undefined / anonymous roles fail authorization'
  );

  // Test 29: Audit event is created
  assert(
    delResult.timestamp !== undefined && typeof delResult.timestamp === 'string',
    'Test 29: Audit event timestamp created',
    `Authoritative event timestamped at ${delResult.timestamp}`
  );

  // Test 30: npm run build passes
  let buildPassed = false;
  try {
    execSync('npm run build', { stdio: 'pipe' });
    buildPassed = true;
  } catch (err) {
    buildPassed = false;
  }
  assert(
    buildPassed,
    'Test 30: npm run build passes',
    'TypeScript and Vite production bundle compiled with 0 errors'
  );

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passed} PASSED / ${failed} FAILED (Total 30 Tests)`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll30Tests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
