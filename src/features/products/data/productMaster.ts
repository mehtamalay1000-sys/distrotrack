/**
 * SAP Colgate-Palmolive Product Master — Canonical product reference data.
 *
 * This is the single authoritative source of truth for product identity in DistroTrack.
 * Material/SKU = unique product identity.
 * Material Description = official product display name.
 *
 * Sourced from the official Colgate-Palmolive Product Master export.
 */

import { RAW_SAP_PRODUCTS } from './sapCatalogData';

export interface ProductMasterEntry {
  sku: string;
  name: string;
  mrp: number;
  category: string;
  unit: string;
  brand?: string;
  uom?: string;
  active?: string;
  subCategory?: string;
  subBrand?: string;
  variant?: string;
  ppg?: string;
  ppgDescription?: string;
  materialGroup?: string;
  prodHierarchy?: string;
}

/** Default estimated MRP lookup map for standard pack sizes if not present on document */
const KNOWN_MRP_MAP: Record<string, number> = {
  '1600908': 150,
  '1600958': 79,
  '1601319': 145,
  '1601339': 78,
  '1602154': 93,
  '1602881': 84,
  '1608101': 71,
  '1608102': 123,
  '61002494': 220,
  '61010962': 81,
  '61029554': 73,
  '61031143': 79,
  '61031157': 160,
  '61037982': 50,
  '61041407': 160,
  '61045080': 80,
  '61046621': 170,
  '61046809': 210,
  '61050877': 208,
  '61050878': 135,
  '61050880': 103,
  '61050884': 73,
  '61055294': 99,
  '61058281': 20,
  '61058366': 372,
  '61058418': 30,
  '61059387': 120,
  '61059906': 20,
  '61059907': 20,
  '61060435': 180,
  '61060448': 180,
  '61061321': 116,
  '61064219': 220,
  '61064498': 73,
  '61064579': 83,
  '61065105': 360,
  '61065442': 290,
  '61066642': 120,
  'IN00749A': 99,
  'IN00808A': 89,
  'IN00991A': 144,
  'IN00992A': 160,
  'IN01003A': 164,
};

/**
 * All canonical SAP Colgate-Palmolive products.
 */
export const SAP_PRODUCT_MASTER: ProductMasterEntry[] = RAW_SAP_PRODUCTS.map((entry) => {
  const cleanSku = String(entry.sku || '').trim();
  const cleanName = String(entry.name || '').trim();
  const rawCat = String(entry.category || '').trim();
  const brand = String(entry.brand || '').trim() || 'Colgate';
  const uom = String(entry.uom || '').trim() || 'EA';

  // Format category to readable string
  let category = 'Oral Care';
  if (rawCat.includes('Personal Care') || rawCat.startsWith('20')) {
    category = 'Personal Care';
  } else if (rawCat.includes('Home Care') || rawCat.startsWith('30')) {
    category = 'Home Care';
  } else if (rawCat.includes('Oral Care') || rawCat.startsWith('10')) {
    category = 'Oral Care';
  } else if (entry.subCategory?.includes('Toothpaste')) {
    category = 'Toothpaste';
  } else if (entry.subCategory?.includes('TB') || entry.subCategory?.includes('Toothbrush')) {
    category = 'Toothbrush';
  }

  const mrp = KNOWN_MRP_MAP[cleanSku] || 50;

  return {
    sku: cleanSku,
    name: cleanName,
    mrp,
    category,
    unit: uom.toLowerCase() === 'doz' ? 'doz' : uom.toLowerCase() === 'cs' ? 'cs' : 'pcs',
    brand,
    uom,
    active: entry.active || '',
    subCategory: entry.subCategory || '',
    subBrand: entry.subBrand || '',
    variant: entry.variant || '',
    ppg: entry.ppg || '',
    ppgDescription: entry.ppgDescription || '',
    materialGroup: entry.materialGroup || '',
    prodHierarchy: entry.prodHierarchy || '',
  };
});

// Fast lookup index structures
const SKU_MAP = new Map<string, ProductMasterEntry>();
const UNPADDED_SKU_MAP = new Map<string, ProductMasterEntry>();
const MASTER_SKU_SET = new Set<string>();

for (const p of SAP_PRODUCT_MASTER) {
  const norm = p.sku.toUpperCase();
  SKU_MAP.set(norm, p);
  MASTER_SKU_SET.add(norm);

  const unpadded = norm.replace(/^0+/, '');
  if (unpadded && !UNPADDED_SKU_MAP.has(unpadded)) {
    UNPADDED_SKU_MAP.set(unpadded, p);
  }
}

/**
 * Pure lookup by SKU / Material code — returns canonical SAP Product Master entry or undefined.
 * Does NOT guess or create fake products.
 */
export function findProductMasterEntry(sku: string): ProductMasterEntry | undefined {
  if (!sku) return undefined;
  const normalized = sku.trim().toUpperCase();
  if (SKU_MAP.has(normalized)) return SKU_MAP.get(normalized);

  const unpadded = normalized.replace(/^0+/, '');
  if (unpadded && UNPADDED_SKU_MAP.has(unpadded)) {
    return UNPADDED_SKU_MAP.get(unpadded);
  }

  return undefined;
}

/**
 * Returns the official SAP Material Description for display in the Worker & Admin portals.
 * If SKU is unmapped, returns the optional fallback or original SKU.
 */
export function getOfficialProductName(sku: string, fallback?: string): string {
  const entry = findProductMasterEntry(sku);
  return entry?.name ?? fallback ?? sku;
}

/**
 * Lookup by description (fuzzy / substring matching).
 * Used when resolving legacy or OCR-parsed product lines that omit the Material code.
 */
export function findProductMasterByDescription(desc: string): ProductMasterEntry | undefined {
  if (!desc) return undefined;
  const normDesc = desc.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normDesc) return undefined;

  // 1. Exact normalized name match
  for (const p of SAP_PRODUCT_MASTER) {
    const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (pNorm === normDesc) return p;
  }

  // 2. Prefix / startsWith match
  for (const p of SAP_PRODUCT_MASTER) {
    const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (pNorm.startsWith(normDesc) || (normDesc.length > 8 && normDesc.startsWith(pNorm))) {
      return p;
    }
  }

  // 3. Known keyword match
  const dNorm = desc.toLowerCase();
  for (const p of SAP_PRODUCT_MASTER) {
    const pNorm = p.name.toLowerCase();
    if (dNorm.includes('actsalt') && pNorm.includes('actsalt')) return p;
    if (dNorm.includes('cibaca 175') && pNorm.includes('cibaca 175')) return p;
    if (dNorm.includes('cdc 100') && pNorm.includes('cdc 100')) return p;
    if (dNorm.includes('cdc 150') && pNorm.includes('cdc 150')) return p;
    if (dNorm.includes('cdc 200') && pNorm.includes('cdc 200') && !pNorm.includes('100')) return p;
    if (dNorm.includes('total ah 80') && pNorm.includes('total ah 80')) return p;
  }

  return undefined;
}

/**
 * Get all product master SKUs as a Set for fast membership checks.
 */
export function getProductMasterSKUs(): Set<string> {
  return MASTER_SKU_SET;
}
