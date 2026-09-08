export type UserRole = 'owner' | 'worker' | 'master';

export type WorkerStatus = 'active' | 'inactive';
export type RouteStatus = 'active' | 'inactive' | 'completed';
export type PartyStatus = 'active' | 'inactive';
export type ProductStatus = 'active' | 'inactive';

export type PicklistStatus = 'draft' | 'confirmed' | 'assigned' | 'in_progress' | 'completed';
export type InvoiceStatus = 'pending' | 'delivered' | 'paid' | 'partial';
export type DeliveryStatus = 'pending' | 'out_for_delivery' | 'delivered' | 'failed' | 'partial' | 'refused' | 'cancelled';
export type PaymentMode = 'cash' | 'cheque' | 'credit' | 'upi';
export type PaymentStatus = 'collected' | 'pending' | 'cleared' | 'bounced' | 'reversed';

export type PartyFinancialLedgerEntryType =
  | 'sale'
  | 'payment'
  | 'payment_reversal'
  | 'cheque_bounce'
  | 'credit_adjustment';

export type PartyFinancialLedgerDirection = 'debit' | 'credit';
export type PartyFinancialLedgerStatus = 'valid' | 'void';
export type FinancialReconciliationStatus = 'pending' | 'reconciled' | 'discrepancy';

export type InventoryMovementType =
  | 'opening_balance'
  | 'purchase_inward'
  | 'route_load'
  | 'delivery_fulfilled'
  | 'route_return'
  | 'damaged_transit'
  | 'damaged_warehouse'
  | 'inventory_adjustment';

export type InventoryMovementDirection = 'in' | 'out';

export type InventoryLocation =
  | 'warehouse'
  | 'vehicle'
  | 'customer'
  | 'damaged_quarantine'
  | 'supplier'
  | 'adjustment';

// ── Database row types ──────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  pin: string | null;
  status: WorkerStatus;
  notes: string | null;
  /** Monthly sales target in INR. Added in migration 002. */
  monthly_target: number;
  created_at: string;
  updated_at: string;
}

export interface PinUser {
  id: string;
  name: string;
  phone: string | null;
  pin: string;
  role: UserRole;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface Route {
  id: string;
  name: string;
  code: string;
  description: string | null;
  assigned_worker_id: string | null;
  status: RouteStatus;
  created_at: string;
  updated_at: string;
  // Joined
  worker?: Worker | null;
}

export interface Party {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  route_id: string | null;
  outstanding_amount: number;
  status: PartyStatus;
  created_at: string;
  updated_at: string;
  // Joined
  route?: Route | null;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  mrp: number;
  rate: number;
  unit: string;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

export interface Picklist {
  id: string;
  picklist_number: string;
  date: string;
  route_id: string | null;
  worker_id: string | null;
  status: PicklistStatus;
  total_amount: number;
  total_items: number;
  total_parties: number;
  completed_parties: number;
  started_at: string | null;
  completed_at: string | null;
  total_collected: number;
  total_cash: number;
  total_upi: number;
  total_cheque: number;
  total_credit: number;
  expected_cash: number | null;
  actual_cash_returned: number | null;
  cash_discrepancy: number | null;
  total_expenses: number | null;
  net_cash_deposit: number | null;
  expected_upi: number | null;
  expected_cheque: number | null;
  expected_credit: number | null;
  financial_reconciled_at: string | null;
  reconciled_by_worker_id: string | null;
  financial_reconciliation_status: FinancialReconciliationStatus;
  notes: string | null;
  sap_raw_data: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  route?: Route | null;
  worker?: Worker | null;
  items?: PicklistItem[];
  parties?: PicklistParty[];
  deliveries?: Delivery[];
  load_items?: PicklistLoadItem[];
}

export interface PicklistParty {
  id: string;
  picklist_id: string;
  party_id: string;
  sequence_order: number;
  // Joined
  party?: Party | null;
}

export interface PicklistItem {
  id: string;
  picklist_id: string;
  party_id: string;
  product_id: string | null;
  sku: string;
  product_name: string;
  quantity: number;
  /** Free/scheme quantity. Added in migration 002. */
  free_quantity: number;
  rate: number;
  amount: number;
  sap_line_data: string | null;
  // Joined
  product?: Product | null;
  party?: Party | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  picklist_id: string | null;
  party_id: string | null;
  route_code: string | null;
  sales_rep: string | null;
  date: string;
  total_amount: number;
  tax_amount: number;
  net_amount: number;
  status: InvoiceStatus;
  sap_raw_data: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  party?: Party | null;
  items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  sku: string;
  product_name: string;
  quantity: number;
  /** Free/scheme quantity. Added in migration 002. */
  free_quantity: number;
  mrp: number;
  rate: number;
  amount: number;
  tax_amount: number;
}

export interface Delivery {
  id: string;
  picklist_id: string | null;
  party_id: string;
  worker_id: string | null;
  invoice_id: string | null;
  status: DeliveryStatus;
  sequence_order: number;
  delivery_date: string | null;
  started_at: string | null;
  delivered_at: string | null;
  total_amount: number;
  delivered_amount: number;
  collected_amount: number;
  /** Value of goods returned (partial delivery). Added in migration 002. */
  returned_amount: number;
  payment_mode: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  party?: Party | null;
  worker?: Worker | null;
  invoice?: Invoice | null;
  picklist?: Picklist | null;
  payments?: Payment[];
  items?: DeliveryItem[];
}

export interface PicklistLoadItem {
  id: string;
  picklist_id: string;
  product_id: string;
  sku: string;
  loaded_quantity: number;
  created_at: string;
  updated_at: string;
  // Joined
  product?: Product | null;
}

export interface DeliveryItem {
  id: string;
  delivery_id: string;
  product_id: string | null;
  sku: string;
  product_name: string;
  ordered_qty: number;
  delivered_qty: number;
  /** Free/scheme quantity. Added in migration 002. */
  free_quantity: number;
  /** Actual delivered free quantity. Added in Stage 4B. */
  delivered_free_qty: number;
  /** Returned commercial quantity. Added in Stage 4B. */
  returned_qty: number;
  /** Returned free quantity. Added in Stage 4B. */
  returned_free_qty: number;
  /** Damaged commercial quantity in transit. Added in Stage 4B. */
  damaged_qty: number;
  /** Damaged free quantity in transit. Added in Stage 4B. */
  damaged_free_qty: number;
  rate: number;
  amount: number;
  notes: string | null;
}

export interface RouteStockItem {
  product_id: string;
  sku: string;
  product_name: string;
  loaded_qty: number;
  delivered_qty: number;
  delivered_free_qty: number;
  damaged_transit_qty: number;
  route_return_qty: number;
  expected_vehicle_qty: number;
}

export interface RouteStockCheck {
  picklist_id: string;
  items: RouteStockItem[];
  total_loaded: number;
  total_delivered: number;
  total_delivered_free: number;
  total_damaged: number;
  total_returned: number;
  total_expected_return: number;
  vehicle_balance: number;
  warehouse_impact: {
    loaded_from_warehouse: number;
    returned_to_warehouse: number;
  };
  movement_counts: number;
}

export interface RouteReturnItemInput {
  product_id: string;
  returned_qty: number;
  damaged_warehouse_qty: number;
  adjustment_qty?: number;
  adjustment_reason?: string;
}

export interface Payment {
  id: string;
  /** Auto-generated reference number (convenience field). */
  payment_number?: string;
  delivery_id: string | null;
  party_id: string;
  invoice_id: string | null;
  picklist_id: string | null;
  route_id: string | null;
  worker_id: string | null;
  /** Worker who physically received the payment (may differ from delivery worker). Added in migration 002. */
  received_by_worker_id: string | null;
  amount: number;
  payment_mode: PaymentMode;
  cheque_number: string | null;
  /** UPI UTR, cheque reference, or other payment reference. Added in migration 002. */
  reference_number: string | null;
  cheque_date: string | null;
  cheque_bank: string | null;
  notes: string | null;
  payment_date: string;
  status: PaymentStatus;
  idempotency_key: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  party?: Party | null;
  worker?: Worker | null;
  received_by?: Worker | null;
  delivery?: Delivery | null;
  invoice?: Invoice | null;
  picklist?: Picklist | null;
  route?: Route | null;
}

export interface SplitPaymentInput {
  mode: PaymentMode;
  amount: number;
  reference_number?: string;
  cheque_number?: string;
  cheque_date?: string;
  cheque_bank?: string;
  notes?: string;
}

export interface PartyFinancialLedger {
  id: string;
  party_id: string;
  invoice_id: string | null;
  delivery_id: string | null;
  payment_id: string | null;
  picklist_id: string | null;
  route_id: string | null;
  entry_type: PartyFinancialLedgerEntryType;
  amount: number;
  direction: PartyFinancialLedgerDirection;
  status: PartyFinancialLedgerStatus;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  idempotency_key: string | null;
  // Joined
  party?: Party | null;
  delivery?: Delivery | null;
  invoice?: Invoice | null;
  payment?: Payment | null;
  picklist?: Picklist | null;
}

export interface FinancialSummary {
  sales: number;
  total_collected: number;
  cash: number;
  upi: number;
  cheque_cleared: number;
  cheque_pending: number;
  credit_extended: number;
  expenses: number;
  cash_expenses?: number;
  net_cash: number;
  total_outstanding: number;
  contribution_before_cogs?: number;
}

export interface RouteFinancialReconciliationResult {
  success: boolean;
  already_reconciled?: boolean;
  picklist_id: string;
  status: 'reconciled' | 'discrepancy';
  expected_cash: number;
  total_expenses: number;
  cash_expenses?: number;
  net_cash_deposit: number;
  actual_cash_returned: number;
  cash_discrepancy: number;
  expected_upi: number;
  expected_cheque: number;
  expected_credit: number;
}

export type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'reversed';
export type ExpensePaymentMethod = 'cash' | 'upi' | 'bank' | 'other';
export type ExpenseType = 'route_operating' | 'worker_personal';

export interface Expense {
  id: string;
  /** Auto-generated reference number (convenience field, not in DB). */
  expense_number?: string;
  category: string;
  amount: number;
  date: string;
  payment_method: ExpensePaymentMethod;
  status: ExpenseStatus;
  expense_type: ExpenseType;
  description: string | null;
  /** URL of uploaded receipt image. Added in migration 002. */
  receipt_url: string | null;
  worker_id: string | null;
  /** Convenience: worker's display name, derived by joining workers table. Not stored in DB. */
  worker_name?: string | null;
  /** Route this expense belongs to. Added in migration 002. */
  route_id: string | null;
  /** Picklist trip this expense belongs to. Added in Stage 5. */
  picklist_id: string | null;
  idempotency_key: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  /** Whether this expense is visible to the worker's dashboard. Added in migration 002. */
  visible_to_worker: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  worker?: Worker | null;
  route?: Route | null;
  picklist?: Picklist | null;
}

export interface RouteProfitabilityItem {
  picklist_id: string;
  picklist_number: string;
  date: string;
  route_id: string | null;
  route_name: string | null;
  route_code: string | null;
  worker_id: string | null;
  worker_name: string | null;
  sales: number;
  cash_collected: number;
  upi_collected: number;
  cheque_cleared: number;
  cheque_pending: number;
  cheque_bounced: number;
  credit_sales: number;
  total_collected: number;
  approved_expenses: number;
  cash_expenses: number;
  non_cash_expenses: number;
  expected_cash: number;
  actual_cash_returned: number;
  cash_discrepancy: number;
  contribution_before_cogs: number;
  financial_status: string;
  reconciled_at: string | null;
}

export interface RouteProfitabilityTotals {
  sales: number;
  cash_collected: number;
  upi_collected: number;
  cheque_cleared: number;
  cheque_pending: number;
  credit_sales: number;
  total_collected: number;
  approved_expenses: number;
  cash_expenses: number;
  non_cash_expenses: number;
  expected_cash: number;
  actual_cash_returned: number;
  cash_discrepancy: number;
  contribution_before_cogs: number;
}

export interface RouteProfitabilityResponse {
  success: boolean;
  routes: RouteProfitabilityItem[];
  totals: RouteProfitabilityTotals;
}

export interface InventoryMovement {
  id: string;
  occurred_at: string;
  product_id: string;
  sku: string;
  movement_type: InventoryMovementType;
  quantity: number;
  direction: InventoryMovementDirection;
  from_location: InventoryLocation | string;
  to_location: InventoryLocation | string;
  picklist_id: string | null;
  route_id: string | null;
  delivery_id: string | null;
  party_id: string | null;
  worker_id: string | null;
  reference_number: string | null;
  notes: string | null;
  idempotency_key: string | null;
  created_at: string;
  // Joined
  product?: Product | null;
  picklist?: Picklist | null;
  route?: Route | null;
  delivery?: Delivery | null;
  party?: Party | null;
  worker?: Worker | null;
}

// ── Master Audit Log ────────────────────────────────────────────────

export interface MasterAuditLog {
  id: string;
  occurred_at: string;
  user_id: string | null;
  user_name: string | null;
  role: string | null;
  module: string;
  action: string;
  status: 'success' | 'failure' | 'warning';
  detail: string | null;
  ip_hint: string | null;
  /** Business entity type affected (e.g. 'invoice', 'delivery', 'payment'). Added in migration 002. */
  entity_type: string | null;
  /** ID of the affected business entity. Added in migration 002. */
  entity_id: string | null;
}

// ── Database type for Supabase client ───────────────────────────────

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string; email: string }; Update: Partial<Profile> };
      workers: { Row: Worker; Insert: Omit<Worker, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Worker> };
      pin_users: { Row: PinUser; Insert: Omit<PinUser, 'id' | 'created_at' | 'updated_at'>; Update: Partial<PinUser> };
      routes: { Row: Route; Insert: Omit<Route, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Route> };
      parties: { Row: Party; Insert: Omit<Party, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Party> };
      products: { Row: Product; Insert: Omit<Product, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Product> };
      picklists: { Row: Picklist; Insert: Omit<Picklist, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Picklist> };
      picklist_parties: { Row: PicklistParty; Insert: Omit<PicklistParty, 'id'>; Update: Partial<PicklistParty> };
      picklist_items: { Row: PicklistItem; Insert: Omit<PicklistItem, 'id'>; Update: Partial<PicklistItem> };
      invoices: { Row: Invoice; Insert: Omit<Invoice, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Invoice> };
      invoice_items: { Row: InvoiceItem; Insert: Omit<InvoiceItem, 'id'>; Update: Partial<InvoiceItem> };
      deliveries: { Row: Delivery; Insert: Omit<Delivery, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Delivery> };
      delivery_items: { Row: DeliveryItem; Insert: Omit<DeliveryItem, 'id'>; Update: Partial<DeliveryItem> };
      payments: { Row: Payment; Insert: Omit<Payment, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Payment> };
      expenses: { Row: Expense; Insert: Omit<Expense, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Expense> };
      inventory_movements: {
        Row: InventoryMovement;
        Insert: Omit<InventoryMovement, 'id' | 'created_at' | 'occurred_at'> & {
          id?: string;
          occurred_at?: string;
          created_at?: string;
        };
        Update: Partial<InventoryMovement>;
      };
      picklist_load_items: { Row: PicklistLoadItem; Insert: Omit<PicklistLoadItem, 'id' | 'created_at' | 'updated_at'>; Update: Partial<PicklistLoadItem> };
      party_financial_ledger: { Row: PartyFinancialLedger; Insert: Omit<PartyFinancialLedger, 'id' | 'created_at'>; Update: Partial<PartyFinancialLedger> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
