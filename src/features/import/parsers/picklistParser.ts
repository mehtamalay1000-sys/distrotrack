import {
  extractPDFText, normalizeText, parseNumber, normalizeCode,
  isProductTableHeader, isTableEndMarker, validateProductRow,
  isNonProductLabel, isValidSKU,
} from './helpers';
import type { ParsedPicklist, ParsedPicklistParty, ParsedPicklistItem } from './types';

/**
 * Parses Colgate SAP Picklist PDF across all pages.
 * Supports Pick List header metadata, aggregate product list (Page 1), and invoice reference table (Page 3).
 *
 * KEY FIX: Uses table-boundary detection to only parse genuine product rows from the
 * actual product table section. Rejects invoice metadata, tax rows, totals, headers,
 * customer info, and other non-product data via shared validation.
 */
export async function parsePicklist(file: File): Promise<ParsedPicklist> {
  const { pages, fullText, pageCount } = await extractPDFText(file);
  const warnings: string[] = [];

  let picklistNumber = '';
  let date = new Date().toISOString().split('T')[0];
  let routeCode = '';
  let routeName = '';
  let salesRep = '';
  let totalValueFromHeader = 0;

  // 1. Scan headers across all pages for Pick List Number, Date, Route, SalesRep
  for (const page of pages) {
    for (const rawLine of page.lines) {
      const line = normalizeText(rawLine);

      // Pick List Number
      if (!picklistNumber) {
        const plMatch = line.match(/Pick\s*List\s*Number\s*:\s*([A-Z0-9_-]+)/i) ||
                        line.match(/(?:Picklist|Pick List|DOC)\s*[:.-]?\s*([A-Z0-9_-]{4,20})/i);
        if (plMatch) picklistNumber = plMatch[1].trim();
      }

      // Billing Date / Date
      const dateMatch = line.match(/(?:Billing\s*Date|Date\/Time|Date)\s*[:.-]?\s*(\d{2}[\./-]\d{2}[\./-]\d{4})/i);
      if (dateMatch) {
        const rawDate = dateMatch[1];
        const parts = rawDate.split(/[\./-]/);
        if (parts.length === 3) {
          // DD.MM.YYYY -> YYYY-MM-DD
          date = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      }

      // Route
      if (!routeCode) {
        const rMatch = line.match(/Route\s*:\s*(.+)/i);
        if (rMatch) {
          const rawRoute = rMatch[1].trim();
          routeCode = rawRoute.replace(/\s+/g, '_').toUpperCase();
          routeName = rawRoute;
        }
      }

      // SalesRep
      if (!salesRep) {
        const srMatch = line.match(/SalesRep\s*:\s*([A-Za-z0-9 ]+)/i);
        if (srMatch) salesRep = srMatch[1].trim();
      }

      // Header totals
      const valMatch = line.match(/Total\s*Value\s*:\s*([\d,]+\.\d{2})/i);
      if (valMatch) totalValueFromHeader = parseNumber(valMatch[1]);
    }
  }

  if (!picklistNumber) {
    picklistNumber = `W${Date.now().toString().slice(-7)}`;
    warnings.push('Picklist number not found in PDF header; generated fallback number.');
  }

  // 2. Extract Customer Parties & Invoices from Page 3 ("List of invoice with reference")
  const partyMap = new Map<string, ParsedPicklistParty>();
  let inInvoiceTable = false;

  for (const page of pages) {
    for (let lineIdx = 0; lineIdx < page.lines.length; lineIdx++) {
      const rawLine = page.lines[lineIdx];
      let line = normalizeText(rawLine);

      if (line.toLowerCase().includes('list of invoice with reference')) {
        inInvoiceTable = true;
        console.log(`[PICKLIST PARSER] Invoice reference table start detected on page ${page.pageNumber}`);
        continue;
      }

      if (inInvoiceTable) {
        // Table end check
        if (/^grand\s*total/i.test(line) || /^total\s*value/i.test(line)) {
          console.log(`[PICKLIST PARSER] Invoice reference table end detected on page ${page.pageNumber}: "${line}"`);
          inInvoiceTable = false;
          continue;
        }

        // Multiline customer row joiner:
        // If line starts with "SrNo S... C...", but invoice number & totals wrapped onto next line (e.g. wrapped "(WALZADE) A37A506295...")
        if (
          /^\d{1,3}\s+[A-Z0-9]{6,14}\s+[A-Z0-9]{6,14}/.test(line) &&
          !/[A-Z0-9]{6,15}\s+[\d\s.-]+$/.test(line) &&
          lineIdx + 1 < page.lines.length
        ) {
          const nextLine = normalizeText(page.lines[lineIdx + 1]);
          if (/[A-Z0-9]{6,15}\s+[\d\s.-]+$/.test(nextLine) || /^\(/.test(nextLine)) {
            line = `${line} ${nextLine}`;
            lineIdx++; // skip joined next line
          }
        }

        // Match invoice table row:
        // Pattern 1: SrNo + ShipTo (S...) + CustomerCode (C...) + Party Name + InvoiceNo (A37...) + numeric values...
        // e.g. "1 S000022228 C000727249 RAJESH KIRANA A37A506290 1542.85 -24.20 0.00 75.94 1594.59 0.00 0.00 1595.00"
        let custCode = '';
        let custName = '';
        let invoiceNo = '';
        let netPayable = 0;

        const invRowMatch = line.match(/^(\d{1,3})\s+([A-Z0-9]{6,14})\s+([A-Z0-9]{6,14})\s+(.+?)\s+([A-Z0-9]{6,15})\s+([\d\s.-]+)$/);
        if (invRowMatch) {
          custCode = normalizeCode(invRowMatch[3]);
          custName = invRowMatch[4].trim();
          invoiceNo = invRowMatch[5];
          const numTokens = invRowMatch[6].trim().match(/-?[\d]+(?:\.[\d]+)?/g) || [];
          netPayable = numTokens.length > 0 ? parseNumber(numTokens[numTokens.length - 1]) : 0;
        } else {
          // Pattern 2: SrNo + [Optional SalesRep S...] + CustomerCode (C...) + Party Name + InvoiceNo + numbers
          const invRowMatch2 = line.match(/^(\d{1,3})\s+(?:[A-Z0-9]{6,14}\s+)?([C][A-Z0-9]{6,12})\s+(.+?)\s+([A-Z0-9]{6,15})\s+([\d\s.-]+)$/i);
          if (invRowMatch2) {
            custCode = normalizeCode(invRowMatch2[2]);
            custName = invRowMatch2[3].trim();
            invoiceNo = invRowMatch2[4];
            const numTokens = invRowMatch2[5].trim().match(/-?[\d]+(?:\.[\d]+)?/g) || [];
            netPayable = numTokens.length > 0 ? parseNumber(numTokens[numTokens.length - 1]) : 0;
          }
        }

        // Clean any leading Customer Code that got stuck in custName
        if (/^[CS]\d{6,12}\s+/i.test(custName)) {
          const parts = custName.split(/\s+/);
          const realCode = normalizeCode(parts[0]);
          const realName = parts.slice(1).join(' ').trim();
          if (realName) {
            custCode = realCode;
            custName = realName;
          }
        }

        // Ensure party is recorded with canonical party name (never a customer code)
        if (custCode && custName && !custName.toLowerCase().includes('total') && !/^[CS]0*\d+$/i.test(custName)) {
          if (!partyMap.has(custCode)) {
            partyMap.set(custCode, {
              partyCode: custCode,
              partyName: custName,
              items: [],
              totalAmount: netPayable,
            });
            console.log(`[PICKLIST PARSER] Extracted Party: ${custCode} - "${custName}" (Invoice ${invoiceNo}, Net ₹${netPayable})`);
          } else {
            const party = partyMap.get(custCode)!;
            if (netPayable > 0) party.totalAmount = netPayable;
            if (custName && (!party.partyName || /^[CS]0*\d+$/i.test(party.partyName))) {
              party.partyName = custName;
            }
          }
        }
      }
    }
  }

  // 3. Extract aggregate Product Picking List with table-boundary detection
  const allItems: ParsedPicklistItem[] = [];
  const rejectedRows: string[] = [];

  console.log('[PICKLIST PARSER] === STARTING PRODUCT TABLE EXTRACTION ===');

  for (const page of pages) {
    let inProductTable = false;
    let tableHeaderFound = false;

    console.log(`[PICKLIST PARSER] --- Scanning Page ${page.pageNumber} (${page.lines.length} lines) ---`);

    for (let lineIdx = 0; lineIdx < page.lines.length; lineIdx++) {
      const rawLine = page.lines[lineIdx];
      const line = normalizeText(rawLine);

      // Detect product table header
      if (!inProductTable) {
        // Look for the table header row containing column names like
        // "Sr.No Material Description MRP ..." or similar SAP picklist table headers
        if (isProductTableHeader(line)) {
          inProductTable = true;
          tableHeaderFound = true;
          console.log(`[PICKLIST PARSER] Found table header at page ${page.pageNumber}, line ${lineIdx + 1}: "${line}"`);
          continue;
        }

        // Alternative: detect the start of numbered product rows without explicit header
        // If we see a line that starts with "1 " followed by a valid-looking SKU,
        // this is likely the first product row (some SAP PDFs omit explicit headers on continuation pages)
        const firstRowMatch = line.match(/^1\s+([A-Z0-9]{6,12})\s+/i);
        if (firstRowMatch && isValidSKU(firstRowMatch[1])) {
          // Verify this looks like a product row by checking for numeric values after the text
          const hasNumericValues = /\d+\.\d{2}/.test(line);
          if (hasNumericValues) {
            inProductTable = true;
            console.log(`[PICKLIST PARSER] Inferred table start at page ${page.pageNumber}, line ${lineIdx + 1} (first numbered row): "${line}"`);
            // Don't continue; process this line as a product row below
          }
        }

        if (!inProductTable) continue;
      }

      // Check for table end markers
      if (isTableEndMarker(line)) {
        console.log(`[PICKLIST PARSER] Table end marker at page ${page.pageNumber}, line ${lineIdx + 1}: "${line}"`);
        inProductTable = false;
        continue;
      }

      // Skip blank lines within the table
      if (!line.trim()) continue;

      // Skip lines that are clearly non-product content within the table region
      if (isNonProductLabel(line)) {
        console.log(`[PICKLIST PARSER] Skipping non-product label: "${line}"`);
        continue;
      }

      // Skip lines that look like continuation of invoice reference table headers
      if (/list\s*of\s*invoice/i.test(line)) {
        inProductTable = false;
        continue;
      }

      // Skip page header repetitions (e.g. "Page 2", company name, date)
      if (/^page\s+\d/i.test(line) || /^colgate/i.test(line)) {
        continue;
      }

      // === Parse Product Row ===
      // SAP Picklist product rows typically follow this structure:
      // SrNo  MaterialCode  Description  MRP  [packaging cols]  [qty cols...]  TotalQty
      //
      // Examples from code comments:
      // "1 1600908 Col ActSalt Tpst200 150.00 - - 6 - 6 - - - - 6"
      // "9 61002494 SupFlex Char 10+2 M 220.00 - - 1 - 1 - - - - 1"
      // "41 IN00991A CMF Red 150g - 8 doz case 144.00 - 2 9 - 33 - - - - 33"

      // Strategy: Match serial number + SKU code first, then extract remaining fields.
      // The product description can contain spaces, numbers, special chars — so we use
      // column-based parsing rather than one giant regex.

      const itemMatch = line.match(/^(\d{1,3})\s+([A-Z0-9][A-Z0-9-]{4,11})\s+(.+)$/i);

      if (itemMatch) {
        const srNo = parseInt(itemMatch[1], 10);
        const sku = itemMatch[2].trim();
        const rest = itemMatch[3].trim();

        if (srNo <= 0 || !isValidSKU(sku)) {
          console.log(`[PICKLIST PARSER] Skipping row (invalid srNo/SKU): "${line}"`);
          continue;
        }

        // Parse the remaining part: Description + MRP + [various qty columns] + TotalQty
        // The description ends where the first decimal number (MRP) or a dash pattern begins.
        // We look for the pattern: "description text  123.00  [- or digits]... totalQty"

        // Extract numbers and dashes from the 'rest' portion
        // Find the MRP (first number with exactly 2 decimal places) and everything after
        const mrpSplit = rest.match(/^(.+?)\s+(\d+(?:\.\d{2}))\s+(.*)$/);

        let productName = '';
        let mrp = 0;
        let totalQty = 0;
        let category: string | undefined;

        if (mrpSplit) {
          productName = mrpSplit[1].trim();
          mrp = parseNumber(mrpSplit[2]);

          // The last number in the remaining portion is the total quantity
          const trailingParts = mrpSplit[3].trim();
          const numbers = trailingParts.match(/\d+/g);
          if (numbers && numbers.length > 0) {
            totalQty = parseInt(numbers[numbers.length - 1], 10);
          }
        } else {
          // Fallback: try to extract without MRP (some rows may not have MRP)
          // Look for the product name followed by just quantity numbers
          const fallbackMatch = rest.match(/^(.+?)\s+([\d-]+(?:\s+[\d-]+)*)$/);
          if (fallbackMatch) {
            productName = fallbackMatch[1].trim();
            const numbers = fallbackMatch[2].match(/\d+/g);
            if (numbers && numbers.length > 0) {
              totalQty = parseInt(numbers[numbers.length - 1], 10);
            }
          } else {
            productName = rest;
          }
        }

        // Check if product name contains a category prefix like "10120:Toothpaste"
        // within the description — if so, extract it as category
        const categoryInName = productName.match(/(\d{4,6}:\S+)\s*/);
        if (categoryInName) {
          category = categoryInName[1];
          productName = productName.replace(categoryInName[0], '').trim();
        }

        // Also check if product name accidentally contains packaging info
        // like "- 8 doz case" at the end — clean it but keep the meaningful description
        productName = productName.replace(/\s*-\s*\d+\s+(?:doz|case|box|pcs|pack)\s*$/i, '').trim();

        // Validate the parsed product row
        const validationError = validateProductRow({
          sku,
          productName,
          mrp,
          rate: mrp, // picklist uses MRP as rate
          quantity: totalQty,
          amount: mrp * totalQty,
        });

        if (validationError) {
          console.log(`[PICKLIST PARSER] REJECTED ROW: "${line}"`);
          console.log(`[PICKLIST PARSER]   Reason: ${validationError}`);
          rejectedRows.push(`${line} → ${validationError}`);
          continue;
        }

        // Check for duplicate item (continuation page)
        const existingItem = allItems.find(i => i.sku === sku && i.quantity === totalQty);
        if (existingItem) {
          console.log(`[PICKLIST PARSER] Skipping duplicate: ${sku} qty=${totalQty}`);
          continue;
        }

        const item: ParsedPicklistItem = {
          partyCode: 'AGGREGATE',
          partyName: 'Picking List Overall',
          sku,
          productName,
          category,
          quantity: totalQty,
          rate: mrp,
          amount: mrp * totalQty,
          rawText: line,
        };
        allItems.push(item);

        console.log(`[PICKLIST PARSER] RAW ROW: "${line}"`);
        console.log(`[PICKLIST PARSER] PARSED:`);
        console.log(`[PICKLIST PARSER]   SKU: ${sku}`);
        console.log(`[PICKLIST PARSER]   PRODUCT NAME: ${productName}`);
        console.log(`[PICKLIST PARSER]   CATEGORY: ${category || '(none)'}`);
        console.log(`[PICKLIST PARSER]   MRP: ${mrp}`);
        console.log(`[PICKLIST PARSER]   QUANTITY: ${totalQty}`);
        console.log(`[PICKLIST PARSER]   AMOUNT: ${mrp * totalQty}`);
      }
    }

    // If no explicit table header was found on this page but we're in a continuation,
    // the table state resets per page — products on continuation pages are detected
    // by the "first numbered row" heuristic above
    if (!tableHeaderFound && allItems.length === 0) {
      console.log(`[PICKLIST PARSER] No product table header found on page ${page.pageNumber}`);
    }
  }

  console.log(`[PICKLIST PARSER] === RAW PRODUCT TABLE TEXT ===`);
  allItems.forEach(item => {
    console.log(`[PICKLIST PARSER]   ${item.rawText}`);
  });
  console.log(`[PICKLIST PARSER] TOTAL VALID PRODUCTS: ${allItems.length}`);
  if (rejectedRows.length > 0) {
    console.log(`[PICKLIST PARSER] TOTAL REJECTED ROWS: ${rejectedRows.length}`);
    rejectedRows.forEach(r => console.log(`[PICKLIST PARSER]   REJECTED: ${r}`));
  }

  if (allItems.length === 0) {
    warnings.push('No valid product rows found in the picklist product table. Check the PDF structure and console debug output.');
  }

  const parties = Array.from(partyMap.values());
  const calculatedTotal = totalValueFromHeader > 0 ? totalValueFromHeader : parties.reduce((sum, p) => sum + p.totalAmount, 0);

  return {
    picklistNumber,
    date,
    routeCode: routeCode || 'SANGAMNER_6',
    routeName: routeName || 'SANGAMNER 6',
    parties: parties.length > 0 ? parties : [
      {
        partyCode: 'P001',
        partyName: 'Route Customer Workload',
        items: allItems,
        totalAmount: calculatedTotal,
      }
    ],
    items: allItems,
    totalAmount: calculatedTotal,
    totalItems: allItems.length,
    pageCount,
    rawText: fullText,
    warnings,
  };
}
