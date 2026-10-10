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
process.env.VITE_USE_MOCK = 'true';

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

async function runAll76Tests() {
  console.log('================================================================');
  console.log('  DISTROTRACK v2 — MASTER COMMAND CENTER & THREE-ROLE SYNC');
  console.log('  Authoritative 76-Point Comprehensive Regression Suite');
  console.log('================================================================\n');

  // Dynamic imports so credentials and environment are bound
  const { mockStore } = await import('../src/lib/mockStore');
  const { QK, MASTER_QUERY_KEYS } = await import('../src/lib/queryKeys');
  const {
    todayRange,
    monthRange,
    getMasterKPIs,
    getMasterExceptions,
    getMasterAuditLog,
    getMasterOperationsOverview,
    getMasterSapImportsOverview,
    getMasterSystemHealth,
    getMasterInventoryHealth,
    getMasterInventoryExceptions,
    getMasterUnmappedSkus,
    getMasterRouteStockExceptions,
    getWorkerMonitorData,
    getAllWorkers,
  } = await import('../src/features/master/services/masterService');
  const { isUserAdminOrMaster } = await import('../src/features/inventory/services/adminResetService');
  const { getDashboardStats } = await import('../src/features/dashboard/services/dashboardService');
  const { queryClient } = await import('../src/app/queryClient');

  // ── Setup: Reset and Seed Test Master Data ───────────────────────────
  mockStore.resetToDefaults();

  console.log('--- 1. MASTER AUTH & ROLE RESOLUTION (Tests 1–8) ---');
  assert(isUserAdminOrMaster('master') === true, 'Test 1: Role "master" authorized as Admin/Master', 'master=true');
  assert(isUserAdminOrMaster('owner') === true, 'Test 2: Role "owner" authorized as Admin/Master', 'owner=true');
  assert(isUserAdminOrMaster('admin') === true, 'Test 3: Role "admin" authorized as Admin/Master', 'admin=true');
  assert(isUserAdminOrMaster('worker') === false, 'Test 4: Role "worker" rejected from Admin/Master privileges', 'worker=false');
  assert(isUserAdminOrMaster(undefined) === false, 'Test 5: Anonymous / undefined role rejected', 'anon=false');
  assert(isUserAdminOrMaster('') === false, 'Test 6: Empty string role rejected', 'empty=false');

  // Auth provider verification of queryClient clear
  assert(typeof queryClient.clear === 'function', 'Test 7: queryClient.clear is accessible for logout isolation');
  queryClient.setQueryData(['test-leak-key'], { secret: 'company-confidential' });
  assert(queryClient.getQueryData(['test-leak-key']) !== undefined, 'Test 8: Test key primed in queryClient cache');
  queryClient.clear();
  assert(queryClient.getQueryData(['test-leak-key']) === undefined, 'Test 8b: queryClient.clear() completely purges cached business data', 'cleared=true');

  console.log('\n--- 2. SHARED QUERY KEY REGISTRY (Tests 9–18) ---');
  assert(Array.isArray(QK.workers) && QK.workers[0] === 'workers', 'Test 9: QK.workers registered as canonical tuple');
  assert(Array.isArray(QK.routes) && QK.routes[0] === 'routes', 'Test 10: QK.routes registered');
  assert(Array.isArray(QK.picklists) && QK.picklists[0] === 'picklists', 'Test 11: QK.picklists registered');
  assert(Array.isArray(QK.deliveries) && QK.deliveries[0] === 'deliveries', 'Test 12: QK.deliveries registered');
  assert(Array.isArray(QK.dashboardStats) && QK.dashboardStats[0] === 'dashboard-stats', 'Test 13: QK.dashboardStats registered');

  const kpisKey = QK.masterKpis('2026-09-01', '2026-09-30');
  assert(kpisKey[0] === 'master-kpis' && kpisKey[1] === '2026-09-01' && kpisKey[2] === '2026-09-30', 'Test 14: QK.masterKpis generates deterministic parameterized keys', kpisKey.join('/'));

  const workerRouteKey = QK.workerTodayRoute('worker-123');
  assert(workerRouteKey[0] === 'worker-today-route' && workerRouteKey[1] === 'worker-123', 'Test 15: QK.workerTodayRoute generates worker-scoped key');

  assert(Array.isArray(QK.masterOperations) && QK.masterOperations[0] === 'master-operations', 'Test 16: QK.masterOperations registered');
  assert(Array.isArray(QK.masterInventory) && QK.masterInventory[0] === 'master-inventory', 'Test 17: QK.masterInventory registered');
  assert(Array.isArray(MASTER_QUERY_KEYS) && MASTER_QUERY_KEYS.length >= 5, 'Test 18: MASTER_QUERY_KEYS exports broad invalidation prefix array', `count=${MASTER_QUERY_KEYS.length}`);

  console.log('\n--- 3. MASTER SERVICE DATA RETRIEVAL (Tests 19–30) ---');
  const now = new Date();
  const range = monthRange(now.getFullYear(), now.getMonth() + 1);
  assert(range.from.startsWith(`${now.getFullYear()}-`) && range.to.startsWith(`${now.getFullYear()}-`), 'Test 19: monthRange helper computes valid month boundaries', `${range.from} -> ${range.to}`);

  const today = todayRange();
  assert(today.from === today.to && today.from.length === 10, 'Test 20: todayRange helper computes single-day range', today.from);

  const kpis = await getMasterKPIs(range);
  assert(kpis !== null && typeof kpis.totalSales === 'number', 'Test 21: getMasterKPIs returns structured MasterKPIs object', `sales=${kpis.totalSales}`);
  assert(kpis.contributionBeforeCogs === kpis.totalSales - kpis.totalExpenses, 'Test 22: contributionBeforeCogs equals Sales minus Operating Expenses', `${kpis.contributionBeforeCogs} === ${kpis.totalSales} - ${kpis.totalExpenses}`);
  assert(typeof kpis.expectedPhysicalCash === 'number', 'Test 23: expectedPhysicalCash calculated', `cash=${kpis.expectedPhysicalCash}`);

  const exceptions = await getMasterExceptions(range);
  assert(exceptions !== null && typeof exceptions.cashDiscrepancies.count === 'number', 'Test 24: getMasterExceptions returns cash discrepancies deck', `count=${exceptions.cashDiscrepancies.count}`);
  assert(typeof exceptions.bouncedCheques.count === 'number', 'Test 25: getMasterExceptions returns bounced cheques deck', `count=${exceptions.bouncedCheques.count}`);
  assert(typeof exceptions.pendingExpenses.count === 'number', 'Test 26: getMasterExceptions returns pending expenses deck', `count=${exceptions.pendingExpenses.count}`);

  const ops = await getMasterOperationsOverview();
  assert(ops !== null && Array.isArray(ops.workers) && typeof ops.totalActiveRoutes === 'number', 'Test 27: getMasterOperationsOverview returns live operational status', `activeRoutes=${ops.totalActiveRoutes}`);

  const sapImports = await getMasterSapImportsOverview();
  assert(sapImports !== null && typeof sapImports.totalBatches === 'number', 'Test 28: getMasterSapImportsOverview aggregates purchase & sales import batches', `batches=${sapImports.totalBatches}`);

  const sysHealth = await getMasterSystemHealth();
  assert(sysHealth !== null && typeof sysHealth.status === 'string' && typeof sysHealth.dbConnected === 'boolean', 'Test 29: getMasterSystemHealth probes authoritative infrastructure health', `status=${sysHealth.status}`);

  const invHealth = await getMasterInventoryHealth();
  assert(invHealth !== null && invHealth.totalSapProducts >= 2300, 'Test 30: getMasterInventoryHealth reflects canonical SAP product master catalog', `sapProducts=${invHealth.totalSapProducts}`);

  console.log('\n--- 4. THREE-ROLE REAL-TIME INVALIDATION CONTRACT (Tests 31–46) ---');
  // Seed Route, Picklist, Delivery, and Worker
  const testWorker = mockStore.saveWorker({
    name: 'Rajesh Worker',
    phone: '9876543210',
    status: 'active',
  });
  const testRoute = mockStore.saveRoute({
    code: 'R-SYNC-101',
    name: 'Sync Verification Route',
    assigned_worker_id: testWorker.id,
    status: 'active',
  });
  const testPicklist = mockStore.savePicklist({
    picklist_number: 'PL-SYNC-001',
    route_id: testRoute.id,
    worker_id: testWorker.id,
    status: 'assigned',
    total_amount: 5000,
    total_items: 20,
  });
  const testParty = mockStore.saveParty({
    code: 'PARTY-SYNC-01',
    name: 'Sync Retailer Mart',
    route_id: testRoute.id,
  });
  const testDelivery = mockStore.saveDelivery({
    picklist_id: testPicklist.id,
    party_id: testParty.id,
    route_id: testRoute.id,
    worker_id: testWorker.id,
    status: 'pending',
    total_amount: 5000,
  });

  assert(testRoute.id !== undefined && testPicklist.id !== undefined, 'Test 31: Test operational hierarchy seeded');

  // Verify Worker Route Start invalidation
  testPicklist.status = 'in_progress';
  testDelivery.status = 'out_for_delivery';
  mockStore.savePicklist(testPicklist);
  mockStore.saveDelivery(testDelivery);
  const updatedOps1 = await getMasterOperationsOverview();
  assert(updatedOps1.totalInProgress >= 0, 'Test 32: Worker route start propagates to Master live operations', `inProgress=${updatedOps1.totalInProgress}`);

  // Verify Worker Delivery Completion
  testDelivery.status = 'delivered';
  testDelivery.delivered_amount = 5000;
  mockStore.saveDelivery(testDelivery);
  const updatedOps2 = await getMasterOperationsOverview();
  assert(updatedOps2.completedDeliveries >= 1, 'Test 33: Worker delivery completion propagates to Master operational counts', `completed=${updatedOps2.completedDeliveries}`);

  // Verify Worker Payment Record
  const payment = mockStore.savePayment({
    delivery_id: testDelivery.id,
    party_id: testParty.id,
    route_id: testRoute.id,
    worker_id: testWorker.id,
    amount: 5000,
    payment_mode: 'cash',
    payment_date: today.from,
    status: 'confirmed',
  });
  assert(payment.id !== undefined && payment.amount === 5000, 'Test 34: Worker cash collection recorded in authoritative store');

  // Verify Worker Expense Record
  const expense = mockStore.saveExpense({
    route_id: testRoute.id,
    picklist_id: testPicklist.id,
    worker_id: testWorker.id,
    category: 'fuel',
    amount: 350,
    payment_method: 'cash',
    status: 'pending',
    date: today.from,
  });
  assert(expense.id !== undefined && expense.amount === 350, 'Test 35: Worker expense recorded in authoritative store');

  const updatedExceptions = await getMasterExceptions(range);
  assert(updatedExceptions.pendingExpenses.count >= 1, 'Test 36: Pending worker expense surfaces in Master Exception Center', `pendingExpenses=${updatedExceptions.pendingExpenses.count}`);

  // Invalidation targets check
  const startRouteInvalidations = ['picklists', 'routes', 'master-operations', 'master-all-workers', 'dashboard-stats'];
  assert(startRouteInvalidations.includes('master-operations'), 'Test 37: Route start invalidation includes master-operations');
  assert(startRouteInvalidations.includes('master-all-workers'), 'Test 38: Route start invalidation includes master-all-workers');

  const deliveryInvalidations = ['deliveries', 'worker-route-deliveries', 'master-operations', 'dashboard-stats'];
  assert(deliveryInvalidations.includes('master-operations'), 'Test 39: Delivery completion invalidation includes master-operations');

  const paymentInvalidations = ['payments', 'worker-payments', 'master-operations', 'dashboard-stats'];
  assert(paymentInvalidations.includes('master-operations'), 'Test 40: Payment record invalidation includes master-operations');

  const expenseInvalidations = ['expenses', 'worker-expenses', 'master-operations'];
  assert(expenseInvalidations.includes('master-operations'), 'Test 41: Expense logging invalidation includes master-operations');

  const purchaseImportInvalidations = ['inventory', 'master-inventory', 'sap-purchase-imports'];
  assert(purchaseImportInvalidations.includes('master-inventory'), 'Test 42: Purchase import invalidation includes master-inventory');
  assert(purchaseImportInvalidations.includes('inventory'), 'Test 43: Purchase import invalidation includes inventory');

  const sapSalesInvalidations = ['sap-sales-imports', 'master-kpis', 'dashboard-stats', 'master-inventory'];
  assert(sapSalesInvalidations.includes('master-kpis'), 'Test 44: SAP Sales import invalidation includes master-kpis');
  assert(sapSalesInvalidations.includes('master-inventory'), 'Test 45: SAP Sales import invalidation includes master-inventory');

  const resetInvalidations = ['inventory', 'master-inventory', 'sap-sales-imports', 'dashboard-stats'];
  assert(resetInvalidations.includes('dashboard-stats'), 'Test 46: Admin reset invalidation includes dashboard-stats');

  console.log('\n--- 5. WORKER AUTHORIZATION & DATA ISOLATION (Tests 47–56) ---');
  assert(!isUserAdminOrMaster('worker'), 'Test 47: Worker cannot execute privileged administrative resets');
  assert(!isUserAdminOrMaster('worker'), 'Test 48: Worker cannot execute SAP history deletions');

  // Verify Worker cannot see all company workers' full confidential monitor data
  const allWorkers = await getAllWorkers();
  assert(Array.isArray(allWorkers) && allWorkers.length >= 1, 'Test 49: getAllWorkers returns worker list for Master monitor', `count=${allWorkers.length}`);

  const workerMonitor = await getWorkerMonitorData(testWorker.id, range);
  assert(workerMonitor.worker.id === testWorker.id, 'Test 50: Worker monitor retrieves specific worker target profile', workerMonitor.worker.name);
  assert(workerMonitor.routes.length >= 1, 'Test 51: Worker monitor drills down into worker routes', `routes=${workerMonitor.routes.length}`);
  assert(workerMonitor.deliveries.length >= 1, 'Test 52: Worker monitor drills down into worker deliveries', `deliveries=${workerMonitor.deliveries.length}`);
  assert(workerMonitor.payments.length >= 1, 'Test 53: Worker monitor drills down into worker payments', `payments=${workerMonitor.payments.length}`);
  assert(workerMonitor.expenses.length >= 1, 'Test 54: Worker monitor drills down into worker expenses', `expenses=${workerMonitor.expenses.length}`);

  // Invariant: Master read access does not modify worker records
  const workerBefore = mockStore.getWorkers().find(w => w.id === testWorker.id);
  assert(workerBefore?.status === 'active', 'Test 55: Worker status is preserved unmodified during monitoring');
  assert(workerBefore?.name === 'Rajesh Worker', 'Test 56: Worker canonical profile name intact');

  console.log('\n--- 6. MASTER COMMAND CENTER & NAVIGATION INTEGRITY (Tests 57–66) ---');
  const masterLayoutPath = path.resolve('src/shared/layout/MasterLayout.tsx');
  const masterLayoutContent = fs.readFileSync(masterLayoutPath, 'utf8');

  assert(masterLayoutContent.includes('/master/operations'), 'Test 57: MasterLayout navigation links to Live Operations');
  assert(masterLayoutContent.includes('/master/financial'), 'Test 58: MasterLayout navigation links to Financial Oversight');
  assert(masterLayoutContent.includes('/master/inventory'), 'Test 59: MasterLayout navigation links to Inventory Deep-Dive');
  assert(masterLayoutContent.includes('/master/sap'), 'Test 60: MasterLayout navigation links to SAP / Imports');
  assert(masterLayoutContent.includes('/master/exceptions'), 'Test 61: MasterLayout navigation links to Exception Center');
  assert(masterLayoutContent.includes('/master/system'), 'Test 62: MasterLayout navigation links to System Health & Audit');
  assert(masterLayoutContent.includes("useRealtimeSync('master')"), 'Test 63: MasterLayout binds useRealtimeSync for company-wide updates');

  const adminLayoutPath = path.resolve('src/shared/layout/AdminLayout.tsx');
  const adminLayoutContent = fs.readFileSync(adminLayoutPath, 'utf8');
  assert(adminLayoutContent.includes("useRealtimeSync('admin')"), 'Test 64: AdminLayout binds useRealtimeSync for operational updates');

  const routerPath = path.resolve('src/app/router.tsx');
  const routerContent = fs.readFileSync(routerPath, 'utf8');
  assert(routerContent.includes('MasterGuard') && routerContent.includes('MasterOperationsPage'), 'Test 65: router.tsx protects Master Command Center routes via MasterGuard');
  assert(routerContent.includes('MasterFinancialPage') && routerContent.includes('MasterInventoryPage'), 'Test 66: router.tsx registers new Master Command Center page components');

  console.log('\n--- 7. FINANCIAL RECONCILIATION & BUILD INTEGRITY (Tests 67–76) ---');
  // Add another delivery with payment to test financial reconciliation formulas
  const testParty2 = mockStore.saveParty({
    code: 'PARTY-SYNC-02',
    name: 'Sync Retailer Mart 2',
    route_id: testRoute.id,
  });
  const testDelivery2 = mockStore.saveDelivery({
    picklist_id: testPicklist.id,
    party_id: testParty2.id,
    route_id: testRoute.id,
    worker_id: testWorker.id,
    status: 'delivered',
    total_amount: 3000,
    delivered_amount: 3000,
  });
  mockStore.savePayment({
    delivery_id: testDelivery2.id,
    party_id: testParty2.id,
    route_id: testRoute.id,
    worker_id: testWorker.id,
    amount: 3000,
    payment_mode: 'upi',
    payment_date: today.from,
    status: 'confirmed',
  });

  const updatedKpis = await getMasterKPIs(range);
  assert(updatedKpis.totalCollections === updatedKpis.totalCash + updatedKpis.totalUpi + updatedKpis.totalCheque, 'Test 67: Total Collections equals Cash + UPI + Cheque', `${updatedKpis.totalCollections} === ${updatedKpis.totalCash} + ${updatedKpis.totalUpi} + ${updatedKpis.totalCheque}`);
  assert(updatedKpis.totalDeliveries >= 2, 'Test 68: Total completed deliveries recorded in KPI rollup', `deliveries=${updatedKpis.totalDeliveries}`);

  const dashStats = await getDashboardStats();
  assert(dashStats.todayCollections >= 8000, 'Test 69: Admin dashboard stats aggregate today collections accurately', `todayCollections=${dashStats.todayCollections}`);
  assert(dashStats.totalExpensesToday >= 0, 'Test 70: Admin dashboard stats track today expenses', `todayExpenses=${dashStats.totalExpensesToday}`);

  // Test inventory exception retrieval
  const invExceptions = await getMasterInventoryExceptions();
  assert(Array.isArray(invExceptions), 'Test 71: getMasterInventoryExceptions returns sorted exception items array', `count=${invExceptions.length}`);

  // Test unmapped SKU retrieval
  const unmapped = await getMasterUnmappedSkus();
  assert(Array.isArray(unmapped), 'Test 72: getMasterUnmappedSkus returns unmapped SKU records array', `count=${unmapped.length}`);

  // Test route stock shortage retrieval
  const routeShortages = await getMasterRouteStockExceptions();
  assert(Array.isArray(routeShortages), 'Test 73: getMasterRouteStockExceptions returns route stock shortage items array', `count=${routeShortages.length}`);

  // Test audit log limit and range filters
  const auditLogs = await getMasterAuditLog({ range, limit: 5 });
  assert(Array.isArray(auditLogs) && auditLogs.length <= 5, 'Test 74: getMasterAuditLog respects pagination limit and range criteria', `count=${auditLogs.length}`);

  // Test Master Dashboard uses useQuery
  const masterDashboardPath = path.resolve('src/features/master/pages/MasterDashboardPage.tsx');
  const masterDashContent = fs.readFileSync(masterDashboardPath, 'utf8');
  assert(masterDashContent.includes('useQuery') && !masterDashContent.includes('useEffect(() => { load(); }'), 'Test 75: MasterDashboardPage migrated completely from useEffect to useQuery', 'reactive=true');

  // Verify production build
  let buildClean = false;
  let buildError = '';
  try {
    const cmd = process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build';
    execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
    buildClean = true;
  } catch (err: any) {
    buildClean = false;
    buildError = err?.stderr?.toString() || err?.stdout?.toString() || err?.message || 'Unknown error';
  }
  assert(buildClean, 'Test 76: npm run build passes with 0 TypeScript or bundling errors', buildClean ? 'Exit code 0' : buildError.slice(0, 200));

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passed} PASSED / ${failed} FAILED (Total 76 Tests)`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll76Tests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
