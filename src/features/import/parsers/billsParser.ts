import {
  extractPDFText, normalizeText, parseNumber, normalizeCode,
  isProductTableHeader, isTableEndMarker, validateProductRow,
  isNonProductLabel, isValidSKU,
} from './helpers';
import { findProductMasterByDescription } from '@/features/products/data/productMaster';
import { getLocalDateString } from '@/shared/utils/format';
import type { ParsedBillsResult, ParsedInvoice, ParsedInvoiceItem } from './types';

/**
 * Parses multi-page SAP Bills PDF (TAX Invoices).
 * Accurately detects invoice boundaries across multi-page invoices using Invoice No. and Ret. Code.
 *
 * KEY FIX: Accurately parses Free Quantity from Qty columns before Gross Value float.
 * Prevents trailing line integers (Total EA/IP) from being erroneously misidentified as Free Qty.
 */
export async function parseBills(file: File): Promise<ParsedBillsResult> {
  const { pages, pageCount } = await extractPDFText(file);
  const warnings: string[] = [];
  const invoices: ParsedInvoice[] = [];

  let currentInvoice: ParsedInvoice | null = null;
  let inItemTable = false;

  console.log('[BILLS PARSER] === STARTING INVOICE PARSING ===');

  for (const page of pages) {
    console.log(`[BILLS PARSER] --- Scanning Page ${page.pageNumber} (${page.lines.length} lines) ---`);

    // Pre-extract page metadata so Bill To (which appears before Invoice No) is never lost
    let pageInvNo = '';
    let pageBillTo = '';
    let pageRetCode = '';
    let pageInvDate = '';
    let pageRoute = '';
    let pageSalesRep = '';

    for (let i = 0; i < page.lines.length; i++) {
      const l = normalizeText(page.lines[i]);
      const invM = l.match(/(?:Invoice\s*No\.?|Doc\s*No\.?)\s*[:.-]?\s*([A-Z0-9_-]{5,25})/i);
      if (invM && !pageInvNo) pageInvNo = invM[1].trim();

      const retM = l.match(/Ret\.?\s*Code\s*:?\s*([A-Z0-9]+)/i);
      if (retM && !pageRetCode) pageRetCode = normalizeCode(retM[1]);

      const dateM = l.match(/Invoice\s*Date\s*:\s*(\d{2}[\./-]\d{2}[\./-]\d{4})/i);
      if (dateM && !pageInvDate) {
        const parts = dateM[1].split(/[\./-]/);
        if (parts.length === 3) {
          pageInvDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      }

      const routeM = l.match(/Route\s*:\s*(.+)/i);
      if (routeM && !pageRoute) pageRoute = routeM[1].trim();

      const srM = l.match(/SalesRep\s*:\s*(.+)/i);
      if (srM && !pageSalesRep) pageSalesRep = srM[1].trim();

      const btM = l.match(/Bill\s*To\s*:\s*(.*)/i);
      if (btM && !pageBillTo) {
        let n = btM[1].replace(/_,,/g, '').trim();
        if (!n && i + 1 < page.lines.length) {
          n = normalizeText(page.lines[i + 1]).replace(/_,,/g, '').trim();
        }
        if (n && !/^tel:/i.test(n) && !/^gstin/i.test(n)) {
          pageBillTo = n;
        }
      }
    }

    for (let lineIdx = 0; lineIdx < page.lines.length; lineIdx++) {
      const rawLine = page.lines[lineIdx];
      const line = normalizeText(rawLine);

      // 1. Detect NEW Invoice Header
      // e.g. "Invoice No. : A37A506290" or "TAX Invoice"
      const invNoMatch = line.match(/(?:Invoice\s*No\.?|Doc\s*No\.?)\s*[:.-]?\s*([A-Z0-9_-]{5,25})/i);

      if (invNoMatch) {
        const invNo = invNoMatch[1].trim();

        // Check if this is the continuation page of the existing invoice
        if (currentInvoice && currentInvoice.invoiceNumber === invNo) {
          currentInvoice.pageCount++;
          if (!currentInvoice.partyName && pageBillTo) currentInvoice.partyName = pageBillTo;
          if (!currentInvoice.partyCode && pageRetCode) currentInvoice.partyCode = pageRetCode;
          console.log(`[BILLS PARSER] Continuation page for invoice ${invNo}`);
          inItemTable = false;
          // Don't 'continue' — fall through so the rest of this page's lines are processed
          // and the item table header can re-activate inItemTable = true

        }

        // Save previous invoice if exists
        if (currentInvoice) {
          invoices.push(finalizeInvoice(currentInvoice));
          console.log(`[BILLS PARSER] Finalized invoice ${currentInvoice.invoiceNumber} with ${currentInvoice.items.length} items`);
        }

        // Start new invoice object
        inItemTable = false;
        currentInvoice = {
          invoiceNumber: invNo,
          date: pageInvDate || getLocalDateString(),
          partyCode: pageRetCode || '',
          partyName: pageBillTo || '',
          routeCode: pageRoute || '',
          salesRep: pageSalesRep || '',
          items: [],
          totalAmount: 0,
          taxAmount: 0,
          netAmount: 0,
          pageCount: 1,
          rawText: line,
        };
        console.log(`[BILLS PARSER] New invoice started: ${invNo} for party "${pageBillTo}" (${pageRetCode})`);
        continue;
      }

      // 2. Extract Metadata & Lines for Current Invoice
      if (currentInvoice) {
        currentInvoice.rawText += '\n' + line;

        // Invoice Date
        const dateMatch = line.match(/Invoice\s*Date\s*:\s*(\d{2}[\./-]\d{2}[\./-]\d{4})/i);
        if (dateMatch) {
          const parts = dateMatch[1].split(/[\./-]/);
          if (parts.length === 3) {
            currentInvoice.date = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
        }

        // Customer / Retailer Code
        const retCodeMatch = line.match(/Ret\.?\s*Code\s*:?\s*([A-Z0-9]+)/i);
        if (retCodeMatch) {
          currentInvoice.partyCode = normalizeCode(retCodeMatch[1]);
        }

        // Bill To (Customer Name)
        const billToMatch = line.match(/Bill\s*To\s*:\s*(.*)/i);
        if (billToMatch && (!currentInvoice.partyName || currentInvoice.partyName === 'Unknown Customer')) {
          let name = billToMatch[1].replace(/_,,/g, '').trim();
          if (!name && lineIdx + 1 < page.lines.length) {
            name = normalizeText(page.lines[lineIdx + 1]).replace(/_,,/g, '').trim();
          }
          if (name && !/^tel:/i.test(name) && !/^gstin/i.test(name)) {
            currentInvoice.partyName = name;
          }
        }

        // Route & SalesRep
        const routeMatch = line.match(/Route\s*:\s*(.+)/i);
        if (routeMatch) currentInvoice.routeCode = routeMatch[1].trim();

        const srMatch = line.match(/SalesRep\s*:\s*(.+)/i);
        if (srMatch) currentInvoice.salesRep = srMatch[1].trim();

        // === ITEM TABLE BOUNDARY DETECTION ===
        if (!inItemTable) {
          if (isProductTableHeader(line)) {
            inItemTable = true;
            console.log(`[BILLS PARSER] Found item table header at page ${page.pageNumber}, line ${lineIdx + 1}: "${line}"`);
            continue;
          }

          // Alternative: detect first numbered item row
          const firstRowMatch = line.match(/^1\s+(.+?)\s+\d+(?:\.\d{2})\s+/);
          if (firstRowMatch) {
            const hasMultipleNumbers = (line.match(/\d+(?:\.\d{2})/g) || []).length >= 2;
            if (hasMultipleNumbers && !isNonProductLabel(line)) {
              inItemTable = true;
              console.log(`[BILLS PARSER] Inferred item table start at page ${page.pageNumber}, line ${lineIdx + 1}: "${line}"`);
            }
          }

          if (!inItemTable) continue;
        }

        // Detect table end
        if (isTableEndMarker(line)) {
          console.log(`[BILLS PARSER] Item table end at page ${page.pageNumber}, line ${lineIdx + 1}: "${line}"`);
          inItemTable = false;
        }

        // === PARSE LINE ITEMS (only when in item table) ===
        if (inItemTable) {
          // Skip non-product labels (e.g. HSN headers, tax labels)
          if (isNonProductLabel(line)) {
            console.log(`[BILLS PARSER] Skipping non-product label in table: "${line}"`);
            continue;
          }

          // Skip blank or very short lines
          if (line.length < 5) continue;

          // Skip page header repetitions
          if (/^page\s+\d/i.test(line) || /^colgate/i.test(line) || /^ZTIN/i.test(line)) {
            continue;
          }

          // Skip HSN summary lines like "0 HSN: 3306.10.20 0.00"
          if (/^0\s+HSN/i.test(line) || /\bHSN:\s*/i.test(line)) {
            console.log(`[BILLS PARSER] Skipping HSN header line: "${line}"`);
            continue;
          }

          let itemParsed = false;

          // Pattern A: SrNo + MaterialCode + Description + numbers...
          const patternA = line.match(/^(\d{1,3})\s+([A-Z0-9][A-Z0-9-]{4,11})\s+(.+)$/i);

          if (patternA && isValidSKU(patternA[2])) {
            const srNo = parseInt(patternA[1], 10);
            const sku = patternA[2].trim();
            const rest = patternA[3].trim();

            const parsed = parseItemFields(rest, sku, srNo, line);
            if (parsed) {
              const duplicate = currentInvoice.items.find(
                i => i.productName === parsed.productName && i.quantity === parsed.quantity && i.freeQuantity === parsed.freeQuantity
              );
              if (!duplicate) {
                currentInvoice.items.push(parsed);
                logParsedItem(parsed, line);
              }
              itemParsed = true;
            }
          }

          // Pattern B: Paid Item (SrNo + Description + MRP (.XX) + RateDoz (.XX) + remainder...)
          if (!itemParsed) {
            const patternB = line.match(/^(\d{1,3})\s+(.+?)\s+(\d{1,4}\.\d{2})\s+(\d{1,5}\.\d{2})\s+(.+)$/);

            if (patternB) {
              const srNo = parseInt(patternB[1], 10);
              const description = patternB[2].trim();
              const parsedMrp = parseNumber(patternB[3]);
              const rateDoz = parseNumber(patternB[4]);
              const remainder = patternB[5].trim();

              const numbers = remainder.match(/-?[\d]+(?:\.[\d]+)?/g) || [];

              if (srNo > 0 && description && numbers.length >= 2 && !isNonProductLabel(description)) {
                // Extract quantity tokens strictly BEFORE the first float value
                const { paidQty, freeQty } = extractQuantityTokens(remainder);
                const netAmt = parseNumber(numbers[numbers.length - 2]);

                // Resolve canonical SAP SKU, Name, and MRP from Product Master
                const masterMatch = findProductMasterByDescription(description);
                const finalSku = masterMatch?.sku || deriveSKUFromDescription(description, srNo);
                const finalName = masterMatch?.name || description;
                const finalMrp = masterMatch?.mrp || parsedMrp;

                const item: ParsedInvoiceItem = {
                  sku: finalSku,
                  productName: finalName,
                  quantity: paidQty > 0 ? paidQty : parseInt(numbers[numbers.length - 1], 10),
                  freeQuantity: freeQty,
                  mrp: finalMrp,
                  rate: rateDoz > 0 ? rateDoz / 12 : finalMrp,
                  amount: netAmt,
                  taxAmount: 0,
                };

                // Tax calculation
                if (numbers.length >= 6) {
                  const cgstAmt = parseNumber(numbers[numbers.length - 5]);
                  const sgstAmt = parseNumber(numbers[numbers.length - 3]);
                  if (cgstAmt > 0 && sgstAmt > 0) {
                    item.taxAmount = cgstAmt + sgstAmt;
                  }
                }

                const validationError = validateProductRow({
                  sku: item.sku,
                  productName: item.productName,
                  mrp: item.mrp,
                  rate: item.rate,
                  quantity: item.quantity,
                  freeQuantity: item.freeQuantity,
                  amount: item.amount,
                });

                if (validationError) {
                  console.log(`[BILLS PARSER] REJECTED ROW: "${line}"`);
                  console.log(`[BILLS PARSER]   Reason: ${validationError}`);
                } else {
                  const duplicate = currentInvoice.items.find(
                    i => i.productName === item.productName && i.quantity === item.quantity && i.freeQuantity === item.freeQuantity
                  );
                  if (!duplicate) {
                    currentInvoice.items.push(item);
                    logParsedItem(item, line);
                  }
                }
                itemParsed = true;
              }
            }
          }

          // Pattern C: Scheme Free Product Row (MRP = 0.00, Free Qty > 0)
          // e.g. "4 CMF B 42g 6Dz Prem 0.00 0 0 0 3 2.5 2.5 0"
          if (!itemParsed) {
            const patternC = line.match(/^(\d{1,3})\s+(.+?)\s+0\.00\s+(.+)$/);

            if (patternC) {
              const srNo = parseInt(patternC[1], 10);
              const description = patternC[2].trim();
              const remainder = patternC[3].trim();

              if (srNo > 0 && description && !isNonProductLabel(description)) {
                const { paidQty, freeQty } = extractQuantityTokens(remainder);

                if (freeQty > 0 || paidQty > 0) {
                  const masterMatch = findProductMasterByDescription(description);
                  const finalSku = masterMatch?.sku || deriveSKUFromDescription(description, srNo);
                  const finalName = masterMatch?.name || description;

                  const item: ParsedInvoiceItem = {
                    sku: finalSku,
                    productName: finalName,
                    quantity: paidQty,
                    freeQuantity: freeQty > 0 ? freeQty : (paidQty === 0 ? 1 : 0),
                    mrp: 0,
                    rate: 0,
                    amount: 0,
                    taxAmount: 0,
                  };

                  const validationError = validateProductRow({
                    sku: item.sku,
                    productName: item.productName,
                    mrp: 0,
                    rate: 0,
                    quantity: item.quantity,
                    freeQuantity: item.freeQuantity,
                    amount: 0,
                  });

                  if (validationError) {
                    console.log(`[BILLS PARSER] REJECTED FREE ROW: "${line}" → ${validationError}`);
                  } else {
                    const duplicate = currentInvoice.items.find(
                      i => i.productName === item.productName && i.freeQuantity === item.freeQuantity
                    );
                    if (!duplicate) {
                      currentInvoice.items.push(item);
                      logParsedItem(item, line);
                    }
                    itemParsed = true;
                  }
                }
              }
            }
          }

          if (!itemParsed && /^\d{1,3}\s+/.test(line)) {
            console.log(`[BILLS PARSER] Unmatched numbered row in table: "${line}"`);
          }
        }

        // Priority 1: Net Payable / Net Amount Payable / Grand Total / Total Payable (e.g. "Net Payable : 9471.00" or "Net Payable: 9471")
        const payableMatch = line.match(/(?:Net\s*Payable|Net\s*Amount\s*Payable|Grand\s*Total|Total\s*Payable)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i);
        if (payableMatch) {
          const val = parseNumber(payableMatch[1]);
          if (val > 0) {
            currentInvoice.netAmount = val;
            currentInvoice.totalAmount = val;
          }
        } else if (currentInvoice.netAmount === 0) {
          const invAmtMatch = line.match(/Net\s*Invoice\s*Amount\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                              line.match(/Net\s*Amount\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i);
          if (invAmtMatch) {
            const val = parseNumber(invAmtMatch[1]);
            if (val > 0) {
              currentInvoice.netAmount = val;
              currentInvoice.totalAmount = val;
            }
          }
        }
      }
    }
  }

  // Push final invoice
  if (currentInvoice) {
    invoices.push(finalizeInvoice(currentInvoice));
    console.log(`[BILLS PARSER] Finalized final invoice ${currentInvoice.invoiceNumber} with ${currentInvoice.items.length} items`);
  }

  const totalAmount = invoices.reduce((sum, inv) => sum + inv.netAmount, 0);

  console.log(`[BILLS PARSER] === PARSING COMPLETE ===`);
  console.log(`[BILLS PARSER] Total invoices: ${invoices.length}`);
  console.log(`[BILLS PARSER] Total items across all invoices: ${invoices.reduce((sum, inv) => sum + inv.items.length, 0)}`);
  invoices.forEach(inv => {
    console.log(`[BILLS PARSER] Invoice ${inv.invoiceNumber}: ${inv.items.length} items, net=${inv.netAmount}`);
    inv.items.forEach(item => {
      console.log(`[BILLS PARSER]   ${item.sku} | ${item.productName} | MRP=${item.mrp} | Rate=${item.rate} | Qty=${item.quantity} | FreeQty=${item.freeQuantity || 0} | Amt=${item.amount}`);
    });
  });

  return {
    invoices,
    pageCount,
    totalInvoices: invoices.length,
    totalAmount,
    warnings,
  };
}

/**
 * Extract paid quantity and free scheme quantity from SAP invoice item quantity fields.
 * Only inspects integers occurring BEFORE the first float value (Gross Value / Taxable Value / CGST%).
 * This prevents trailing line integers like Total EA/IP from being misidentified as Free Qty.
 */
function extractQuantityTokens(remainder: string): { paidQty: number; freeQty: number } {
  // Find where the first decimal number (e.g. 368.83 or 2.5) begins
  const match = remainder.match(/^([\d\s]+?)(?=\s+-?\d+\.\d+|\s*$)/);
  const qtyPrefix = match ? match[1].trim() : remainder.trim();
  const ints = qtyPrefix.split(/\s+/).filter(s => /^\d+$/.test(s)).map(s => parseInt(s, 10));

  let cs = 0, doz = 0, ea = 0, free = 0;

  if (ints.length >= 4) {
    cs = ints[0];
    doz = ints[1];
    ea = ints[2];
    free = ints[3];
  } else if (ints.length === 3) {
    cs = ints[0];
    doz = ints[1];
    ea = ints[2];
  } else if (ints.length === 2) {
    doz = ints[0];
    ea = ints[1];
  } else if (ints.length === 1) {
    ea = ints[0];
  }

  const paidQty = (cs * 144) + (doz * 12) + ea;
  return { paidQty, freeQty: free };
}

/**
 * Parse item fields from the remainder of a line.
 */
function parseItemFields(
  rest: string,
  sku: string,
  _srNo: number,
  rawLine: string
): ParsedInvoiceItem | null {
  const mrpSplit = rest.match(/^(.+?)\s+(\d+(?:\.\d{2}))\s+(\d+(?:\.\d{2}))\s+(.*)$/);

  if (!mrpSplit) return null;

  const productName = mrpSplit[1].trim();
  const mrp = parseNumber(mrpSplit[2]);
  const rateDoz = parseNumber(mrpSplit[3]);
  const remainder = mrpSplit[4].trim();

  const numbers = remainder.match(/-?[\d]+(?:\.[\d]+)?/g) || [];
  if (numbers.length < 2) return null;

  const { paidQty, freeQty } = extractQuantityTokens(remainder);
  const netAmt = parseNumber(numbers[numbers.length - 2]);

  const item: ParsedInvoiceItem = {
    sku,
    productName,
    quantity: paidQty > 0 ? paidQty : parseInt(numbers[numbers.length - 1], 10),
    freeQuantity: freeQty,
    mrp,
    rate: rateDoz > 0 ? rateDoz / 12 : mrp,
    amount: netAmt,
    taxAmount: 0,
  };

  if (numbers.length >= 6) {
    const cgstAmt = parseNumber(numbers[numbers.length - 5]);
    const sgstAmt = parseNumber(numbers[numbers.length - 3]);
    if (cgstAmt > 0 && sgstAmt > 0) {
      item.taxAmount = cgstAmt + sgstAmt;
    }
  }

  const validationError = validateProductRow({
    sku: item.sku,
    productName: item.productName,
    mrp: item.mrp,
    rate: item.rate,
    quantity: item.quantity,
    freeQuantity: item.freeQuantity,
    amount: item.amount,
  });

  if (validationError) {
    console.log(`[BILLS PARSER] REJECTED ROW: "${rawLine}"`);
    console.log(`[BILLS PARSER]   Reason: ${validationError}`);
    return null;
  }

  return item;
}

/**
 * Derives a meaningful SKU from the product description.
 */
function deriveSKUFromDescription(description: string, srNo: number): string {
  const words = description
    .replace(/[^A-Za-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0);

  if (words.length === 0) return `ITEM-${srNo}`;

  const parts = words.slice(0, 3).map(w => w.toUpperCase());
  return parts.join('-').slice(0, 15);
}

/**
 * Logs a successfully parsed item for debug output.
 */
function logParsedItem(item: ParsedInvoiceItem, rawLine: string): void {
  console.log(`[BILLS PARSER] RAW ROW: "${rawLine}"`);
  console.log(`[BILLS PARSER] PARSED:`);
  console.log(`[BILLS PARSER]   SKU: ${item.sku}`);
  console.log(`[BILLS PARSER]   PRODUCT NAME: ${item.productName}`);
  console.log(`[BILLS PARSER]   MRP: ${item.mrp}`);
  console.log(`[BILLS PARSER]   RATE: ${item.rate}`);
  console.log(`[BILLS PARSER]   QUANTITY: ${item.quantity}`);
  console.log(`[BILLS PARSER]   FREE QTY: ${item.freeQuantity || 0}`);
  console.log(`[BILLS PARSER]   AMOUNT: ${item.amount}`);
  console.log(`[BILLS PARSER]   TAX: ${item.taxAmount}`);
}

function finalizeInvoice(inv: ParsedInvoice): ParsedInvoice {
  if (inv.items.length > 0 && inv.netAmount === 0) {
    inv.netAmount = inv.items.reduce((sum, i) => sum + i.amount, 0);
  }
  if (inv.totalAmount === 0) {
    inv.totalAmount = inv.netAmount;
  }
  if (!inv.partyCode) inv.partyCode = 'UNKNOWN';
  if (!inv.partyName) inv.partyName = 'Unknown Customer';
  return inv;
}
