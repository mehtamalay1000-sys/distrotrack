export interface ParsedPicklistItem {
  partyCode: string;
  partyName: string;
  sku: string;
  productName: string;
  category?: string;
  quantity: number;
  freeQuantity?: number;
  rate: number;
  amount: number;
  rawText?: string;
}

export interface ParsedPicklistParty {
  partyCode: string;
  partyName: string;
  items: ParsedPicklistItem[];
  totalAmount: number;
}

export interface ParsedPicklistLoadItem {
  sku: string;
  quantity: number;
}

export interface ParsedPicklist {
  picklistNumber: string;
  date: string;
  routeCode: string;
  routeName: string;
  parties: ParsedPicklistParty[];
  items: ParsedPicklistItem[];
  loadItems?: ParsedPicklistLoadItem[];
  totalAmount: number;
  totalItems: number;
  pageCount: number;
  rawText: string;
  warnings: string[];
}

export interface ParsedInvoiceItem {
  sku: string;
  productName: string;
  category?: string;
  quantity: number;
  freeQuantity?: number;
  mrp: number;
  rate: number;
  amount: number;
  taxAmount: number;
}

export interface ParsedInvoice {
  invoiceNumber: string;
  date: string;
  partyCode: string;
  partyName: string;
  routeCode: string;
  salesRep: string;
  items: ParsedInvoiceItem[];
  totalAmount: number;
  taxAmount: number;
  netAmount: number;
  pageCount: number;
  rawText: string;
}

export interface ParsedBillsResult {
  invoices: ParsedInvoice[];
  pageCount: number;
  totalInvoices: number;
  totalAmount: number;
  warnings: string[];
}

export interface MatchPair {
  partyCode: string;
  partyName: string;
  picklistParty?: ParsedPicklistParty;
  invoice?: ParsedInvoice;
  status: 'matched' | 'missing_bill' | 'unexpected_bill' | 'discrepancy';
  notes?: string[];
}

export interface MatchResult {
  picklistNumber: string;
  pairs: MatchPair[];
  matchedCount: number;
  missingBillsCount: number;
  unexpectedBillsCount: number;
  discrepanciesCount: number;
  isFullyMatched: boolean;
  warnings: string[];
}
