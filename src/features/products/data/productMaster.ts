/**
 * SAP Colgate Product Master — Canonical product reference data.
 *
 * This is the single source of truth for product identity. Each entry represents
 * a real SAP product with its canonical SKU, description, MRP, and category.
 *
 * The import pipeline uses this to look up products by SKU or description.
 * Document-specific MRP/rate values are stored on picklist/invoice line items.
 */

export interface ProductMasterEntry {
  sku: string;
  name: string;
  mrp: number;
  category: string;
  unit: string;
}

/**
 * Derive product category from the product name/description.
 */
function inferCategory(name: string): string {
  const n = name.toLowerCase();

  // Toothpaste
  if (
    n.includes('tpst') || n.includes('tpdr') || n.includes('toothpaste') ||
    n.includes('cdc ') || n.includes('total ah') ||
    n.includes('visible white') || n.includes('sensitive') ||
    n.includes('actsalt') || n.includes('herbal') || n.includes('herb ') ||
    n.includes('cibaca') || n.includes('cib ') || n.includes('pain out') ||
    n.includes('cmf ') || n.includes('maxfresh') || n.includes('max fresh') ||
    n.includes('swarna') || n.includes('col tp')
  ) {
    return 'Toothpaste';
  }

  // Toothbrush
  if (
    n.includes('tbr') || n.includes('toothbrush') || n.includes('tb ') ||
    n.includes('supflex') || n.includes('super flexi') || n.includes('sup flex') ||
    n.includes('zz ') || n.includes('sf ') ||
    n.includes('kids tp') || n.includes('kids sup') || n.includes('kids 2+')
  ) {
    return 'Toothbrush';
  }

  // Combo/Bundle
  if (
    n.includes('+') || n.includes('bundle') || n.includes('combo') ||
    n.includes('pack of') || n.includes('promo') || n.includes('hanger')
  ) {
    return 'Combo Pack';
  }

  return 'Oral Care';
}

/**
 * The 43 canonical SAP Colgate products from the current sample Picklist.
 */
export const SAP_PRODUCT_MASTER: ProductMasterEntry[] = [
  { sku: '1600908',  name: 'Col ActSalt Tpst200',                          mrp: 150,  category: '', unit: 'pcs' },
  { sku: '1600958',  name: 'ColActSalt Tpst100g',                          mrp: 79,   category: '', unit: 'pcs' },
  { sku: '1601319',  name: 'Col TPdr. 200 gms',                            mrp: 145,  category: '', unit: 'pcs' },
  { sku: '1601339',  name: 'Col TPdr. 100 gms',                            mrp: 78,   category: '', unit: 'pcs' },
  { sku: '1602154',  name: 'Col Herb Tpst 100gm',                          mrp: 93,   category: '', unit: 'pcs' },
  { sku: '1602881',  name: 'Pain Out - Tube',                              mrp: 84,   category: '', unit: 'pcs' },
  { sku: '1608101',  name: 'Cibaca 175 g',                                 mrp: 71,   category: '', unit: 'pcs' },
  { sku: '1608102',  name: 'Cibaca 175G+175G',                             mrp: 123,  category: '', unit: 'pcs' },
  { sku: '61002494', name: 'SupFlex Char 10+2 M',                          mrp: 220,  category: '', unit: 'pcs' },
  { sku: '61010962', name: 'Col ZZ PO3 M',                                 mrp: 81,   category: '', unit: 'pcs' },
  { sku: '61029554', name: 'CMF Red 70g+15% Extra',                        mrp: 73,   category: '', unit: 'pcs' },
  { sku: '61031143', name: 'Colgate MaxFresh Charcoal 65g',                 mrp: 79,   category: '', unit: 'pcs' },
  { sku: '61031157', name: 'Colgate MaxFresh Charcoal 130g',                mrp: 160,  category: '', unit: 'pcs' },
  { sku: '61037982', name: 'Super Flexi PO3 S',                            mrp: 50,   category: '', unit: 'pcs' },
  { sku: '61041407', name: 'Colgate Sensitive Pack of 4+ Toothpaste',       mrp: 160,  category: '', unit: 'pcs' },
  { sku: '61045080', name: 'TOTAL AH 80g',                                 mrp: 80,   category: '', unit: 'pcs' },
  { sku: '61046621', name: 'Visible White Purple 100g + 20%',              mrp: 170,  category: '', unit: 'pcs' },
  { sku: '61046809', name: 'Visible White 100g + 20%',                     mrp: 210,  category: '', unit: 'pcs' },
  { sku: '61050877', name: 'CDC 200+100+Tbr NF',                           mrp: 208,  category: '', unit: 'pcs' },
  { sku: '61050878', name: 'CDC 200 NF',                                   mrp: 135,  category: '', unit: 'pcs' },
  { sku: '61050880', name: 'CDC 150 NF',                                   mrp: 103,  category: '', unit: 'pcs' },
  { sku: '61050884', name: 'CDC 100 NF',                                   mrp: 73,   category: '', unit: 'pcs' },
  { sku: '61055294', name: 'Kids TP 40g SB - 6 Dz',                        mrp: 99,   category: '', unit: 'pcs' },
  { sku: '61058281', name: 'CMF 42g 6+1 (CMF 20 free) Bundle',             mrp: 20,   category: '', unit: 'pcs' },
  { sku: '61058366', name: 'Col TB Sens 6+2 BST',                          mrp: 372,  category: '', unit: 'pcs' },
  { sku: '61058418', name: 'Cibaca Rs 30 73g',                             mrp: 30,   category: '', unit: 'pcs' },
  { sku: '61059387', name: 'CDC 18g 12+1 Sleeve NF',                       mrp: 120,  category: '', unit: 'pcs' },
  { sku: '61059906', name: 'CMF B 42g 6Dz Premia',                         mrp: 20,   category: '', unit: 'pcs' },
  { sku: '61059907', name: 'CDC 40g NF 12 +1 CMF 20B/R',                   mrp: 20,   category: '', unit: 'pcs' },
  { sku: '61060435', name: 'Kids 2+ 6+1 UP Hanger',                        mrp: 180,  category: '', unit: 'pcs' },
  { sku: '61060448', name: 'Kids Sup Junior 9+3',                          mrp: 180,  category: '', unit: 'pcs' },
  { sku: '61061321', name: 'Colgate Sensitive 80g',                         mrp: 116,  category: '', unit: 'pcs' },
  { sku: '61064219', name: 'SF 11+2ZZ Char + CMF 10_M',                    mrp: 220,  category: '', unit: 'pcs' },
  { sku: '61064498', name: 'CMF Red 81g + Extra Clean TBR Promo',           mrp: 73,   category: '', unit: 'pcs' },
  { sku: '61064579', name: 'CMF Blue 81g + Extra Clean TBR Promo',          mrp: 83,   category: '', unit: 'pcs' },
  { sku: '61065105', name: 'Cib Supreme 12 + 1 ZZ',                        mrp: 360,  category: '', unit: 'pcs' },
  { sku: '61065442', name: 'ZZ (7) + ZZ ch (2) + GS (3) (M)',              mrp: 290,  category: '', unit: 'pcs' },
  { sku: '61066642', name: 'CMF 20g 12+1 Trade Promo (Slv)',               mrp: 120,  category: '', unit: 'pcs' },
  { sku: 'IN00749A', name: 'Kids TP 40g BF',                               mrp: 99,   category: '', unit: 'pcs' },
  { sku: 'IN00808A', name: 'Col Swarna VS 100g',                           mrp: 89,   category: '', unit: 'pcs' },
  { sku: 'IN00991A', name: 'CMF Red 150g - 8 doz case',                    mrp: 144,  category: '', unit: 'pcs' },
  { sku: 'IN00992A', name: 'CMF Blue 150g - 8 dz case',                    mrp: 160,  category: '', unit: 'pcs' },
  { sku: 'IN01003A', name: 'Col Herbal 200g - 8 dz',                       mrp: 164,  category: '', unit: 'pcs' },
].map(entry => ({
  ...entry,
  category: inferCategory(entry.name),
}));

/**
 * Lookup a product from the master by SKU.
 */
export function findProductMasterEntry(sku: string): ProductMasterEntry | undefined {
  const normalized = sku.trim().toUpperCase();
  return SAP_PRODUCT_MASTER.find(p => p.sku.toUpperCase() === normalized);
}

/**
 * Look up a product from the master by description (fuzzy / substring matching).
 * Resolves real SAP SKU and MRP even if PDF line only contains product description.
 */
export function findProductMasterByDescription(desc: string): ProductMasterEntry | undefined {
  const normDesc = desc.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normDesc) return undefined;

  // 1. Try exact normalized match
  let found = SAP_PRODUCT_MASTER.find(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normDesc);
  if (found) return found;

  // 2. Try prefix / startsWith match
  found = SAP_PRODUCT_MASTER.find(p => {
    const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return pNorm.startsWith(normDesc) || normDesc.startsWith(pNorm);
  });
  if (found) return found;

  // 3. Try key word matching (e.g. "Cibaca 175", "CDC 100", "TOTAL AH 80")
  found = SAP_PRODUCT_MASTER.find(p => {
    const pNorm = p.name.toLowerCase();
    const dNorm = desc.toLowerCase();
    if (dNorm.includes('cibaca 175') && pNorm.includes('cibaca 175')) return true;
    if (dNorm.includes('cdc 100') && pNorm.includes('cdc 100')) return true;
    if (dNorm.includes('cdc 150') && pNorm.includes('cdc 150')) return true;
    if (dNorm.includes('cdc 200') && pNorm.includes('cdc 200') && !pNorm.includes('100')) return true;
    if (dNorm.includes('total ah 80') && pNorm.includes('total ah 80')) return true;
    if (dNorm.includes('cdc 18g') && pNorm.includes('cdc 18g')) return true;
    if (dNorm.includes('cdc 40g') && pNorm.includes('cdc 40g')) return true;
    if (dNorm.includes('cmf b 42g') && pNorm.includes('cmf b 42g')) return true;
    if (dNorm.includes('cmf 42g') && pNorm.includes('cmf 42g')) return true;
    if (dNorm.includes('cib supreme') && pNorm.includes('cib supreme')) return true;
    if (dNorm.includes('zz (7)') && pNorm.includes('zz (7)')) return true;
    if (dNorm.includes('sf 11+2zz') && pNorm.includes('sf 11+2zz')) return true;
    if (dNorm.includes('col tb sens') && pNorm.includes('col tb sens')) return true;
    if (dNorm.includes('col swarna') && pNorm.includes('col swarna')) return true;
    if (dNorm.includes('cmf blue 150g') && pNorm.includes('cmf blue 150g')) return true;
    if (dNorm.includes('cmf red 150g') && pNorm.includes('cmf red 150g')) return true;
    if (dNorm.includes('col herbal 200g') && pNorm.includes('col herbal 200g')) return true;
    if (dNorm.includes('colgate sensitive pac') && pNorm.includes('colgate sensitive pack')) return true;
    return false;
  });

  return found;
}

/**
 * Get all product master SKUs as a Set for fast lookup.
 */
export function getProductMasterSKUs(): Set<string> {
  return new Set(SAP_PRODUCT_MASTER.map(p => p.sku.toUpperCase()));
}
