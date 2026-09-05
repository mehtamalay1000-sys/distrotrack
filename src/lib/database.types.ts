export type UserRole = 'owner' | 'worker' | 'master';

export type WorkerStatus = 'active' | 'inactive';
export type RouteStatus = 'active' | 'inactive' | 'completed';
export type PartyStatus = 'active' | 'inactive';
export type ProductStatus = 'active' | 'inactive';

export type PicklistStatus = 'draft' | 'confirmed' | 'assigned' | 'in_progress' | 'completed';
export type InvoiceStatus = 'pending' | 'delivered' | 'paid' | 'partial';
export type DeliveryStatus = 'pending' | 'out_for_delivery' | 'delivered' | 'failed' | 'partial';
export type PaymentMode = 'cash' | 'cheque' | 'credit' | 'upi';
export type PaymentStatus = 'collected' | 'pending' | 'bounced';

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
  total_cheque: number;
  total_credit: number;
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
  rate: number;
  amount: number;
  notes: string | null;
}

export interface Payment {
  id: string;
  /** Auto-generated reference number (convenience field). */
  payment_number?: string;
  delivery_id: string | null;
  party_id: string;
  invoice_id: string | null;
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
  created_at: string;
  updated_at: string;
  // Joined
  party?: Party | null;
  worker?: Worker | null;
  received_by?: Worker | null;
  delivery?: Delivery | null;
  invoice?: Invoice | null;
}

export interface Expense {
  id: string;
  /** Auto-generated reference number (convenience field, not in DB). */
  expense_number?: string;
  category: string;
  amount: number;
  date: string;
  description: string | null;
  /** URL of uploaded receipt image. Added in migration 002. */
  receipt_url: string | null;
  worker_id: string | null;
  /** Convenience: worker's display name, derived by joining workers table. Not stored in DB. */
  worker_name?: string | null;
  /** Route this expense belongs to. Added in migration 002. */
  route_id: string | null;
  /** Whether this expense is visible to the worker's dashboard. Added in migration 002. */
  visible_to_worker: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  worker?: Worker | null;
  route?: Route | null;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
