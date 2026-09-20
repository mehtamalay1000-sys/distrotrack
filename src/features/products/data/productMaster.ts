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
export const KNOWN_MRP_MAP: Record<string, number> = {
  '1600908': 150,
  '1600958': 75,
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
export const SAP_MRP_CATALOG = KNOWN_MRP_MAP;

/**
 * Active Product Master catalog entries.
 * Starts empty and is populated organically by real SAP Purchase / Goods Receipt imports.
 */
export const SAP_PRODUCT_MASTER: ProductMasterEntry[] = [];

/**
 * Optional static SAP reference catalog dictionary.
 * Used ONLY as a reference dictionary for metadata enrichment (e.g. category, brand)
 * when an unmapped SKU is imported from SAP, strictly without pre-populating the active Product Master.
 */
const SAP_REFERENCE_CATALOG = new Map<string, ProductMasterEntry>();

for (const entry of RAW_SAP_PRODUCTS) {
  const cleanSku = String(entry.sku || '').trim();
  if (!cleanSku) continue;
  const cleanName = String(entry.name || '').trim();
  const rawCat = String(entry.category || '').trim();
  const brand = String(entry.brand || '').trim() || 'Colgate';
  const uom = String(entry.uom || '').trim() || 'EA';

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

  const refItem: ProductMasterEntry = {
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

  SAP_REFERENCE_CATALOG.set(cleanSku.toUpperCase(), refItem);
  const unpadded = cleanSku.toUpperCase().replace(/^0+/, '');
  if (unpadded && !SAP_REFERENCE_CATALOG.has(unpadded)) {
    SAP_REFERENCE_CATALOG.set(unpadded, refItem);
  }
}

/**
 * Pure reference dictionary lookup from official SAP reference catalog.
 * Does NOT indicate that the product exists in active Product Master.
 */
export function findSapReferenceCatalog(sku: string): ProductMasterEntry | undefined {
  if (!sku) return undefined;
  const norm = sku.trim().toUpperCase();
  if (SAP_REFERENCE_CATALOG.has(norm)) return SAP_REFERENCE_CATALOG.get(norm);
  const unpadded = norm.replace(/^0+/, '');
  if (unpadded && SAP_REFERENCE_CATALOG.has(unpadded)) {
    return SAP_REFERENCE_CATALOG.get(unpadded);
  }
  return undefined;
}

/**
 * Returns total count of canonical products in official SAP reference catalog.
 */
export function getCanonicalSapCatalogCount(): number {
  return RAW_SAP_PRODUCTS.length;
}

// Fast lookup index structures for ACTIVE OPERATIONAL PRODUCT MASTER ONLY
const SKU_MAP = new Map<string, ProductMasterEntry>();
const UNPADDED_SKU_MAP = new Map<string, ProductMasterEntry>();
const MASTER_SKU_SET = new Set<string>();

/**
 * Resets the in-memory Product Master lookup maps and catalog array to empty.
 */
export function resetProductMasterMemory(): void {
  SKU_MAP.clear();
  UNPADDED_SKU_MAP.clear();
  MASTER_SKU_SET.clear();
  SAP_PRODUCT_MASTER.length = 0;
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

  // 1. Exact normalized name match in active Product Master
  for (const p of SAP_PRODUCT_MASTER) {
    const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (pNorm === normDesc) return p;
  }

  // 2. Exact normalized name match in SAP Reference Catalog
  for (const entry of RAW_SAP_PRODUCTS) {
    const pNorm = (entry.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (pNorm === normDesc && entry.sku) {
      const ref = findSapReferenceCatalog(entry.sku);
      if (ref) return ref;
    }
  }

  // 3. Prefix / startsWith match in active Product Master
  for (const p of SAP_PRODUCT_MASTER) {
    const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (pNorm.startsWith(normDesc) || (normDesc.length > 8 && normDesc.startsWith(pNorm))) {
      return p;
    }
  }

  // 4. Prefix / startsWith match in SAP Reference Catalog
  for (const entry of RAW_SAP_PRODUCTS) {
    const pNorm = (entry.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((pNorm.startsWith(normDesc) || (normDesc.length > 8 && normDesc.startsWith(pNorm))) && entry.sku) {
      const ref = findSapReferenceCatalog(entry.sku);
      if (ref) return ref;
    }
  }

  // 5. Specific keyword matches (strictly discriminating pack variants)
  const dNorm = desc.toLowerCase();
  for (const p of SAP_PRODUCT_MASTER) {
    const pNorm = p.name.toLowerCase();
    if (dNorm.includes('actsalt') && pNorm.includes('actsalt')) return p;
    if (dNorm.includes('cibaca 175g+175g') && pNorm.includes('175g+175g')) return p;
    if (dNorm.includes('cibaca 175') && !dNorm.includes('+') && pNorm.includes('cibaca 175') && !pNorm.includes('+')) return p;
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

/**
 * Register a newly imported or added Product Master entry dynamically.
 * Updates in-memory lookup sets and maps so subsequent lookups resolve immediately.
 */
export function registerProductMasterEntry(entry: ProductMasterEntry): void {
  if (!entry || !entry.sku) return;
  const norm = entry.sku.trim().toUpperCase();
  SKU_MAP.set(norm, entry);
  MASTER_SKU_SET.add(norm);

  const unpadded = norm.replace(/^0+/, '');
  if (unpadded) {
    UNPADDED_SKU_MAP.set(unpadded, entry);
  }

  const existingIdx = SAP_PRODUCT_MASTER.findIndex((p) => p.sku.toUpperCase() === norm);
  if (existingIdx >= 0) {
    SAP_PRODUCT_MASTER[existingIdx] = entry;
  } else {
    SAP_PRODUCT_MASTER.push(entry);
  }
}

/**
 * Update the current MRP of a Product Master entry dynamically.
 * Updates in-memory lookup maps and SAP_PRODUCT_MASTER entry.
 */
export function updateProductMasterMrp(sku: string, newMrp: number): boolean {
  if (!sku || typeof newMrp !== 'number') return false;
  const entry = findProductMasterEntry(sku);
  if (!entry) return false;
  entry.mrp = newMrp;
  return true;
}

