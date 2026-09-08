-- ================================================================
-- Migration 009: Inventory Movement Ledger Database Foundation
-- ================================================================
-- Stage 4A: Database foundation for append-only stock movement ledger
-- and non-negative quantity integrity constraints.
--
-- 1. Pre-flight verification on existing quantity data
-- 2. Non-negative CHECK constraints on picklist_items, invoice_items, delivery_items
-- 3. Append-only inventory_movements ledger table
-- 4. Safe indexes on query columns and idempotency key
-- 5. Immutability policies (block direct UPDATE/DELETE)
-- ================================================================

-- ── Step 1: Pre-flight checks on existing transactional data ─────
DO $$
DECLARE
  v_invalid_picklist_items integer;
  v_invalid_invoice_items integer;
  v_invalid_delivery_items integer;
BEGIN
  RAISE NOTICE 'Migration 009: Running pre-flight quantity checks...';

  SELECT COUNT(*) INTO v_invalid_picklist_items
  FROM picklist_items
  WHERE quantity < 0 OR free_quantity < 0;

  IF v_invalid_picklist_items > 0 THEN
    RAISE EXCEPTION 'Pre-flight check failed: Found % invalid rows in picklist_items with negative quantities. Aborting.', v_invalid_picklist_items;
  END IF;

  SELECT COUNT(*) INTO v_invalid_invoice_items
  FROM invoice_items
  WHERE quantity < 0 OR free_quantity < 0;

  IF v_invalid_invoice_items > 0 THEN
    RAISE EXCEPTION 'Pre-flight check failed: Found % invalid rows in invoice_items with negative quantities. Aborting.', v_invalid_invoice_items;
  END IF;

  SELECT COUNT(*) INTO v_invalid_delivery_items
  FROM delivery_items
  WHERE ordered_qty < 0 OR delivered_qty < 0 OR free_quantity < 0;

  IF v_invalid_delivery_items > 0 THEN
    RAISE EXCEPTION 'Pre-flight check failed: Found % invalid rows in delivery_items with negative quantities. Aborting.', v_invalid_delivery_items;
  END IF;

  RAISE NOTICE 'Pre-flight quantity checks passed: Zero invalid rows found.';
END $$;

-- ── Step 2: Add non-negative CHECK constraints to existing items tables ─
DO $$
BEGIN
  -- picklist_items constraints
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_picklist_items_quantity_non_negative') THEN
    ALTER TABLE picklist_items
      ADD CONSTRAINT chk_picklist_items_quantity_non_negative CHECK (quantity >= 0);
    RAISE NOTICE 'Added constraint chk_picklist_items_quantity_non_negative';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_picklist_items_free_quantity_non_negative') THEN
    ALTER TABLE picklist_items
      ADD CONSTRAINT chk_picklist_items_free_quantity_non_negative CHECK (free_quantity >= 0);
    RAISE NOTICE 'Added constraint chk_picklist_items_free_quantity_non_negative';
  END IF;

  -- invoice_items constraints
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_items_quantity_non_negative') THEN
    ALTER TABLE invoice_items
      ADD CONSTRAINT chk_invoice_items_quantity_non_negative CHECK (quantity >= 0);
    RAISE NOTICE 'Added constraint chk_invoice_items_quantity_non_negative';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_items_free_quantity_non_negative') THEN
    ALTER TABLE invoice_items
      ADD CONSTRAINT chk_invoice_items_free_quantity_non_negative CHECK (free_quantity >= 0);
    RAISE NOTICE 'Added constraint chk_invoice_items_free_quantity_non_negative';
  END IF;

  -- delivery_items constraints
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_ordered_qty_non_negative') THEN
    ALTER TABLE delivery_items
      ADD CONSTRAINT chk_delivery_items_ordered_qty_non_negative CHECK (ordered_qty >= 0);
    RAISE NOTICE 'Added constraint chk_delivery_items_ordered_qty_non_negative';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_delivered_qty_non_negative') THEN
    ALTER TABLE delivery_items
      ADD CONSTRAINT chk_delivery_items_delivered_qty_non_negative CHECK (delivered_qty >= 0);
    RAISE NOTICE 'Added constraint chk_delivery_items_delivered_qty_non_negative';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_free_quantity_non_negative') THEN
    ALTER TABLE delivery_items
      ADD CONSTRAINT chk_delivery_items_free_quantity_non_negative CHECK (free_quantity >= 0);
    RAISE NOTICE 'Added constraint chk_delivery_items_free_quantity_non_negative';
  END IF;
END $$;

-- ── Step 3: Create inventory_movements table ─────────────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku text NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN (
    'opening_balance',
    'purchase_inward',
    'route_load',
    'delivery_fulfilled',
    'route_return',
    'damaged_transit',
    'damaged_warehouse',
    'inventory_adjustment'
  )),
  quantity numeric(10,2) NOT NULL CHECK (quantity > 0),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  from_location text NOT NULL CHECK (from_location IN (
    'warehouse',
    'vehicle',
    'customer',
    'damaged_quarantine',
    'supplier',
    'adjustment'
  )),
  to_location text NOT NULL CHECK (to_location IN (
    'warehouse',
    'vehicle',
    'customer',
    'damaged_quarantine',
    'supplier',
    'adjustment'
  )),
  picklist_id uuid REFERENCES picklists(id) ON DELETE SET NULL,
  route_id uuid REFERENCES routes(id) ON DELETE SET NULL,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  party_id uuid REFERENCES parties(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES workers(id) ON DELETE SET NULL,
  reference_number text,
  notes text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Step 4: Indexes for efficient querying ───────────────────────
CREATE INDEX IF NOT EXISTS idx_inv_movements_product_id ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_sku ON inventory_movements(sku);
CREATE INDEX IF NOT EXISTS idx_inv_movements_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inv_movements_occurred_at ON inventory_movements(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_picklist_id ON inventory_movements(picklist_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_route_id ON inventory_movements(route_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_delivery_id ON inventory_movements(delivery_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_party_id ON inventory_movements(party_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_idempotency_key ON inventory_movements(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── Step 5: Row Level Security & Immutability Policies ───────────
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Allow SELECT for authenticated and anon users (session architecture)
DROP POLICY IF EXISTS "anon_read_inventory_movements" ON inventory_movements;
CREATE POLICY "anon_read_inventory_movements"
  ON inventory_movements FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow INSERT for recording discrete movements
DROP POLICY IF EXISTS "anon_insert_inventory_movements" ON inventory_movements;
CREATE POLICY "anon_insert_inventory_movements"
  ON inventory_movements FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Block all direct UPDATE operations (append-only ledger)
DROP POLICY IF EXISTS "block_update_inventory_movements" ON inventory_movements;
CREATE POLICY "block_update_inventory_movements"
  ON inventory_movements FOR UPDATE
  TO anon, authenticated
  USING (false);

-- Block all direct DELETE operations (append-only ledger)
DROP POLICY IF EXISTS "block_delete_inventory_movements" ON inventory_movements;
CREATE POLICY "block_delete_inventory_movements"
  ON inventory_movements FOR DELETE
  TO anon, authenticated
  USING (false);

-- ── Step 6: Post-flight validation ───────────────────────────────
DO $$
DECLARE
  v_table_exists boolean;
  v_constraint_count integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'inventory_movements'
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'Migration 009 validation failed: inventory_movements table was not created.';
  END IF;

  SELECT COUNT(*) INTO v_constraint_count
  FROM pg_constraint
  WHERE conname IN (
    'chk_picklist_items_quantity_non_negative',
    'chk_picklist_items_free_quantity_non_negative',
    'chk_invoice_items_quantity_non_negative',
    'chk_invoice_items_free_quantity_non_negative',
    'chk_delivery_items_ordered_qty_non_negative',
    'chk_delivery_items_delivered_qty_non_negative',
    'chk_delivery_items_free_quantity_non_negative'
  );

  IF v_constraint_count < 7 THEN
    RAISE EXCEPTION 'Migration 009 validation failed: Expected 7 quantity check constraints, found %', v_constraint_count;
  END IF;

  RAISE NOTICE 'Migration 009 complete: inventory_movements table created and all 7 quantity constraints verified.';
END $$;
