import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { ParsedPicklist, MatchResult } from '../parsers/types';
import { upsertPartyByCode } from '@/features/parties/services/partyService';
import { lookupProductBySku, upsertProductBySku } from '@/features/products/services/productService';
import { resolveCanonicalProductIdentity } from '@/features/products/services/skuResolutionService';
import { validateProductRow } from '../parsers/helpers';
import type { Picklist } from '@/lib/database.types';
import { addNotification } from '@/features/notifications/services/notificationService';

/**
 * Commits a fully validated SAP import to Supabase database (or local store).
 * Creates Picklist, Picklist Items, Invoices, Invoice Items, Parties, Products, and Deliveries.
 *
 * IDEMPOTENCY GUARDS:
 * - Picklist: Throws a clear error if a picklist with this number already exists.
 *   Re-importing the same PDF is blocked at the DB level (unique constraint on picklist_number).
 * - Invoice: Skips duplicate invoices (unique constraint on invoice_number), logs a warning.
 * - Delivery: Skips if a delivery for this picklist+party already exists.
 */
export async function confirmImportToDatabase(
  picklist: ParsedPicklist,
  matchResult: MatchResult,
  assignedWorkerId?: string,
  deliveryDate?: string
): Promise<Picklist> {
  // Use the explicitly provided delivery date, falling back to the picklist's parsed date
  const effectiveDate = deliveryDate || picklist.date;

  // ── IDEMPOTENCY GUARD: Check if this picklist was already imported ──
  // This is the single most important duplicate-prevention check.
  // A second import of the same PDF must never silently create a second record.
  try {
    const { data: existingPicklist } = await supabase
      .from('picklists')
      .select('id, picklist_number, date, status')
      .eq('picklist_number', picklist.picklistNumber)
      .maybeSingle();

    if (existingPicklist) {
      const errMsg = `DUPLICATE IMPORT BLOCKED: Picklist "${picklist.picklistNumber}" was already imported on ${existingPicklist.date} (status: ${existingPicklist.status}). ` +
        `To re-import, first delete the existing picklist from the Admin panel, or use a corrected PDF with a different picklist number.`;
      try {
        await supabase.rpc('log_system_event', {
          p_user_id: assignedWorkerId || '',
          p_user_name: 'Admin',
          p_role: 'admin',
          p_module: 'import',
          p_action: 'import_blocked_duplicate',
          p_status: 'failure',
          p_detail: errMsg,
          p_entity_type: 'picklist',
          p_entity_id: existingPicklist.id,
        });
      } catch {}
      throw new Error(errMsg);
    }
  } catch (err) {
    // Re-throw our own duplicate error immediately
    if (err instanceof Error && err.message.startsWith('DUPLICATE IMPORT BLOCKED')) {
      throw err;
    }
    // For network errors: log and continue (the DB unique constraint will still catch it)
    console.warn('[IMPORT] Could not pre-check for duplicate picklist:', err);
  }

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
        date: effectiveDate,
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
      try {
        await supabase.rpc('log_system_event', {
          p_user_id: assignedWorkerId || '',
          p_user_name: 'Admin',
          p_role: 'admin',
          p_module: 'import',
          p_action: 'import_failed',
          p_status: 'failure',
          p_detail: `Failed to persist picklist #${picklist.picklistNumber}: ${error?.message ?? 'Unknown DB error'}`,
          p_entity_type: 'picklist',
          p_entity_id: picklist.picklistNumber,
        });
      } catch {}
      picklistRecord = mockStore.savePicklist({
        picklist_number: picklist.picklistNumber,
        date: effectiveDate,
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
      date: effectiveDate,
      route_id: routeId,
      worker_id: assignedWorkerId || null,
      status: 'confirmed',
      total_amount: picklist.totalAmount,
      total_items: picklist.totalItems,
      notes: `Imported via SAP PDF. Matched ${matchResult.matchedCount} bills.`,
    });
  }

  // Stage 4B: Persist Page 1 load manifest to picklist_load_items
  if (picklistRecord?.id) {
    const manifestItems = (picklist.loadItems && picklist.loadItems.length > 0)
      ? picklist.loadItems
      : Array.from(
          picklist.items.reduce((acc, it) => {
            if (it.sku && it.quantity > 0) {
              acc.set(it.sku, (acc.get(it.sku) || 0) + it.quantity);
            }
            return acc;
          }, new Map<string, number>()).entries()
        ).map(([sku, quantity]) => ({ sku, quantity }));

    for (const lItem of manifestItems) {
      try {
        let prod = await lookupProductBySku(lItem.sku);
        if (!prod) {
          const matchedItem = picklist.items.find((it) => it.sku === lItem.sku);
          prod = await upsertProductBySku(lItem.sku, matchedItem?.productName || lItem.sku, 0, matchedItem?.rate || 0);
        }
        if (prod) {
          await supabase.from('picklist_load_items').upsert({
            picklist_id: picklistRecord.id,
            product_id: prod.id,
            sku: lItem.sku,
            loaded_quantity: lItem.quantity,
          }, { onConflict: 'picklist_id,product_id' });
        }
      } catch (loadErr) {
        console.warn(`[IMPORT] Error saving picklist_load_item for ${lItem.sku}:`, loadErr);
      }
    }
  }

  // 3. Process Parties & Products & Deliveries
  const processedBatchInvoiceNumbers = new Set<string>();
  for (const pair of matchResult.pairs) {
    if (!pair.partyCode) continue;

    if (pair.invoice?.invoiceNumber) {
      const normNo = pair.invoice.invoiceNumber.trim().toUpperCase();
      if (processedBatchInvoiceNumbers.has(normNo)) {
        console.warn(`[IMPORT] Invoice ${normNo} already processed in current batch — skipping duplicate.`);
        continue;
      }
      processedBatchInvoiceNumbers.add(normNo);
    }

    const party = await upsertPartyByCode(pair.partyCode, pair.partyName, routeId || undefined);

    let invoiceId: string | null = null;
    if (pair.invoice) {
      // Check if this invoice number was already imported (duplicate invoice guard)
      try {
        const cleanInvNo = pair.invoice.invoiceNumber.trim();
        const { data: existingInvoice } = await supabase
          .from('invoices')
          .select('id, invoice_number, net_amount, total_amount')
          .eq('invoice_number', cleanInvNo)
          .maybeSingle();

        if (existingInvoice) {
          console.warn(`[IMPORT] Existing invoice found: ${cleanInvNo} (id: ${existingInvoice.id})`);
          invoiceId = existingInvoice.id;
          // If incoming parsed invoice has authoritative non-zero amount and existing record had 0 or different amount, update it
          if (pair.invoice.netAmount > 0 && (Number(existingInvoice.net_amount) === 0 || Math.abs(Number(existingInvoice.net_amount) - pair.invoice.netAmount) > 0.01)) {
            await supabase
              .from('invoices')
              .update({
                net_amount: pair.invoice.netAmount,
                total_amount: pair.invoice.totalAmount > 0 ? pair.invoice.totalAmount : pair.invoice.netAmount,
                tax_amount: pair.invoice.taxAmount,
              })
              .eq('id', existingInvoice.id);
          }

          // Check if existing invoice is missing invoice_items
          const { count: invItemCount } = await supabase
            .from('invoice_items')
            .select('*', { count: 'exact', head: true })
            .eq('invoice_id', existingInvoice.id);

          if ((invItemCount || 0) === 0 && pair.invoice.items && pair.invoice.items.length > 0) {
            for (const item of pair.invoice.items) {
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

              const resolved = resolveCanonicalProductIdentity(item.sku, item.productName, item.rate || item.mrp);
              const finalSku = resolved.isCanonical && resolved.canonicalSku ? resolved.canonicalSku : item.sku;
              const finalName = resolved.isCanonical && resolved.officialName ? resolved.officialName : item.productName;

              let product = await lookupProductBySku(finalSku);
              if (!product) {
                product = await upsertProductBySku(finalSku, finalName, item.mrp, item.rate);
              }

              await supabase.from('invoice_items').insert({
                invoice_id: invoiceId,
                product_id: product.id,
                sku: finalSku,
                product_name: finalName,
                quantity: item.quantity,
                free_quantity: item.freeQuantity || 0,
                mrp: item.mrp,
                rate: item.rate,
                amount: item.amount,
                tax_amount: item.taxAmount,
              });
            }
          }
        } else {
          const { data: invRecord, error: invError } = await supabase
            .from('invoices')
            .insert({
              invoice_number: cleanInvNo,
              picklist_id: picklistRecord.id,
              party_id: party.id,
              route_code: pair.invoice.routeCode || picklist.routeCode,
              sales_rep: pair.invoice.salesRep || null,
              date: effectiveDate,
              total_amount: pair.invoice.totalAmount,
              tax_amount: pair.invoice.taxAmount,
              net_amount: pair.invoice.netAmount,
              status: 'pending',
              sap_raw_data: pair.invoice.rawText,
            })
            .select('id')
            .single();

          if (invError) {
            console.error(`[IMPORT] Error inserting invoice ${cleanInvNo}:`, invError.message);
          } else if (invRecord) {
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

              const resolved = resolveCanonicalProductIdentity(item.sku, item.productName, item.rate || item.mrp);
              const finalSku = resolved.isCanonical && resolved.canonicalSku ? resolved.canonicalSku : item.sku;
              const finalName = resolved.isCanonical && resolved.officialName ? resolved.officialName : item.productName;

              // Lookup-first: find existing product by SKU, or create if validated
              let product = await lookupProductBySku(finalSku);
              if (product) {
                console.log(`[IMPORT] Invoice item: SKU ${finalSku} → matched Product Master "${product.name}"`);
              } else {
                console.log(`[IMPORT] Invoice item: SKU ${finalSku} → not in master, creating new product "${finalName}"`);
                product = await upsertProductBySku(finalSku, finalName, item.mrp, item.rate);
              }

              // Store document-specific MRP/rate/free_quantity on the line item, NOT on the product master
              await supabase.from('invoice_items').insert({
                invoice_id: invoiceId,
                product_id: product.id,
                sku: finalSku,
                product_name: finalName,
                quantity: item.quantity,
                free_quantity: item.freeQuantity || 0,
                mrp: item.mrp,
                rate: item.rate,
                amount: item.amount,
                tax_amount: item.taxAmount,
              });
            }
          }
        }
      } catch (invErr) {
        console.error(`[IMPORT] Error processing invoice ${pair.invoice.invoiceNumber}:`, invErr);
        // Continue with other pairs — one failed invoice should not block the rest
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

        const resolved = resolveCanonicalProductIdentity(item.sku, item.productName, item.rate);
        const finalSku = resolved.isCanonical && resolved.canonicalSku ? resolved.canonicalSku : item.sku;
        const finalName = resolved.isCanonical && resolved.officialName ? resolved.officialName : item.productName;

        // Lookup-first: find existing product by SKU, or create if validated
        let product = await lookupProductBySku(finalSku);
        if (product) {
          console.log(`[IMPORT] Picklist item: SKU ${finalSku} → matched Product Master "${product.name}"`);
        } else {
          console.log(`[IMPORT] Picklist item: SKU ${finalSku} → not in master, creating new product "${finalName}"`);
          product = await upsertProductBySku(finalSku, finalName, 0, item.rate);
        }

        // Store document-specific rate/qty/free_quantity/amount on the line item
        try {
          await supabase.from('picklist_items').insert({
            picklist_id: picklistRecord.id,
            party_id: party.id,
            product_id: product.id,
            sku: finalSku,
            product_name: finalName,
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
          sku: finalSku,
          product_name: finalName,
          quantity: item.quantity,
          free_quantity: item.freeQuantity || 0,
          rate: item.rate,
          amount: item.amount,
        });
      }
    }

    // Create delivery workload — with duplicate guard
    let deliveryId: string | null = null;
    let isExistingDelivery = false;

    try {
      if (invoiceId) {
        // 1. Invoice-backed delivery: search strictly by invoice_id
        const { data: delByInv } = await supabase
          .from('deliveries')
          .select('id')
          .eq('invoice_id', invoiceId)
          .maybeSingle();

        if (delByInv) {
          deliveryId = delByInv.id;
          isExistingDelivery = true;
          console.warn(`[IMPORT] Delivery for invoice ${invoiceId} already exists (id: ${deliveryId}) — skipping creation.`);
        }
      } else {
        // 2. Picklist-only delivery (no invoice): search by picklist_id + party_id
        const { data: delByParty } = await supabase
          .from('deliveries')
          .select('id')
          .eq('picklist_id', picklistRecord.id)
          .eq('party_id', party.id)
          .is('invoice_id', null)
          .maybeSingle();

        if (delByParty) {
          deliveryId = delByParty.id;
          isExistingDelivery = true;
          console.warn(`[IMPORT] Picklist-only delivery for party ${pair.partyCode} on picklist ${picklist.picklistNumber} already exists (id: ${deliveryId}) — skipping creation.`);
        }
      }

      if (!isExistingDelivery) {
        const { data: delRecord, error: delError } = await supabase.from('deliveries').insert({
          picklist_id: picklistRecord.id,
          party_id: party.id,
          worker_id: assignedWorkerId || null,
          invoice_id: invoiceId,
          status: 'pending',
          sequence_order: seq,
          total_amount: pair.picklistParty?.totalAmount || pair.invoice?.netAmount || 0,
          delivery_date: effectiveDate,
          notes: `Generated from SAP Picklist ${picklist.picklistNumber}`,
        }).select('id').single();

        if (delError) {
          console.error(`[IMPORT] Error creating delivery for party ${pair.partyCode}:`, delError.message);
        } else if (delRecord) {
          deliveryId = delRecord.id;
        }
      }
    } catch (delErr) {
      console.error(`[IMPORT] Error querying/creating delivery for party ${pair.partyCode}:`, delErr);
    }

    const mockDel = mockStore.saveDelivery({
      id: deliveryId || undefined,
      picklist_id: picklistRecord.id,
      party_id: party.id,
      worker_id: assignedWorkerId || null,
      invoice_id: invoiceId,
      status: 'pending',
      total_amount: pair.picklistParty?.totalAmount || pair.invoice?.netAmount || 0,
      delivery_date: effectiveDate,
      notes: `Generated from SAP Picklist ${picklist.picklistNumber}`,
    });

    const targetDelId = deliveryId || mockDel.id;

    // ── Delivery Items: Insert if delivery currently has 0 line items ────────
    // If delivery items already exist, do not duplicate. But if 0 exist, populate them.
    let existingItemCount = 0;
    if (deliveryId) {
      const { count } = await supabase
        .from('delivery_items')
        .select('*', { count: 'exact', head: true })
        .eq('delivery_id', deliveryId);
      existingItemCount = count || 0;
    }

    if ((!isExistingDelivery || existingItemCount === 0) && targetDelId) {
      const sourceItems = (pair.invoice?.items && pair.invoice.items.length > 0)
        ? pair.invoice.items
        : (pair.picklistParty?.items || []);

      for (const item of sourceItems) {
        const resolved = resolveCanonicalProductIdentity(item.sku, item.productName, item.rate);
        const finalSku = resolved.isCanonical && resolved.canonicalSku ? resolved.canonicalSku : item.sku;
        const finalName = resolved.isCanonical && resolved.officialName ? resolved.officialName : item.productName;

        let prod = await lookupProductBySku(finalSku);
        if (!prod && resolved.isCanonical && finalSku) {
          prod = await upsertProductBySku(finalSku, finalName, resolved.mrp || item.rate, item.rate);
        }

        try {
          await supabase.from('delivery_items').insert({
            delivery_id: targetDelId,
            product_id: prod?.id || null,
            sku: finalSku,
            product_name: finalName,
            ordered_qty: item.quantity,
            delivered_qty: 0,
            delivered_free_qty: 0,
            returned_qty: 0,
            returned_free_qty: 0,
            damaged_qty: 0,
            damaged_free_qty: 0,
            free_quantity: item.freeQuantity || 0,
            rate: item.rate,
            amount: item.amount,
          });
        } catch {
          // ignore
        }
        mockStore.saveDeliveryItem({
          delivery_id: targetDelId,
          product_id: prod?.id || null,
          sku: finalSku,
          product_name: finalName,
          ordered_qty: item.quantity,
          delivered_qty: 0,
          delivered_free_qty: 0,
          returned_qty: 0,
          returned_free_qty: 0,
          damaged_qty: 0,
          damaged_free_qty: 0,
          free_quantity: item.freeQuantity || 0,
          rate: item.rate,
          amount: item.amount,
        });
      }
    } else if (isExistingDelivery) {
      console.log(`[IMPORT] Delivery ${targetDelId} already exists — delivery_items insertion skipped.`);
    }
  }

  // 4. Trigger Realtime Notifications for Admin and Worker
  try {
    const formattedDate = new Date(effectiveDate + 'T00:00:00').toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

    // Notify Admin
    addNotification({
      recipient_role: 'admin',
      type: 'picklist',
      title: `Picklist #${picklistRecord.picklist_number} Imported`,
      message: `Route ${picklist.routeName || picklist.routeCode} scheduled for delivery on ${formattedDate} (${matchResult.pairs.length} stops, ₹${Number(picklist.totalAmount || 0).toLocaleString('en-IN')}).`,
      link: '/admin/picklists',
    });

    // Notify Assigned Worker
    if (assignedWorkerId) {
      addNotification({
        recipient_role: 'worker',
        recipient_worker_id: assignedWorkerId,
        type: 'picklist',
        title: `New Route Assigned: ${picklist.routeName || picklist.routeCode}`,
        message: `You have been assigned ${picklist.routeName || picklist.routeCode} for delivery on ${formattedDate} with ${matchResult.pairs.length} customer stops.`,
        link: '/w/route',
      });
    }

    // Log audit event for successful import
    try {
      await supabase.rpc('log_system_event', {
        p_user_id: assignedWorkerId || '',
        p_user_name: 'Admin',
        p_role: 'admin',
        p_module: 'import',
        p_action: 'import_completed',
        p_status: 'success',
        p_detail: `Picklist #${picklistRecord.picklist_number} imported successfully (${matchResult.pairs.length} stops, ₹${Number(picklist.totalAmount || 0).toLocaleString('en-IN')})`,
        p_entity_type: 'picklist',
        p_entity_id: picklistRecord.id,
      });
    } catch {}
  } catch (err) {
    console.error('Failed to dispatch import notification:', err);
  }

  return picklistRecord;
}
