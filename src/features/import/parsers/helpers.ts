import * as pdfjsLib from 'pdfjs-dist';
import { getProductMasterSKUs } from '@/features/products/data/productMaster';

// Configure pdf.js worker URL
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface PDFPageText {
  pageNumber: number;
  text: string;
  lines: string[];
}

/**
 * Extracts text from all pages of a PDF file using pdfjs-dist.
 */
export async function extractPDFText(file: File): Promise<{ pages: PDFPageText[]; fullText: string; pageCount: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = pdfDoc.numPages;
  const pages: PDFPageText[] = [];
  let fullText = '';

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    
    // Group text items by Y coordinates to form proper physical lines
    const lineMap = new Map<number, { x: number; text: string }[]>();
    
    for (const item of textContent.items) {
      if ('str' in item && item.str.trim()) {
        const y = Math.round(item.transform[5]); // Y coordinate
        const x = Math.round(item.transform[4]); // X coordinate
        
        if (!lineMap.has(y)) {
          lineMap.set(y, []);
        }
        lineMap.get(y)!.push({ x, text: item.str });
      }
    }

    // Sort Y descending (top of page first), then X ascending (left to right)
    const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
    const pageLines: string[] = [];

    for (const y of sortedY) {
      const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      const lineText = items.map(it => it.text).join(' ').replace(/\s+/g, ' ').trim();
      if (lineText) pageLines.push(lineText);
    }

    const pageTextStr = pageLines.join('\n');
    pages.push({
      pageNumber: i,
      text: pageTextStr,
      lines: pageLines,
    });
    fullText += `\n--- PAGE ${i} ---\n` + pageTextStr;
  }

  return { pages, fullText, pageCount };
}

/**
 * Normalizes SAP PDF text by cleaning extra whitespace, weird non-breaking spaces, control characters.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Clean numeric string into a float
 */
export function parseNumber(val: string | number | undefined | null): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = val.toString().replace(/,/g, '').replace(/[^\d.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalizes customer code for consistent matching
 */
export function normalizeCode(code: string): string {
  if (!code) return '';
  const trimmed = code.trim().toUpperCase();
  // Strip leading C or S prefixes and leading zeros to get canonical customer digits
  const digits = trimmed.replace(/^[CS]/i, '').replace(/^0+/, '');
  return digits || trimmed;
}

/**
 * Normalizes party name for fuzzy matching fallback
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Product Validation ────────────────────────────────────────────────

/**
 * Known non-product label patterns that must NEVER become product names, SKUs, or categories.
 * These cover SAP invoice/picklist metadata, headers, tax labels, totals, etc.
 */
const NON_PRODUCT_LABELS: RegExp[] = [
  // HSN header rows
  /^HSN/i,
  /^0\s+HSN/i,
  /\bHSN:\s*\d+/i,

  // Invoice/document metadata
  /^ZTIN/i,
  /TAX\s*Invoice/i,
  /Invoice\s*No/i,
  /Invoice\s*Date/i,
  /Invoice\s*Number/i,
  /Bill\s*To/i,
  /Ship\s*To/i,
  /Sold\s*To/i,
  /Ret\.?\s*Code/i,
  /Customer\s*Code/i,
  /Cust\.?\s*Code/i,
  /Billing\s*Date/i,
  /Billing\s*Document/i,
  /Pick\s*List/i,
  /Picklist/i,
  /Document\s*Type/i,
  /Doc\.?\s*Type/i,

  // Route/sales metadata
  /^Route\s*:/i,
  /^SalesRep/i,
  /^Sales\s*Rep/i,
  /^Sales\s*Organization/i,
  /^Distribution/i,
  /^Division/i,
  /^Plant/i,
  /^Storage\s*Location/i,

  // Tax / GST rows
  /^CGST/i,
  /^SGST/i,
  /^IGST/i,
  /^GST/i,
  /^Tax\s*Amount/i,
  /^Tax\s*Rate/i,
  /^Tax\s*Code/i,
  /^Taxable\s*Amount/i,
  /^Output\s*Tax/i,

  // Totals / summary rows
  /^Grand\s*Total/i,
  /^Sub\s*Total/i,
  /^Total\s*Qty/i,
  /^Total\s*Value/i,
  /^Total\s*Amount/i,
  /^Net\s*Amount/i,
  /^Net\s*Invoice/i,
  /^Net\s*Payable/i,
  /^Gross\s*Total/i,
  /^Gross\s*Amount/i,
  /^Amount\s*Payable/i,
  /^Rounding\s*Off/i,
  /^Round\s*Off/i,

  // Page/header markers
  /^Page\s*\d/i,
  /^Continued/i,
  /^Printed\s*on/i,
  /^Date\s*\/\s*Time/i,

  // Table header labels (these should never be product names)
  /^Sr\.?\s*No\.?$/i,
  /^Material$/i,
  /^Description$/i,
  /^Quantity$/i,
  /^Rate$/i,
  /^Amount$/i,
  /^MRP$/i,
  /^UOM$/i,
  /^Unit$/i,

  // Customer code patterns (Cxxxx or Sxxxx style)
  /^[CS]\d{6,12}$/i,

  // Pure invoice/document numbers
  /^[A-Z]\d{2}[A-Z]\d{6,}$/i,

  // Classification labels that are categories, not products
  /^\d{4,6}:\w/,  // e.g. "10120:Toothpaste"

  // Other non-product labels
  /^List\s*of\s*invoice/i,
  /^Terms\s*of\s*Payment/i,
  /^Payment\s*Terms/i,
  /^Delivery\s*Terms/i,
  /^E\.?\s*&\s*O\.?\s*E/i,
  /^Subject\s*to/i,
  /^Authorized\s*Signatory/i,
  /^For\s+.*(?:Ltd|Pvt|Private|Limited)/i,
  /^Colgate[\s-]Palmolive/i,
];

/**
 * Checks whether a given text matches any known non-product label pattern.
 */
export function isNonProductLabel(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return NON_PRODUCT_LABELS.some(pattern => pattern.test(trimmed));
}

/**
 * Validates a SKU/material code for SAP product rows.
 * Valid SAP SKUs are typically 6-10 alphanumeric characters (e.g. 1600908, 61002494, IN00991A).
 * Rejects known non-product codes like customer codes, invoice numbers, document types, etc.
 */
export function isValidSKU(sku: string): boolean {
  const trimmed = sku.trim();
  if (!trimmed || trimmed.length < 4 || trimmed.length > 15) return false;

  // Fast path: if SKU is in the Product Master, it's always valid
  if (getProductMasterSKUs().has(trimmed.toUpperCase())) return true;

  // Must be alphanumeric (allow hyphens for some SAP formats)
  if (!/^[A-Z0-9][A-Z0-9-]{2,14}$/i.test(trimmed)) return false;

  // Explicitly accept known SAP material code patterns:
  // - Pure numeric: 1600908, 61002494
  // - INxxxxxA format: IN00991A, IN00749A
  if (/^\d{6,10}$/.test(trimmed)) return true;
  if (/^IN\d{4,6}[A-Z]$/i.test(trimmed)) return true;

  // Reject known non-SKU patterns
  // Customer codes: C000xxxxxx, S000xxxxxx
  if (/^[CS]0{2,}\d+$/i.test(trimmed)) return false;

  // Invoice numbers: A37A506290 (letter-digit-letter-digit pattern typical for SAP invoice #)
  if (/^[A-Z]\d{2}[A-Z]\d{6,}$/i.test(trimmed)) return false;

  // Pure document type codes
  if (/^ZTIN$/i.test(trimmed)) return false;
  if (/^ZOR[A-Z]$/i.test(trimmed)) return false;
  if (/^GSTIN$/i.test(trimmed)) return false;

  return true;
}

/**
 * Validates a product name/description.
 * Must be at least 3 characters of actual descriptive text.
 * Must NOT match non-product labels.
 */
export function isValidProductName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 3) return false;

  // Reject non-product labels
  if (isNonProductLabel(trimmed)) return false;

  // Reject if it's purely numeric (not a product name)
  if (/^\d+(\.\d+)?$/.test(trimmed)) return false;

  // Reject if it looks like a SAP code/reference rather than a description
  if (/^[A-Z]{1,4}:\s*/i.test(trimmed) && trimmed.length < 20) return false;

  return true;
}

/**
 * Validates a complete product row before it's accepted as a genuine product.
 * Returns null if valid, or a rejection reason string if invalid.
 */
export function validateProductRow(row: {
  sku: string;
  productName: string;
  mrp: number;
  rate: number;
  quantity: number;
  amount: number;
  freeQuantity?: number;
}): string | null {
  const freeQty = row.freeQuantity || 0;

  // Fast path: if SKU is in the Product Master, check paid or free quantity
  const masterSKUs = getProductMasterSKUs();
  if (masterSKUs.has(row.sku.trim().toUpperCase())) {
    if (row.quantity <= 0 && freeQty <= 0) {
      return `Invalid quantity: paid=${row.quantity}, free=${freeQty} — must have positive quantity`;
    }
    return null; // Known product, always valid
  }

  // SKU validation
  if (!isValidSKU(row.sku)) {
    return `Invalid SKU: "${row.sku}" — does not match SAP material code pattern`;
  }

  // Product name validation
  if (!isValidProductName(row.productName)) {
    return `Invalid product name: "${row.productName}" — matches non-product label or too short`;
  }

  // Quantity must be positive for paid or free goods
  if (row.quantity <= 0 && freeQty <= 0) {
    return `Invalid quantity: paid=${row.quantity}, free=${freeQty} — must have at least 1 paid or free piece`;
  }

  // Monetary check: if no free quantity, at least one price field should be positive
  if (freeQty <= 0 && row.mrp <= 0 && row.rate <= 0 && row.amount <= 0) {
    return `All monetary values are zero or negative (MRP=${row.mrp}, Rate=${row.rate}, Amount=${row.amount})`;
  }

  return null; // Valid
}

/**
 * Common SAP product-table header patterns used to detect the start of the item table.
 * These are matched case-insensitively against PDF lines.
 */
export const PRODUCT_TABLE_HEADERS: RegExp[] = [
  // Picklist-style headers
  /Sr\.?\s*No\.?\s+.*Material/i,
  /Sr\.?\s*No\.?\s+.*(?:SKU|Item|Product)/i,
  /Sr\.?\s*No\.?\s+.*Description/i,
  /S\.?\s*No\.?\s+.*Material/i,

  // Invoice-style headers
  /Sr\.?\s*No\.?\s+.*(?:Description|Product).*(?:MRP|Rate|Price)/i,
  /Sl\.?\s*No\.?\s+.*(?:Description|Product)/i,

  // Generic table header with known column names appearing together
  /Material\s+.*Description\s+.*(?:Qty|Quantity|MRP)/i,
  /(?:SKU|Item\s*Code|Material)\s+.*(?:Description|Name)\s+.*(?:MRP|Rate|Price)/i,
];

/**
 * Patterns that indicate the end of a product table section.
 */
export const TABLE_END_MARKERS: RegExp[] = [
  /^(?:Grand\s*)?Total/i,
  /^Sub\s*Total/i,
  /^Net\s*Amount/i,
  /^Net\s*Invoice/i,
  /^Gross\s*(?:Total|Amount)/i,
  /^Amount\s*(?:in\s*words|Payable)/i,
  /^Rounding\s*Off/i,
  /^CGST.*Total/i,
  /^SGST.*Total/i,
  /^Tax\s*Summary/i,
  /^E\.?\s*&\s*O\.?\s*E/i,
  /^Authorized\s*Signatory/i,
  /^Terms\s*/i,
  /^For\s+.*(?:Ltd|Pvt)/i,
  /^List\s*of\s*invoice/i,
];

/**
 * Checks if a line signals the start of the product table.
 */
export function isProductTableHeader(line: string): boolean {
  const normalized = normalizeText(line);
  return PRODUCT_TABLE_HEADERS.some(p => p.test(normalized));
}

/**
 * Checks if a line signals the end of the product table.
 */
export function isTableEndMarker(line: string): boolean {
  const normalized = normalizeText(line);
  return TABLE_END_MARKERS.some(p => p.test(normalized));
}
