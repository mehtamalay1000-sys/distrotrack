/**
 * Authoritative Centralized SKU Resolution Engine
 *
 * Implements DistroTrack Business Rules:
 * RULE A: Canonical product identity is SAP Material Number / Article Number / SKU (NOT Product Name/Description/Brand).
 * RULE B: sku and product_name / description must remain strictly separate fields.
 * RULE D: Authoritative inventory ledger MUST NEVER receive sku = NULL or fake description-as-SKU.
 */

import {
  findProductMasterEntry,
  findSapReferenceCatalog,
  getProductMasterSKUs,
  SAP_PRODUCT_MASTER,
  SAP_MRP_CATALOG,
  type ProductMasterEntry,
} from '@/features/products/data/productMaster';
import { RAW_SAP_PRODUCTS } from '@/features/products/data/sapCatalogData';
import { HISTORICAL_SALES_CATALOG } from '@/features/products/data/historicalSalesCatalog';

export interface ResolvedProductIdentity {
  canonicalSku: string | null;
  officialName: string;
  mrp: number;
  isCanonical: boolean;
  unresolved: boolean;
  source?: 'product_master' | 'sap_reference' | 'historical' | 'sap_format' | 'description_resolution' | 'unresolved';
}

/**
 * Normalizes text for reliable comparison (lowercase, alphanumeric characters only).
 */
export function normalizeProductText(text: string | null | undefined): string {
  if (!text) return '';
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Known product brand/description tokens that must NEVER be accepted as SKUs.
 */
const FORBIDDEN_SKU_WORDS = new Set([
  'CIBACA',
  'COLGATE',
  'TOTAL',
  'VISIBLE',
  'SUPER',
  'COLACTSALT',
  'SUPFLEX',
  'ACTIVE',
  'MAXFRESH',
  'TOOTHPASTE',
  'TOOTHPWDR',
  'CHARCOAL',
  'SENSITIVE',
  'SWARNA',
  'HERBAL',
  'VEDSHAKTI',
  'ZIGZAG',
  'SLIMSOFT',
  'KIDS',
  'CDC',
  'CMF',
  'SF',
  'ZZ',
]);

/**
 * Determines whether a string is a genuine SAP Material Number / SKU.
 */
export function isCanonicalSkuFormat(sku: string | null | undefined): boolean {
  if (!sku) return false;
  const trimmed = sku.trim().toUpperCase();
  if (trimmed.length < 3 || trimmed.length > 30) return false;

  // Reject known description words
  if (FORBIDDEN_SKU_WORDS.has(trimmed)) return false;

  // Pure letters with no digits (unless in Product Master) cannot be an SAP Material Number
  if (/^[A-Z]+$/.test(trimmed) && !getProductMasterSKUs().has(trimmed)) {
    return false;
  }

  // Exact match in active Product Master
  if (getProductMasterSKUs().has(trimmed)) return true;

  // Known SAP Reference Catalog SKU
  if (findSapReferenceCatalog(trimmed)) return true;

  // Derived / system formats
  if (/^COL-[A-Z0-9-]+$/i.test(trimmed)) return true;
  if (/^ITEM-\d+$/i.test(trimmed)) return true;

  // Numeric SAP Material code: 6 to 10 digits (e.g. 1600908, 1608101, 1608102, 61058418)
  if (/^\d{6,10}$/.test(trimmed)) return true;

  // IN-code SAP format: IN followed by 4-6 digits and a letter (e.g. IN00991A, IN00749A)
  if (/^IN\d{4,6}[A-Z]$/i.test(trimmed)) return true;

  // Reject customer codes (C000..., S000...)
  if (/^[CS]0{2,}\d+$/i.test(trimmed)) return false;

  // Reject invoice numbers (e.g. A37A506290)
  if (/^[A-Z]\d{2}[A-Z]\d{6,}$/i.test(trimmed)) return false;

  // Reject pure tax/doc codes
  if (/^(ZTIN|ZORA|ZORD|GSTIN|TAX|INVOICE|TOTAL)$/i.test(trimmed)) return false;

  return false;
}

/**
 * Resolves a product description to a canonical SAP SKU and official display name.
 */
export function resolveSkuFromDescription(description: string): ProductMasterEntry | null {
  if (!description) return null;
  const norm = normalizeProductText(description);
  if (!norm) return null;

  // 1. Check Active Product Master (exact normalized name)
  for (const p of SAP_PRODUCT_MASTER) {
    if (normalizeProductText(p.name) === norm) return p;
  }

  // 2. Check Official SAP Reference Catalog (exact normalized name)
  const rawExact = RAW_SAP_PRODUCTS.find((p) => normalizeProductText(p.name) === norm);
  if (rawExact) {
    const ref = findSapReferenceCatalog(rawExact.sku);
    if (ref) return ref;
    return {
      sku: rawExact.sku,
      name: rawExact.name,
      mrp: (SAP_MRP_CATALOG as Record<string, number>)[rawExact.sku] || 0,
      category: rawExact.category || 'Oral Care',
      unit: rawExact.uom || 'pcs',
    };
  }

  // 3. Check Historical Sales Catalog (exact normalized name)
  const histExact = HISTORICAL_SALES_CATALOG.find((p) => normalizeProductText(p.product_name) === norm);
  if (histExact) {
    const ref = findSapReferenceCatalog(histExact.sku);
    return {
      sku: histExact.sku,
      name: histExact.product_name,
      mrp: ref?.mrp || (SAP_MRP_CATALOG as Record<string, number>)[histExact.sku] || Math.round(Number(histExact.latest_rate || 0) * 1.15),
      category: histExact.category || 'Oral Care',
      unit: histExact.uom || 'pcs',
    };
  }

  // 4. Prefix / Truncated Name Match (for OCR/PDF truncated lines, e.g. "Visible White Purple 1")
  if (norm.length >= 8) {
    const rawPrefix = RAW_SAP_PRODUCTS.find((p) => {
      const pNorm = normalizeProductText(p.name);
      return pNorm.startsWith(norm) || (norm.length > 10 && norm.startsWith(pNorm));
    });
    if (rawPrefix) {
      const ref = findSapReferenceCatalog(rawPrefix.sku);
      if (ref) return ref;
      return {
        sku: rawPrefix.sku,
        name: rawPrefix.name,
        mrp: (SAP_MRP_CATALOG as Record<string, number>)[rawPrefix.sku] || 0,
        category: rawPrefix.category || 'Oral Care',
        unit: rawPrefix.uom || 'pcs',
      };
    }

    const histPrefix = HISTORICAL_SALES_CATALOG.find((p) => {
      const pNorm = normalizeProductText(p.product_name);
      return pNorm.startsWith(norm) || (norm.length > 10 && norm.startsWith(pNorm));
    });
    if (histPrefix) {
      const ref = findSapReferenceCatalog(histPrefix.sku);
      return {
        sku: histPrefix.sku,
        name: histPrefix.product_name,
        mrp: ref?.mrp || (SAP_MRP_CATALOG as Record<string, number>)[histPrefix.sku] || Math.round(Number(histPrefix.latest_rate || 0) * 1.15),
        category: histPrefix.category || 'Oral Care',
        unit: histPrefix.uom || 'pcs',
      };
    }
  }

  return null;
}

/**
 * Authoritative Centralized SKU & Product Identity Resolution.
 *
 * Used uniformly across:
 * - Picklist matching
 * - Bills / Invoices parsing
 * - Delivery creation
 * - Worker delivery validation & submission
 * - Ledger & inventory movement creation
 */
export function resolveCanonicalProductIdentity(
  rawSku?: string | null,
  rawName?: string | null,
  rateOrMrp?: number | null
): ResolvedProductIdentity {
  const cleanSku = String(rawSku ?? '').trim();
  const cleanName = String(rawName ?? '').trim();

  // Case 1: Check if rawSku is a genuine canonical SKU
  if (isCanonicalSkuFormat(cleanSku)) {
    // Look up in Product Master
    const master = findProductMasterEntry(cleanSku);
    if (master) {
      return {
        canonicalSku: master.sku,
        officialName: master.name,
        mrp: master.mrp,
        isCanonical: true,
        unresolved: false,
        source: 'product_master',
      };
    }

    // Look up in SAP Reference Catalog
    const ref = findSapReferenceCatalog(cleanSku);
    if (ref) {
      return {
        canonicalSku: ref.sku,
        officialName: ref.name,
        mrp: ref.mrp,
        isCanonical: true,
        unresolved: false,
        source: 'sap_reference',
      };
    }

    // Canonical format, but not yet inwarded/mastered: preserve canonical SKU
    return {
      canonicalSku: cleanSku,
      officialName: cleanName || cleanSku,
      mrp: Number(rateOrMrp) || 0,
      isCanonical: true,
      unresolved: false,
      source: 'sap_format',
    };
  }

  // Case 2: rawSku is NOT a valid SKU (e.g. "Cibaca", pure description word, or empty)
  // Formulate full description candidate
  let searchDesc = cleanName;
  if (cleanSku && FORBIDDEN_SKU_WORDS.has(cleanSku.toUpperCase())) {
    searchDesc = cleanName ? `${cleanSku} ${cleanName}` : cleanSku;
  } else if (!searchDesc && cleanSku) {
    searchDesc = cleanSku;
  }

  if (searchDesc) {
    const resolved = resolveSkuFromDescription(searchDesc);
    if (resolved && resolved.sku) {
      return {
        canonicalSku: resolved.sku,
        officialName: resolved.name,
        mrp: resolved.mrp || Number(rateOrMrp) || 0,
        isCanonical: true,
        unresolved: false,
        source: 'description_resolution' as const,
      };
    }
  }

  // Case 3: Genuine Unresolved Product Identity
  // DO NOT fabricate pseudo-SKUs. DO NOT allow description-as-SKU.
  return {
    canonicalSku: null,
    officialName: cleanName || cleanSku || 'UNRESOLVED PRODUCT',
    mrp: Number(rateOrMrp) || 0,
    isCanonical: false,
    unresolved: true,
    source: 'unresolved',
  };
}
