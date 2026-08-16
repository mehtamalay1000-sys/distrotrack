import * as XLSX from 'xlsx';

// ── Types ──────────────────────────────────────────────────────────

export interface ParsedPartyRow {
  code: string;
  name: string;
  city: string;
}

export interface ParsedProductRow {
  sku: string;
  name: string;
  category: string;
}

export interface ParsedMasterData {
  parties: ParsedPartyRow[];
  products: ParsedProductRow[];
  totalRows: number;
  warnings: string[];
}

// ── Column header aliases (case-insensitive matching) ──────────────

const COLUMN_ALIASES: Record<string, string[]> = {
  custCode:     ['cust code', 'cust_code', 'customer code', 'customer_code', 'party code', 'party_code', 'ret code', 'ret. code'],
  custName:     ['cust name', 'cust_name', 'customer name', 'customer_name', 'party name', 'party_name'],
  region:       ['region', 'city', 'state', 'area'],
  skuCode:      ['sku code', 'sku_code', 'sku', 'material', 'material code', 'item code', 'product code'],
  description:  ['description', 'product name', 'product_name', 'item name', 'item_name', 'material description'],
  subcategory:  ['subcategory', 'sub category', 'sub_category', 'category', 'product category'],
};

/**
 * Finds a matching column key from the header row.
 * Prefers exact matches over partial (includes) matches to avoid
 * ambiguous columns like "Invoice Type Description" stealing the
 * match from the actual "Description" column.
 */
function findColumnIndex(headers: string[], aliasKey: string): number {
  const aliases = COLUMN_ALIASES[aliasKey] || [];

  // Pass 1: exact match (highest priority)
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toString().toLowerCase().trim();
    for (const alias of aliases) {
      if (h === alias) return i;
    }
  }

  // Pass 2: partial includes match (fallback)
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toString().toLowerCase().trim();
    for (const alias of aliases) {
      if (h.includes(alias)) return i;
    }
  }

  return -1;
}

/**
 * Normalizes a customer/party code for consistent storage.
 * Strips leading zeros and uppercases.
 */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

// ── Main Parser ────────────────────────────────────────────────────

/**
 * Parses a Sales Excel file (.xlsx / .xls) and extracts unique
 * parties (customers) and products for master data seeding.
 */
export function parseSalesExcel(data: ArrayBuffer): ParsedMasterData {
  const warnings: string[] = [];

  // Read workbook
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel file contains no sheets.');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (rows.length < 2) {
    throw new Error('Excel file has no data rows. Expected at least a header row + data.');
  }

  // Auto-detect the header row (first row containing "Cust Code" or "Cust Name")
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const rowStr = rows[i].map(c => (c || '').toString().toLowerCase()).join(' ');
    if (rowStr.includes('cust code') || rowStr.includes('cust name') || rowStr.includes('customer code')) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    // Fallback: assume row 0 is header
    headerRowIndex = 0;
    warnings.push('Could not auto-detect header row. Using first row as headers.');
  }

  const headers = rows[headerRowIndex].map(h => (h || '').toString());

  // Map columns
  const colCustCode    = findColumnIndex(headers, 'custCode');
  const colCustName    = findColumnIndex(headers, 'custName');
  const colRegion      = findColumnIndex(headers, 'region');
  const colSkuCode     = findColumnIndex(headers, 'skuCode');
  const colDescription = findColumnIndex(headers, 'description');
  const colSubcategory = findColumnIndex(headers, 'subcategory');

  if (colCustCode === -1 && colCustName === -1) {
    throw new Error('Cannot find "Cust Code" or "Cust Name" columns in the Excel file. Please check the file format.');
  }
  if (colSkuCode === -1 && colDescription === -1) {
    warnings.push('No SKU Code or Description column found. Only parties will be imported.');
  }

  // Parse data rows
  const partyMap = new Map<string, ParsedPartyRow>();
  const productMap = new Map<string, ParsedProductRow>();
  let totalRows = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !(c || '').toString().trim())) continue; // skip empty rows
    totalRows++;

    // Extract party
    const rawCustCode = colCustCode >= 0 ? (row[colCustCode] || '').toString().trim() : '';
    const rawCustName = colCustName >= 0 ? (row[colCustName] || '').toString().trim() : '';
    const rawRegion   = colRegion >= 0   ? (row[colRegion] || '').toString().trim()   : '';

    if (rawCustCode || rawCustName) {
      const code = rawCustCode ? normalizeCode(rawCustCode) : `AUTO-${rawCustName.replace(/\s+/g, '-').toUpperCase().slice(0, 20)}`;
      if (!partyMap.has(code)) {
        partyMap.set(code, {
          code,
          name: rawCustName || code,
          city: rawRegion,
        });
      }
    }

    // Extract product
    const rawSku         = colSkuCode >= 0     ? (row[colSkuCode] || '').toString().trim()     : '';
    const rawDescription = colDescription >= 0 ? (row[colDescription] || '').toString().trim() : '';
    const rawSubcategory = colSubcategory >= 0 ? (row[colSubcategory] || '').toString().trim() : '';

    if (rawSku || rawDescription) {
      const sku = rawSku || `SKU-${rawDescription.replace(/\s+/g, '-').toUpperCase().slice(0, 20)}`;
      if (!productMap.has(sku)) {
        productMap.set(sku, {
          sku,
          name: rawDescription || sku,
          category: rawSubcategory,
        });
      }
    }
  }

  const parties = Array.from(partyMap.values());
  const products = Array.from(productMap.values());

  if (parties.length === 0) {
    warnings.push('No parties found in the Excel file.');
  }
  if (products.length === 0) {
    warnings.push('No products found in the Excel file.');
  }

  return {
    parties,
    products,
    totalRows,
    warnings,
  };
}
