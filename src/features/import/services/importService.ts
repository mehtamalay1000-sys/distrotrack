import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { ParsedPicklist, MatchResult } from '../parsers/types';
import { upsertPartyByCode } from '@/features/parties/services/partyService';
import { lookupProductBySku, upsertProductBySku } from '@/features/products/services/productService';
import { validateProductRow } from '../parsers/helpers';
import type { Picklist } from '@/lib/database.types';

/**
 * Commits a fully validated SAP import to Supabase database (or local store).
 * Creates Picklist, Picklist Items, Invoices, Invoice Items, Parties, Products, and Deliveries.
 */
export async function confirmImportToDatabase(
  picklist: ParsedPicklist,
  matchResult: MatchResult,
  assignedWorkerId?: string
): Promise<Picklist> {
  // 1. Ensure Route exists or get first active route
  let routeId: string | null = null;
  try {
    const { data: existingRoute } = await supabase
      .from('routes')
      .select('id')
      .eq('code', picklist.routeCode)
      .single();

    if (existingRoute) {
      routeId = existingRoute.id;
      if (assignedWorkerId) {
        await supabase
          .from('routes')
          .update({ assigned_worker_id: assignedWorkerId })
          .eq('id', routeId);
      }
    } else {
      const { data: newRoute } = await supabase
        .from('routes')
        .insert({
          code: picklist.routeCode || 'R-SAP',
          name: picklist.routeName || 'SAP Imported Route',
          assigned_worker_id: assignedWorkerId || null,
          status: 'active',
        })
        .select('id')
        .single();
      if (newRoute) routeId = newRoute.id;
    }
  } catch {
    const existingMock = mockStore.getRoutes().find((r) => r.code === picklist.routeCode);
    if (existingMock) {
      routeId = existingMock.id;
      if (assignedWorkerId) {
        mockStore.saveRoute({ id: routeId, assigned_worker_id: assignedWorkerId });
      }
    } else {
      const createdRoute = mockStore.saveRoute({
        code: picklist.routeCode || 'R-SAP',
        name: picklist.routeName || 'SAP Imported Route',
        assigned_worker_id: assignedWorkerId || null,
        status: 'active',
      });
      routeId = createdRoute.id;
    }
  }

  // 2. Create the Picklist record
  let picklistRecord: Picklist;
  try {
    const { data, error } = await supabase
      .from('picklists')
      .insert({
        picklist_number: picklist.picklistNumber,
        date: picklist.date,
        route_id: routeId,
        worker_id: assignedWorkerId || null,
        status: 'confirmed',
        total_amount: picklist.totalAmount,
        total_items: picklist.totalItems,
        notes: `Imported via SAP PDF. Matched ${matchResult.matchedCount} bills.`,
        sap_raw_data: JSON.stringify({ picklistNumber: picklist.picklistNumber, routeCode: picklist.routeCode }),
      })
      .select()
      .single();

    if (error || !data) {
      picklistRecord = mockStore.savePicklist({
        picklist_number: picklist.picklistNumber,
        date: picklist.date,
        route_id: routeId,
        worker_id: assignedWorkerId || null,
        status: 'confirmed',
        total_amount: picklist.totalAmount,
        total_items: picklist.totalItems,
        notes: `Imported via SAP PDF. Matched ${matchResult.matchedCount} bills.`,
      });
    } else {
      picklistRecord = data as Picklist;
      mockStore.savePicklist(data as Picklist);
    }
  } catch {
    picklistRecord = mockStore.savePicklist({
      picklist_number: picklist.picklistNumber,
      date: picklist.date,
      route_id: routeId,
      worker_id: assignedWorkerId || null,
      status: 'confirmed',
      total_amount: picklist.totalAmount,
      total_items: picklist.totalItems,
      notes: `Imported via SAP PDF. Matched ${matchResult.matchedCount} bills.`,
    });
  }

  // 3. Process Parties & Products & Deliveries
  for (const pair of matchResult.pairs) {
    if (!pair.partyCode) continue;

    const party = await upsertPartyByCode(pair.partyCode, pair.partyName, routeId || undefined);

    let invoiceId: string | null = null;
    if (pair.invoice) {
      try {
        const { data: invRecord } = await supabase
          .from('invoices')
          .insert({
            invoice_number: pair.invoice.invoiceNumber,
            picklist_id: picklistRecord.id,
            party_id: party.id,
            route_code: pair.invoice.routeCode || picklist.routeCode,
            sales_rep: pair.invoice.salesRep || null,
            date: pair.invoice.date || picklist.date,
            total_amount: pair.invoice.totalAmount,
            tax_amount: pair.invoice.taxAmount,
            net_amount: pair.invoice.netAmount,
            status: 'pending',
            sap_raw_data: pair.invoice.rawText,
          })
          .select('id')
          .single();

        if (invRecord) {
          invoiceId = invRecord.id;
          for (const item of pair.invoice.items) {
            // Validate product before upserting to database
            const validationError = validateProductRow({
              sku: item.sku,
              productName: item.productName,
              mrp: item.mrp,
              rate: item.rate,
              quantity: item.quantity,
              amount: item.amount,
            });
            if (validationError) {
              console.warn(`[IMPORT] Skipping invalid invoice item: ${validationError}`, item);
              continue;
            }

            // Lookup-first: find existing product by SKU, or create if validated
            let product = await lookupProductBySku(item.sku);
            if (product) {
              console.log(`[IMPORT] Invoice item: SKU ${item.sku} → matched Product Master "${product.name}"`);
            } else {
              console.log(`[IMPORT] Invoice item: SKU ${item.sku} → not in master, creating new product "${item.productName}"`);
              product = await upsertProductBySku(item.sku, item.productName, item.mrp, item.rate);
            }

            // Store document-specific MRP/rate/free_quantity on the line item, NOT on the product master
            await supabase.from('invoice_items').insert({
              invoice_id: invoiceId,
              product_id: product.id,
              sku: item.sku,
              product_name: item.productName,
              quantity: item.quantity,
              free_quantity: item.freeQuantity || 0,
              mrp: item.mrp,
              rate: item.rate,
              amount: item.amount,
              tax_amount: item.taxAmount,
            });
          }
        }
      } catch {
        // Continue fallback
      }
    }

    let seq = 0;
    if (pair.picklistParty) {
      for (const item of pair.picklistParty.items) {
        seq++;

        // Validate product before upserting to database
        const validationError = validateProductRow({
          sku: item.sku,
          productName: item.productName,
          mrp: item.rate, // picklist uses rate as MRP
          rate: item.rate,
          quantity: item.quantity,
          freeQuantity: item.freeQuantity,
          amount: item.amount,
        });
        if (validationError) {
          console.warn(`[IMPORT] Skipping invalid picklist item: ${validationError}`, item);
          continue;
        }

        // Lookup-first: find existing product by SKU, or create if validated
        let product = await lookupProductBySku(item.sku);
        if (product) {
          console.log(`[IMPORT] Picklist item: SKU ${item.sku} → matched Product Master "${product.name}"`);
        } else {
          console.log(`[IMPORT] Picklist item: SKU ${item.sku} → not in master, creating new product "${item.productName}"`);
          product = await upsertProductBySku(item.sku, item.productName, 0, item.rate);
        }

        // Store document-specific rate/qty/free_quantity/amount on the line item
        try {
          await supabase.from('picklist_items').insert({
            picklist_id: picklistRecord.id,
            party_id: party.id,
            product_id: product.id,
            sku: item.sku,
            product_name: item.productName,
            quantity: item.quantity,
            free_quantity: item.freeQuantity || 0,
            rate: item.rate,
            amount: item.amount,
          });
        } catch {
          // ignore
        }
        mockStore.savePicklistItem({
          picklist_id: picklistRecord.id,
          party_id: party.id,
          product_id: product.id,
          sku: item.sku,
          product_name: item.productName,
          quantity: item.quantity,
          free_quantity: item.freeQuantity || 0,
          rate: item.rate,
          amount: item.amount,
        });
      }
    }

    // Create delivery workload
    let deliveryId: string | null = null;
    try {
      const { data: delRecord } = await supabase.from('deliveries').insert({
        picklist_id: picklistRecord.id,
        party_id: party.id,
        worker_id: assignedWorkerId || null,
        invoice_id: invoiceId,
        status: 'pending',
        sequence_order: seq,
        total_amount: pair.picklistParty?.totalAmount || pair.invoice?.netAmount || 0,
        delivery_date: picklist.date,
        notes: `Generated from SAP Picklist ${picklist.picklistNumber}`,
      }).select('id').single();

      if (delRecord) deliveryId = delRecord.id;
    } catch {
      // Fallback
    }

    const mockDel = mockStore.saveDelivery({
      picklist_id: picklistRecord.id,
      party_id: party.id,
      worker_id: assignedWorkerId || null,
      invoice_id: invoiceId,
      status: 'pending',
      total_amount: pair.picklistParty?.totalAmount || pair.invoice?.netAmount || 0,
      delivery_date: picklist.date,
      notes: `Generated from SAP Picklist ${picklist.picklistNumber}`,
    });

    const targetDelId = deliveryId || mockDel.id;

    // Create delivery_items for worker delivery view (prefer invoice.items for exact bill match, fallback to picklistParty.items)
    const sourceItems = (pair.invoice?.items && pair.invoice.items.length > 0)
      ? pair.invoice.items
      : (pair.picklistParty?.items || []);

    for (const item of sourceItems) {
      try {
        await supabase.from('delivery_items').insert({
          delivery_id: targetDelId,
          sku: item.sku,
          product_name: item.productName,
          ordered_qty: item.quantity,
          delivered_qty: item.quantity,
          free_quantity: item.freeQuantity || 0,
          rate: item.rate,
          amount: item.amount,
        });
      } catch {
        // ignore
      }
      mockStore.saveDeliveryItem({
        delivery_id: targetDelId,
        sku: item.sku,
        product_name: item.productName,
        ordered_qty: item.quantity,
        delivered_qty: item.quantity,
        free_quantity: item.freeQuantity || 0,
        rate: item.rate,
        amount: item.amount,
      });
    }
  }

  return picklistRecord;
}
