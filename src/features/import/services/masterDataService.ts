import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { ParsedPartyRow, ParsedProductRow } from '../parsers/salesExcelParser';
import type { Party, Product } from '@/lib/database.types';

export interface BulkUpsertResult {
  partiesCreated: number;
  partiesSkipped: number;
  productsCreated: number;
  productsSkipped: number;
  errors: string[];
}

export type ProgressCallback = (current: number, total: number, label: string) => void;

/**
 * Bulk-upsert parties and products into Supabase.
 * Uses existing upsert-by-code/sku logic to avoid duplicates.
 */
export async function bulkSeedMasterData(
  parties: ParsedPartyRow[],
  products: ParsedProductRow[],
  onProgress?: ProgressCallback
): Promise<BulkUpsertResult> {
  const result: BulkUpsertResult = {
    partiesCreated: 0,
    partiesSkipped: 0,
    productsCreated: 0,
    productsSkipped: 0,
    errors: [],
  };

  const total = parties.length + products.length;
  let current = 0;

  // ── Upsert Parties ─────────────────────────────────────────────

  for (const party of parties) {
    current++;
    onProgress?.(current, total, `Party: ${party.name}`);

    try {
      // Check if party already exists by code
      const { data: existing } = await supabase
        .from('parties')
        .select('id')
        .eq('code', party.code)
        .single();

      if (existing) {
        result.partiesSkipped++;
        continue;
      }

      // Insert new party
      const { data, error } = await supabase
        .from('parties')
        .insert({
          code: party.code,
          name: party.name,
          city: party.city || null,
          outstanding_amount: 0,
          status: 'active',
        })
        .select()
        .single();

      if (error) {
        // May be a unique constraint violation (race condition)
        if (error.code === '23505') {
          result.partiesSkipped++;
        } else {
          result.errors.push(`Party ${party.code}: ${error.message}`);
          // Fallback to mock store
          mockStore.saveParty({
            code: party.code,
            name: party.name,
            city: party.city || undefined,
          });
          result.partiesCreated++;
        }
      } else if (data) {
        mockStore.saveParty(data as Party);
        result.partiesCreated++;
      }
    } catch (err) {
      // Offline / network error fallback
      mockStore.saveParty({
        code: party.code,
        name: party.name,
        city: party.city || undefined,
      });
      result.partiesCreated++;
    }
  }

  // ── Upsert Products ────────────────────────────────────────────

  for (const product of products) {
    current++;
    onProgress?.(current, total, `Product: ${product.name}`);

    try {
      // Check if product already exists by SKU
      const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('sku', product.sku)
        .single();

      if (existing) {
        result.productsSkipped++;
        continue;
      }

      // Insert new product
      const { data, error } = await supabase
        .from('products')
        .insert({
          sku: product.sku,
          name: product.name,
          category: product.category || null,
          mrp: 0,
          rate: 0,
          unit: 'pcs',
          status: 'active',
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          result.productsSkipped++;
        } else {
          result.errors.push(`Product ${product.sku}: ${error.message}`);
          mockStore.saveProduct({
            sku: product.sku,
            name: product.name,
            category: product.category || undefined,
          });
          result.productsCreated++;
        }
      } else if (data) {
        mockStore.saveProduct(data as Product);
        result.productsCreated++;
      }
    } catch (err) {
      mockStore.saveProduct({
        sku: product.sku,
        name: product.name,
        category: product.category || undefined,
      });
      result.productsCreated++;
    }
  }

  return result;
}
