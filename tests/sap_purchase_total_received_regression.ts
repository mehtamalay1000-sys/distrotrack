import * as path from 'path';
import * as fs from 'fs';
import * as xlsx from 'xlsx';
import {
  parseSapPurchaseFile,
  validateAndMatchPurchaseRows,
  confirmPurchaseImport,
  extractSapProductDetails,
  ParsedPurchaseRow,
} from '../src/features/inventory/services/purchaseImportService';
import {
  registerProductMasterEntry,
  findProductMasterEntry,
} from '../src/features/products/data/productMaster';
import { mockStore } from '../src/lib/mockStore';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName}${detail ? ` (${detail})` : ''}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${testName}${detail ? ` — ${detail}` : ''}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  SAP PURCHASE IMPORT - TOTAL RECEIVED QUANTITY REGRESSION TEST');
  console.log('================================================================\n');

  // Reset mockStore movements and imports
  (mockStore as any).inventoryMovements = [];
  (mockStore as any).sapPurchaseImports = [];
  (mockStore as any).sapPurchaseImportItems = [];

  let purchasePath = path.resolve(process.cwd(), 'purchase.xlsx');
  if (!fs.existsSync(purchasePath) && fs.existsSync('D:/sem 5/purchase.xlsx')) {
    purchasePath = 'D:/sem 5/purchase.xlsx';
  }
  assert(fs.existsSync(purchasePath), 'purchase.xlsx file exists in project or source path');

  const fileBuffer = fs.readFileSync(purchasePath);
  const fileBlob = new Blob([fileBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const file = new File([fileBlob], 'purchase.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // Parse purchase.xlsx
  const parseResult = await parseSapPurchaseFile(file);
  console.log(`\n--- 1. PARSE & AUTHORITATIVE DATA VERIFICATION ---`);
  assert(parseResult.rows.length === 72, 'Parsed exactly 72 valid purchase rows', `got ${parseResult.rows.length}`);
  
  // Verify against raw spreadsheet data directly
  const wb = xlsx.read(fileBuffer, { type: 'buffer' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const rawSheetData: any[] = xlsx.utils.sheet_to_json(firstSheet, { defval: '' });
  
  let rawConfirmedQtySum = 0;
  let rawDataRowCount = 0;
  for (const r of rawSheetData) {
    const sku = String(r['Article No'] || '').trim();
    const qty = Number(r['Confirmed Qty'] || 0);
    if (sku && sku !== 'Total' && !sku.toLowerCase().includes('subtotal')) {
      rawDataRowCount++;
      rawConfirmedQtySum += qty;
    }
  }

  assert(rawDataRowCount === 72, 'Raw spreadsheet data rows equal 72', `found ${rawDataRowCount}`);
  assert(rawConfirmedQtySum === 3736, 'Raw spreadsheet confirmed qty sum equals 3,736 DOZ', `sum: ${rawConfirmedQtySum}`);

  // Register canonical product master entries for the 49 unique SKUs in purchase.xlsx
  for (const r of parseResult.rows) {
    const details = extractSapProductDetails(r);
    registerProductMasterEntry({
      sku: details.sku,
      name: details.name,
      mrp: details.mrp || 100,
      category: details.category || 'Oral Care',
      unit: details.unit || 'pcs',
      brand: details.brand || undefined,
      uom: details.uom || undefined,
      subCategory: details.subCategory || undefined,
      subBrand: details.subBrand || undefined,
      variant: details.variant || undefined,
      ppg: details.ppg || undefined,
      ppgDescription: details.ppgDescription || undefined,
      materialGroup: details.materialGroup || undefined,
      prodHierarchy: details.prodHierarchy || undefined,
    });
  }

  // Also register SKU 1600958 for synthetic test
  registerProductMasterEntry({
    sku: '1600958',
    name: 'MaxFresh Blue 150g',
    mrp: 75,
    category: 'Oral Care',
    unit: 'pcs',
    uom: 'DOZ',
  });

  // Test validateAndMatchPurchaseRows
  console.log(`\n--- 2. ELIGIBLE ROWS & TOTAL RECEIVED QUANTITY CALCULATION ---`);
  const preview = await validateAndMatchPurchaseRows(parseResult.rows, parseResult.batchRef);

  // 1. Total received quantity is calculated from all eligible rows
  assert(preview.totalReceivedQty === 3736, 'Total received quantity is calculated from all eligible rows', `preview.totalReceivedQty = ${preview.totalReceivedQty}`);
  assert(preview.eligibleRowsCount === 72, 'All 72 rows are eligible', `eligibleRowsCount = ${preview.eligibleRowsCount}`);
  assert(preview.totalRows === 72, 'Total parsed rows = 72', `totalRows = ${preview.totalRows}`);
  assert(preview.uniqueSkusCount === 49, 'Unique SKUs count = 49', `uniqueSkusCount = ${preview.uniqueSkusCount}`);
  assert(preview.excluded === 0, 'Zero rows excluded (pending) in clean purchase.xlsx', `excluded = ${preview.excluded}`);
  assert(preview.invalid === 0, 'Zero invalid qty rows in purchase.xlsx', `invalid = ${preview.invalid}`);
  assert(preview.unmapped === 0, 'Zero unmapped SKUs in purchase.xlsx', `unmapped = ${preview.unmapped}`);

  // 2. Total includes repeated SKUs
  console.log(`\n--- 3. REPEATED SKUs & SAME SKU WITH DIFFERENT ITEM NUMBERS ---`);
  const sku61059906Rows = preview.rows.filter((r) => r.sku === '61059906');
  assert(sku61059906Rows.length === 4, 'SKU 61059906 appears 4 times in purchase file across 2 invoices', `count = ${sku61059906Rows.length}`);
  const sku61059906Inv2Rows = sku61059906Rows.filter((r) => r.invoiceNo === '81D0001878');
  const sku61059906Inv2Total = sku61059906Inv2Rows.reduce((sum, r) => sum + r.receivedQty, 0);
  assert(sku61059906Inv2Total === 270, 'SKU 61059906 on Invoice 81D0001878 contributes 12 + 78 + 180 = 270 DOZ', `sum = ${sku61059906Inv2Total}`);
  const sku61059906Total = sku61059906Rows.reduce((sum, r) => sum + r.receivedQty, 0);
  assert(sku61059906Total === 300, 'SKU 61059906 file-wide total is 30 + 12 + 78 + 180 = 300 DOZ', `sum = ${sku61059906Total}`);

  // 3. Same SKU with different SAP Item No contributes both quantities
  const sku1601319Rows = preview.rows.filter((r) => r.sku === '1601319');
  assert(sku1601319Rows.length === 3, 'SKU 1601319 appears 3 times in file', `count = ${sku1601319Rows.length}`);
  const sku1601319Inv2Rows = sku1601319Rows.filter((r) => r.invoiceNo === '81D0001878');
  const sku1601319Inv2Total = sku1601319Inv2Rows.reduce((sum, r) => sum + r.receivedQty, 0);
  assert(sku1601319Inv2Total === 8, 'SKU 1601319 Items 16 & 72 on Invoice 81D0001878 contribute 4 + 4 = 8 DOZ', `sum = ${sku1601319Inv2Total}`);
  const sku1601319Total = sku1601319Rows.reduce((sum, r) => sum + r.receivedQty, 0);
  assert(sku1601319Total === 12, 'SKU 1601319 file-wide total is 4 + 4 + 4 = 12 DOZ', `sum = ${sku1601319Total}`);

  const sku61058281Rows = preview.rows.filter((r) => r.sku === '61058281');
  const sku61058281Total = sku61058281Rows.reduce((sum, r) => sum + r.receivedQty, 0);
  assert(sku61058281Total === 1152, 'SKU 61058281 contributes 72 + 1080 = 1,152 DOZ to total', `sum = ${sku61058281Total}`);

  // 4. Pending GR is excluded
  console.log(`\n--- 4. EXCLUSION OF PENDING GR, INVALID QTY, & UNMAPPED SKUS ---`);
  const syntheticPendingRow: ParsedPurchaseRow = {
    sku: '1600958',
    productName: 'MaxFresh Blue 150g',
    uom: 'DOZ',
    orderedQty: 50,
    receivedQty: 50,
    grStatus: 'Pending', // Pending GR!
    grDate: '2026-09-15',
    grDocNo: '3024999999',
    poNumber: '4500999999',
    invoiceNo: '81D9999999',
    invoiceDate: '15.09.2026',
    batch: '99',
    itemNo: '1',
    rawRow: {},
  };

  const syntheticInvalidRow: ParsedPurchaseRow = {
    sku: '1600958',
    productName: 'MaxFresh Blue 150g',
    uom: 'DOZ',
    orderedQty: 0,
    receivedQty: 0, // Invalid zero qty
    grStatus: 'Completed',
    grDate: '2026-09-15',
    grDocNo: '3024999999',
    poNumber: '4500999999',
    invoiceNo: '81D9999999',
    invoiceDate: '15.09.2026',
    batch: '99',
    itemNo: '2',
    rawRow: {},
  };

  const syntheticUnmappedRow: ParsedPurchaseRow = {
    sku: 'UNKNOWN_SKU_XYZ_999999',
    productName: 'Unknown Item Not In Catalog',
    uom: 'DOZ',
    orderedQty: 100,
    receivedQty: 100, // Unmapped SKU
    grStatus: 'Completed',
    grDate: '2026-09-15',
    grDocNo: '3024999999',
    poNumber: '4500999999',
    invoiceNo: '81D9999999',
    invoiceDate: '15.09.2026',
    batch: '99',
    itemNo: '3',
    rawRow: {},
  };

  const syntheticValidRow: ParsedPurchaseRow = {
    sku: '1600958',
    productName: 'MaxFresh Blue 150g',
    uom: 'DOZ',
    orderedQty: 25,
    receivedQty: 25, // Valid row
    grStatus: 'Completed',
    grDate: '2026-09-15',
    grDocNo: '3024999999',
    poNumber: '4500999999',
    invoiceNo: '81D9999999',
    invoiceDate: '15.09.2026',
    batch: '99',
    itemNo: '4',
    rawRow: {},
  };

  const testBatch = [
    syntheticPendingRow,
    syntheticInvalidRow,
    syntheticUnmappedRow,
    syntheticValidRow,
  ];

  const syntheticPreview = await validateAndMatchPurchaseRows(testBatch, 'SYNTHETIC-BATCH-1');
  assert(syntheticPreview.totalRows === 4, 'Synthetic batch total rows = 4', `got ${syntheticPreview.totalRows}`);
  assert(syntheticPreview.excluded === 1, 'Pending GR row is marked EXCLUDED_STATUS (excluded = 1)', `excluded = ${syntheticPreview.excluded}`);
  assert(syntheticPreview.invalid === 1, 'Zero received qty is marked INVALID_QTY (invalid = 1)', `invalid = ${syntheticPreview.invalid}`);
  assert(syntheticPreview.unmapped === 1, 'Unknown SKU is marked UNMAPPED (unmapped = 1)', `unmapped = ${syntheticPreview.unmapped}`);
  assert(syntheticPreview.matched === 1, 'Only the valid completed row is MATCHED (matched = 1)', `matched = ${syntheticPreview.matched}`);
  assert(syntheticPreview.totalReceivedQty === 25, 'Total received qty includes ONLY the eligible row (+25 DOZ)', `totalReceivedQty = ${syntheticPreview.totalReceivedQty}`);

  // 6 & 7: Total does not depend on table pagination or visible rows
  console.log(`\n--- 5. INDEPENDENCE FROM TABLE PAGINATION & FILTERING ---`);
  // Simulate UI filters:
  const filteredPage1 = preview.rows.slice(0, 10); // Page 1 (10 rows)
  const filteredPage1Sum = filteredPage1.reduce((sum, r) => sum + r.receivedQty, 0);
  const filteredBySearch = preview.rows.filter((r) => r.sku === '61059906'); // Filtered by search
  const filteredBySearchSum = filteredBySearch.reduce((sum, r) => sum + r.receivedQty, 0);

  assert(filteredPage1.length === 10, 'Paginated view displays 10 rows', `len = ${filteredPage1.length}`);
  assert(filteredPage1Sum !== 3736, 'Sum of visible page 1 is partial', `visible sum = ${filteredPage1Sum} != 3736`);
  assert(preview.totalReceivedQty === 3736, 'Authoritative total remains 3,736 DOZ regardless of page slice', `preview.totalReceivedQty = ${preview.totalReceivedQty}`);
  assert(filteredBySearchSum === 300, 'Filtered by search displays 300 DOZ', `search sum = ${filteredBySearchSum}`);
  assert(preview.totalReceivedQty === 3736, 'Authoritative total remains 3,736 DOZ regardless of search filter', `preview.totalReceivedQty = ${preview.totalReceivedQty}`);

  // 8. Total equals the quantity that Confirm & Record will actually inward
  console.log(`\n--- 6. CONFIRM & RECORD ACTUAL INWARD EQUIVALENCE ---`);
  const importResult = await confirmPurchaseImport(preview, preview.batchRef, 'purchase.xlsx', 'Automated regression test');
  assert(importResult.success === true, 'Import confirmed successfully', `result: ${importResult.message}`);
  assert(importResult.movementsCreated === 72, 'Created exactly 72 inward inventory movements', `movementsCreated = ${importResult.movementsCreated}`);

  // Check sum of created movements in ledger
  const movements = mockStore.getInventoryMovements().filter((m) => m.movement_type === 'purchase_inward');
  const totalLedgerInwardQty = movements.reduce((sum, m) => sum + m.quantity, 0);
  assert(totalLedgerInwardQty === 3736, 'Sum of created ledger movements equals preview totalReceivedQty (3,736 DOZ)', `ledger total = ${totalLedgerInwardQty}`);
  assert(preview.totalReceivedQty === totalLedgerInwardQty, 'Displayed Total Received Qty EQUALS actual inwarded quantity in ledger', `${preview.totalReceivedQty} === ${totalLedgerInwardQty}`);

  // 9. Repeated import does not alter the preview calculation incorrectly
  console.log(`\n--- 7. RE-IMPORT PREVIEW DISTINGUISHES TOTAL vs DUPLICATE vs NEW INBOUND ---`);
  const reimportPreview = await validateAndMatchPurchaseRows(parseResult.rows, parseResult.batchRef);
  assert(reimportPreview.totalReceivedQty === 3736, 'Re-import preview STILL shows authoritative Total Received Qty = 3,736 DOZ', `reimportPreview.totalReceivedQty = ${reimportPreview.totalReceivedQty}`);
  assert(reimportPreview.duplicateCount === 72, 'All 72 rows flagged as already imported (duplicateCount = 72)', `duplicateCount = ${reimportPreview.duplicateCount}`);
  assert(reimportPreview.alreadyImportedQty === 3736, 'Already imported qty tracks exactly 3,736 DOZ', `alreadyImportedQty = ${reimportPreview.alreadyImportedQty}`);
  assert(reimportPreview.newInboundQty === 0, 'New inbound qty is 0 DOZ (preventing duplicate movements)', `newInboundQty = ${reimportPreview.newInboundQty}`);

  // Try re-confirming to ensure idempotency protection
  const reconfirmResult = await confirmPurchaseImport(reimportPreview, reimportPreview.batchRef, 'purchase.xlsx');
  assert(reconfirmResult.success === false || reconfirmResult.movementsCreated === 0, 'Re-confirming creates ZERO duplicate movements', `movementsCreated = ${reconfirmResult.movementsCreated}`);
  const movementsAfterReimport = mockStore.getInventoryMovements().filter((m) => m.movement_type === 'purchase_inward');
  assert(movementsAfterReimport.length === 72, 'Ledger movements count unchanged at 72', `count = ${movementsAfterReimport.length}`);

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
