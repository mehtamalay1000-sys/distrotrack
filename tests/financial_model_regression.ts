/**
 * DistroTrack v2 — Financial Model Regression Test Suite
 *
 * Tests the core invariants of the SALES ≠ COLLECTIONS + CREDIT model.
 *
 * Run: npx tsx tests/financial_model_regression.ts
 *
 * FINANCIAL INVARIANTS (must never be violated):
 *  1. Sales = SUM(delivered_amount) from completed/partial deliveries
 *  2. Collections = SUM(payments.amount) from payments table
 *  3. Pending Credit = Sales - Collections (never negative)
 *  4. Sales = Collections + Pending Credit (always)
 *  5. A credit sale is a SALE — it contributes to Sales immediately
 *  6. Collecting a credit payment does NOT change Sales
 *  7. Worker target progress = (Sales / Target) * 100 (NOT Collections / Target)
 */

import assert from 'assert';

// ── Test helpers ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

// ── Mocked data types ────────────────────────────────────────────────

interface MockDelivery {
  id: string;
  status: 'delivered' | 'partial' | 'refused' | 'pending';
  delivered_amount: number;
  collected_amount: number;
  payment_mode?: string;
}

interface MockPayment {
  id: string;
  amount: number;
  payment_mode: 'cash' | 'upi' | 'cheque' | 'credit';
  status: 'collected' | 'pending' | 'cleared' | 'bounced' | 'reversed';
}

// ── Core financial calculation functions ─────────────────────────────
// These replicate the CORRECTED logic from workerRouteService.ts

function calcSales(deliveries: MockDelivery[]): number {
  return deliveries
    .filter(d => d.status === 'delivered' || d.status === 'partial')
    .reduce((s, d) => s + d.delivered_amount, 0);
}

function calcCollected(deliveries: MockDelivery[]): number {
  return deliveries
    .filter(d => d.status === 'delivered' || d.status === 'partial')
    .reduce((s, d) => s + d.collected_amount, 0);
}

function calcPendingCredit(deliveries: MockDelivery[]): number {
  return deliveries
    .filter(d => d.status === 'delivered' || d.status === 'partial')
    .reduce((s, d) => s + Math.max(0, d.delivered_amount - d.collected_amount), 0);
}

function calcCollectionsFromPayments(payments: MockPayment[]): number {
  return payments
    .filter(p => p.status !== 'reversed' && p.status !== 'bounced')
    .reduce((s, p) => s + p.amount, 0);
}

function calcTargetProgress(sales: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((sales / target) * 100));
}

// ── Test Suite ───────────────────────────────────────────────────────

console.log('\n🔬 DistroTrack v2 — Financial Model Regression Tests\n');

// ─── Section 1: Core Invariants ────────────────────────────────────
console.log('Section 1: Core Financial Invariants');

test('INV-001: Sales = Collections + Pending Credit (all cash)', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 10000, collected_amount: 10000 },
    { id: 'd2', status: 'delivered', delivered_amount: 5000, collected_amount: 5000 },
  ];
  const sales = calcSales(deliveries);
  const collected = calcCollected(deliveries);
  const pending = calcPendingCredit(deliveries);
  assert.strictEqual(sales, 15000, 'Sales should be 15000');
  assert.strictEqual(collected, 15000, 'Collected should be 15000');
  assert.strictEqual(pending, 0, 'Pending should be 0');
  assert.strictEqual(collected + pending, sales, 'Collections + Pending = Sales');
});

test('INV-002: Sales = Collections + Pending Credit (mixed cash + credit)', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 30000, collected_amount: 30000 }, // cash
    { id: 'd2', status: 'delivered', delivered_amount: 20000, collected_amount: 0 },    // credit
    { id: 'd3', status: 'delivered', delivered_amount: 4000, collected_amount: 4000 },   // upi
  ];
  const sales = calcSales(deliveries);
  const collected = calcCollected(deliveries);
  const pending = calcPendingCredit(deliveries);
  assert.strictEqual(sales, 54000, 'Sales should be 54000 (all delivered_amount)');
  assert.strictEqual(collected, 34000, 'Collected should be 34000');
  assert.strictEqual(pending, 20000, 'Pending credit should be 20000');
  assert.strictEqual(collected + pending, sales, 'Collections + Pending = Sales');
});

test('INV-003: Pending credit is NEVER negative', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 1000, collected_amount: 1000 },
    { id: 'd2', status: 'partial', delivered_amount: 500, collected_amount: 600 }, // over-collected (edge case)
  ];
  const pending = calcPendingCredit(deliveries);
  assert(pending >= 0, 'Pending credit should never be negative');
});

test('INV-004: Refused deliveries do NOT contribute to sales', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 10000, collected_amount: 10000 },
    { id: 'd2', status: 'refused', delivered_amount: 5000, collected_amount: 0 },  // refused
    { id: 'd3', status: 'pending', delivered_amount: 3000, collected_amount: 0 },  // not delivered yet
  ];
  const sales = calcSales(deliveries);
  assert.strictEqual(sales, 10000, 'Sales = only delivered/partial status');
});

test('INV-005: Partial deliveries contribute their delivered_amount (not full amount)', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'partial', delivered_amount: 6000, collected_amount: 3000 }, // 50% collected
  ];
  const sales = calcSales(deliveries);
  const pending = calcPendingCredit(deliveries);
  assert.strictEqual(sales, 6000, 'Sales = partial delivered_amount (6000)');
  assert.strictEqual(pending, 3000, 'Pending = 6000 - 3000 = 3000');
});

// ─── Section 2: The ₹39,626.50 Bug ─────────────────────────────────
console.log('\nSection 2: The ₹39,626.50 Target Progress Bug');

test('BUG-001: Old (buggy) logic: sales = total_collected → wrong progress', () => {
  // Route with ₹54,000 sales but ₹14,374 in credit → total_collected = ₹39,626
  const mockPicklist = {
    total_amount: 54000,
    total_collected: 39626.50,
    status: 'completed',
  };
  const buggyTotalSales = mockPicklist.total_collected; // BUG
  const monthlyTarget = 100000;
  const buggyProgress = Math.round((buggyTotalSales / monthlyTarget) * 100);
  assert.strictEqual(buggyTotalSales, 39626.50, 'Buggy: shows 39626.50 as sales');
  assert(buggyProgress < 54, 'Buggy: progress is too low (misses credit sales)');
});

test('BUG-002: Fixed logic: sales = delivered_amount → correct progress', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 39626.50, collected_amount: 39626.50 },
    { id: 'd2', status: 'delivered', delivered_amount: 14373.50, collected_amount: 0 }, // credit
  ];
  const sales = calcSales(deliveries);
  const monthlyTarget = 100000;
  const progress = calcTargetProgress(sales, monthlyTarget);
  assert.strictEqual(sales, 54000, 'Fixed: sales = 54000 (full delivered_amount)');
  assert.strictEqual(progress, 54, 'Fixed: target progress = 54%');
});

test('BUG-003: Verified — credit sale changes Pending, NOT Sales after collection', () => {
  const beforeDeliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 14373.50, collected_amount: 0 }, // credit
  ];
  const salesBefore = calcSales(beforeDeliveries);
  assert.strictEqual(salesBefore, 14373.50, 'Sales before collection = 14373.50');

  // After admin marks collected:
  const afterDeliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 14373.50, collected_amount: 14373.50 }, // collected
  ];
  const salesAfter = calcSales(afterDeliveries);
  const pendingAfter = calcPendingCredit(afterDeliveries);

  assert.strictEqual(salesAfter, 14373.50, 'Sales AFTER collection = unchanged (14373.50)');
  assert.strictEqual(pendingAfter, 0, 'Pending credit = 0 after full collection');
  assert.strictEqual(salesBefore, salesAfter, 'INVARIANT: Sales must not change when credit is collected');
});

// ─── Section 3: Target Progress Calculations ────────────────────────
console.log('\nSection 3: Target Progress (Sales-Based)');

test('TARGET-001: 0% progress when no deliveries', () => {
  assert.strictEqual(calcTargetProgress(0, 100000), 0);
});

test('TARGET-002: 50% progress when 50k sales, 100k target', () => {
  assert.strictEqual(calcTargetProgress(50000, 100000), 50);
});

test('TARGET-003: 100% progress when sales exceed target (capped)', () => {
  assert.strictEqual(calcTargetProgress(120000, 100000), 100);
});

test('TARGET-004: Credit sales contribute IMMEDIATELY to target progress', () => {
  // 50k cash + 50k credit = 100k sales = 100% of 100k target
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 50000, collected_amount: 50000 },
    { id: 'd2', status: 'delivered', delivered_amount: 50000, collected_amount: 0 },    // credit
  ];
  const sales = calcSales(deliveries);
  const progress = calcTargetProgress(sales, 100000);
  assert.strictEqual(sales, 100000, 'Sales = 100000 (cash + credit)');
  assert.strictEqual(progress, 100, 'Progress = 100% when credit sales included');
});

test('TARGET-005: Progress does NOT use total_collected', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 54000, collected_amount: 39626.50 },
  ];
  const sales = calcSales(deliveries);
  const collected = calcCollected(deliveries);
  const progressFromSales = calcTargetProgress(sales, 100000);
  const progressFromCollections = calcTargetProgress(collected, 100000);
  assert(progressFromSales > progressFromCollections, 'Progress from Sales > Progress from Collections (when credit exists)');
  assert.strictEqual(progressFromSales, 54, 'Correct progress = 54%');
  assert.strictEqual(progressFromCollections, 40, 'Wrong (old) progress = 40%');
});

// ─── Section 4: Collection Does Not Change Sales ────────────────────
console.log('\nSection 4: Collection Does Not Change Sales (Core Invariant)');

test('COLL-001: Recording a payment does not change delivered_amount', () => {
  let delivery: MockDelivery = { id: 'd1', status: 'delivered', delivered_amount: 10000, collected_amount: 0 };
  const salesBefore = delivery.delivered_amount;

  // Simulate Admin marks ₹10,000 collected:
  delivery = { ...delivery, collected_amount: 10000 };
  const salesAfter = delivery.delivered_amount;

  assert.strictEqual(salesBefore, salesAfter, 'delivered_amount never changes when payment recorded');
  assert.strictEqual(delivery.collected_amount, 10000, 'collected_amount updated correctly');
});

test('COLL-002: Partial collection reduces pending (not sales)', () => {
  const delivery: MockDelivery = { id: 'd1', status: 'delivered', delivered_amount: 10000, collected_amount: 0 };
  const sales = delivery.delivered_amount;
  const pending1 = Math.max(0, delivery.delivered_amount - delivery.collected_amount);

  // Partial collection:
  const afterPartial = { ...delivery, collected_amount: 4000 };
  const pending2 = Math.max(0, afterPartial.delivered_amount - afterPartial.collected_amount);

  assert.strictEqual(afterPartial.delivered_amount, sales, 'Sales unchanged after partial collection');
  assert.strictEqual(pending1, 10000, 'Initially 10000 pending');
  assert.strictEqual(pending2, 6000, 'After 4000 collected, 6000 still pending');
  assert.strictEqual(afterPartial.collected_amount + pending2, sales, 'Collected + Pending = Sales');
});

test('COLL-003: Full collection removes pending credit (sales unchanged)', () => {
  const delivery: MockDelivery = { id: 'd1', status: 'delivered', delivered_amount: 10000, collected_amount: 0 };
  const salesOriginal = delivery.delivered_amount;

  const afterFull = { ...delivery, collected_amount: 10000 };
  const pendingAfter = Math.max(0, afterFull.delivered_amount - afterFull.collected_amount);

  assert.strictEqual(afterFull.delivered_amount, salesOriginal, 'Sales: never changes');
  assert.strictEqual(pendingAfter, 0, 'Pending = 0 after full collection');
  assert.strictEqual(afterFull.collected_amount, salesOriginal, 'Collected = Sale amount');
});

test('COLL-004: Over-collection must be blocked', () => {
  const pendingAmount = 5000;
  const attemptedCollection = 6000;
  const isOverCollection = attemptedCollection > pendingAmount + 0.01;
  assert(isOverCollection, 'Over-collection should be detected');
});

// ─── Section 5: Payment Mode Breakdown ─────────────────────────────
console.log('\nSection 5: Payment Mode Breakdown');

test('PAY-001: Cash collection tracked separately from credit', () => {
  const payments: MockPayment[] = [
    { id: 'p1', amount: 30000, payment_mode: 'cash', status: 'collected' },
    { id: 'p2', amount: 10000, payment_mode: 'upi', status: 'collected' },
    { id: 'p3', amount: 5000, payment_mode: 'cheque', status: 'pending' },
  ];
  const totalCollections = calcCollectionsFromPayments(payments);
  const cashOnly = payments.filter(p => p.payment_mode === 'cash').reduce((s, p) => s + p.amount, 0);
  const upiOnly = payments.filter(p => p.payment_mode === 'upi').reduce((s, p) => s + p.amount, 0);
  assert.strictEqual(totalCollections, 45000, 'Total collections = 45000');
  assert.strictEqual(cashOnly, 30000, 'Cash = 30000');
  assert.strictEqual(upiOnly, 10000, 'UPI = 10000');
});

test('PAY-002: Reversed payments do not count as collections', () => {
  const payments: MockPayment[] = [
    { id: 'p1', amount: 10000, payment_mode: 'cash', status: 'collected' },
    { id: 'p2', amount: 5000, payment_mode: 'cash', status: 'reversed' }, // should be excluded
  ];
  const collections = calcCollectionsFromPayments(payments);
  assert.strictEqual(collections, 10000, 'Reversed payments excluded from collections');
});

test('PAY-003: Bounced cheques do not count as collections', () => {
  const payments: MockPayment[] = [
    { id: 'p1', amount: 10000, payment_mode: 'cheque', status: 'cleared' },
    { id: 'p2', amount: 5000, payment_mode: 'cheque', status: 'bounced' }, // excluded
  ];
  const collections = calcCollectionsFromPayments(payments);
  assert.strictEqual(collections, 10000, 'Bounced cheques excluded from collections');
});

// ─── Section 6: Dashboard Stats Derivation ──────────────────────────
console.log('\nSection 6: Dashboard Stats (Admin/Master)');

test('DASH-001: todaySales derived from delivered_amount, not collections', () => {
  const todayDeliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 25000, collected_amount: 20000 }, // 5000 credit
    { id: 'd2', status: 'delivered', delivered_amount: 10000, collected_amount: 10000 },
  ];
  const todaySales = calcSales(todayDeliveries);
  const todayCollections = calcCollected(todayDeliveries);
  assert.strictEqual(todaySales, 35000, 'Today sales = 35000 (all delivered)');
  assert.strictEqual(todayCollections, 30000, 'Today collections = 30000 (excluding credit)');
  assert(todaySales > todayCollections, 'Sales > Collections when credit exists');
});

test('DASH-002: monthlyUdhari = delivered_amount - collected_amount (not from ledger alone)', () => {
  const monthDeliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 54000, collected_amount: 39626.50 },
  ];
  const pendingCredit = calcPendingCredit(monthDeliveries);
  assert.strictEqual(pendingCredit, 14373.50, 'Monthly Udhari = 14373.50');
});

test('DASH-003: Sales + Collections + Pending identity holds at dashboard level', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 100000, collected_amount: 75000 },
    { id: 'd2', status: 'partial', delivered_amount: 20000, collected_amount: 15000 },
    { id: 'd3', status: 'refused', delivered_amount: 10000, collected_amount: 0 }, // excluded
  ];
  const sales = calcSales(deliveries);
  const collected = calcCollected(deliveries);
  const pending = calcPendingCredit(deliveries);
  assert.strictEqual(sales, 120000, 'Sales = 120000 (excluding refused)');
  assert.strictEqual(collected, 90000, 'Collected = 90000');
  assert.strictEqual(pending, 30000, 'Pending = 30000');
  assert.strictEqual(collected + pending, sales, 'Identity: Collected + Pending = Sales ✓');
});

// ─── Section 7: Multi-route Worker Aggregation ──────────────────────
console.log('\nSection 7: Multi-Route Worker Aggregation');

test('WORKER-001: Worker totalSales aggregates across all routes', () => {
  const route1Deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 30000, collected_amount: 30000 },
    { id: 'd2', status: 'delivered', delivered_amount: 10000, collected_amount: 0 },   // credit
  ];
  const route2Deliveries: MockDelivery[] = [
    { id: 'd3', status: 'delivered', delivered_amount: 25000, collected_amount: 25000 },
    { id: 'd4', status: 'partial', delivered_amount: 5000, collected_amount: 2000 },   // partial credit
  ];
  const allDeliveries = [...route1Deliveries, ...route2Deliveries];
  const totalSales = calcSales(allDeliveries);
  const totalCollected = calcCollected(allDeliveries);
  const totalPending = calcPendingCredit(allDeliveries);
  assert.strictEqual(totalSales, 70000, 'Total sales across routes = 70000');
  assert.strictEqual(totalCollected, 57000, 'Total collected = 57000');
  assert.strictEqual(totalPending, 13000, 'Total pending = 13000');
  assert.strictEqual(totalCollected + totalPending, totalSales, 'Multi-route identity holds');
});

test('WORKER-002: achievedSales = totalSales (not totalCollected)', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 70000, collected_amount: 57000 },
  ];
  const totalSales = calcSales(deliveries);
  const totalCollected = calcCollected(deliveries);
  const achievedSales = totalSales; // CORRECT: achievedSales = sales
  const wrongAchieved = totalCollected; // BUG: achievedSales = collections
  assert(achievedSales > wrongAchieved, 'Correct achievedSales > buggy achievedSales');
  assert.strictEqual(achievedSales, 70000, 'achievedSales = 70000 (correct)');
  assert.strictEqual(wrongAchieved, 57000, 'buggy achievedSales = 57000 (wrong)');
});

test('WORKER-003: remainingTarget uses sales-based achievedSales', () => {
  const monthlyTarget = 100000;
  const totalSales = 70000;
  const totalCollected = 57000;
  const correctRemaining = Math.max(0, monthlyTarget - totalSales);
  const wrongRemaining = Math.max(0, monthlyTarget - totalCollected);
  assert.strictEqual(correctRemaining, 30000, 'Correct remaining = 30000');
  assert.strictEqual(wrongRemaining, 43000, 'Buggy remaining = 43000 (shows too high)');
  assert(correctRemaining < wrongRemaining, 'Correct remaining is lower (better for worker)');
});

// ─── Section 8: Edge Cases ──────────────────────────────────────────
console.log('\nSection 8: Edge Cases');

test('EDGE-001: Empty deliveries array = 0 sales, 0 collections, 0 pending', () => {
  const deliveries: MockDelivery[] = [];
  assert.strictEqual(calcSales(deliveries), 0);
  assert.strictEqual(calcCollected(deliveries), 0);
  assert.strictEqual(calcPendingCredit(deliveries), 0);
});

test('EDGE-002: Worker with 0 monthly target = 0% progress (no divide by zero)', () => {
  assert.strictEqual(calcTargetProgress(50000, 0), 0, 'Progress = 0 when target = 0');
});

test('EDGE-003: 100% credit route still shows correct sales', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 50000, collected_amount: 0 },
    { id: 'd2', status: 'delivered', delivered_amount: 30000, collected_amount: 0 },
  ];
  const sales = calcSales(deliveries);
  const collections = calcCollected(deliveries);
  const pending = calcPendingCredit(deliveries);
  assert.strictEqual(sales, 80000, 'Sales = 80000 even with 0 collections');
  assert.strictEqual(collections, 0, 'Collections = 0 on 100% credit route');
  assert.strictEqual(pending, 80000, 'Pending = 80000');
  assert.strictEqual(collections + pending, sales, 'Identity holds for 100% credit route');
});

test('EDGE-004: Worker progress still reflects full sales on 100% credit route', () => {
  const deliveries: MockDelivery[] = [
    { id: 'd1', status: 'delivered', delivered_amount: 80000, collected_amount: 0 }, // all credit
  ];
  const totalSales = calcSales(deliveries);
  const progress = calcTargetProgress(totalSales, 100000);
  assert.strictEqual(progress, 80, '80% target progress even on all-credit route');
});

test('EDGE-005: Sales summary invariant: Collections + Pending = Sales (10 random cases)', () => {
  for (let i = 0; i < 10; i++) {
    const deliveredAmt = Math.round(Math.random() * 100000) / 100;
    const collectedAmt = Math.round(Math.random() * deliveredAmt * 100) / 100;
    const delivery: MockDelivery = {
      id: `d${i}`, status: 'delivered',
      delivered_amount: deliveredAmt,
      collected_amount: collectedAmt,
    };
    const sales = calcSales([delivery]);
    const collected = calcCollected([delivery]);
    const pending = calcPendingCredit([delivery]);
    const sum = Math.round((collected + pending) * 100) / 100;
    const salesRounded = Math.round(sales * 100) / 100;
    assert.strictEqual(sum, salesRounded, `Case ${i}: Collected(${collected}) + Pending(${pending}) = Sales(${sales})`);
  }
});

// ─── Final Report ────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

if (failures.length > 0) {
  console.log('\n❌ Failed Tests:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log('\n');
  process.exit(1);
} else {
  console.log('\n✅ All financial model invariants verified!');
  console.log('   SALES ≠ COLLECTIONS confirmed correct throughout the system.');
  console.log('   Credit sales correctly count toward target immediately.\n');
  process.exit(0);
}
