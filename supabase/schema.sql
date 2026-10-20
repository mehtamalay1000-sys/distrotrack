-- DistroTrack Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ── Profiles ────────────────────────────────────────────────────────

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'owner' check (role in ('owner', 'worker')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Workers ─────────────────────────────────────────────────────────

create table if not exists workers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text,
  email text,
  pin text default '0000',
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── PIN Users (Admin / Owner accounts) ──────────────────────────────

create table if not exists pin_users (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text,
  pin text not null default '0000',
  role text not null default 'owner' check (role in ('owner', 'worker')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Seed Workers & Admin ────────────────────────────────────────────

INSERT INTO workers (name, phone, pin, status)
VALUES
  ('Balu Murtadak', '7972761898', '1234', 'active'),
  ('Mahindra Rashinkar', '8208091610', '5678', 'active')
ON CONFLICT DO NOTHING;

-- NOTE: For security, the initial admin / owner account should be created manually after setup.
-- Example:
-- INSERT INTO pin_users (name, phone, pin, role, status)
-- VALUES ('Admin User', '', 'YOUR_ADMIN_PIN', 'owner', 'active')
-- ON CONFLICT DO NOTHING;

-- ── Routes ──────────────────────────────────────────────────────────

create table if not exists routes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  code text not null unique,
  description text,
  assigned_worker_id uuid references workers(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Parties (Customers) ────────────────────────────────────────────

create table if not exists parties (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  route_id uuid references routes(id) on delete set null,
  outstanding_amount numeric(12,2) not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_parties_route on parties(route_id);
create index if not exists idx_parties_code on parties(code);

-- ── Products ────────────────────────────────────────────────────────

create table if not exists products (
  id uuid primary key default uuid_generate_v4(),
  sku text not null unique,
  name text not null,
  category text,
  mrp numeric(10,2) not null default 0,
  rate numeric(10,2) not null default 0,
  unit text not null default 'pcs',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_sku on products(sku);

-- ── Picklists ───────────────────────────────────────────────────────

create table if not exists picklists (
  id uuid primary key default uuid_generate_v4(),
  picklist_number text not null unique,
  date date not null default current_date,
  route_id uuid references routes(id) on delete set null,
  worker_id uuid references workers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'assigned', 'in_progress', 'completed')),
  total_amount numeric(12,2) not null default 0,
  total_items integer not null default 0,
  total_parties integer not null default 0,
  completed_parties integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  total_collected numeric(12,2) not null default 0,
  total_cash numeric(12,2) not null default 0,
  total_cheque numeric(12,2) not null default 0,
  total_credit numeric(12,2) not null default 0,
  notes text,
  sap_raw_data text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_picklists_date on picklists(date);
create index if not exists idx_picklists_status on picklists(status);
create index if not exists idx_picklists_worker on picklists(worker_id);

-- ── Picklist Parties (junction) ────────────────────────────────────

create table if not exists picklist_parties (
  id uuid primary key default uuid_generate_v4(),
  picklist_id uuid not null references picklists(id) on delete cascade,
  party_id uuid not null references parties(id) on delete cascade,
  sequence_order integer not null default 0,
  unique(picklist_id, party_id)
);

-- ── Picklist Items ──────────────────────────────────────────────────

create table if not exists picklist_items (
  id uuid primary key default uuid_generate_v4(),
  picklist_id uuid not null references picklists(id) on delete cascade,
  party_id uuid not null references parties(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  sku text not null default '',
  product_name text not null default '',
  quantity numeric(10,2) not null default 0,
  rate numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  sap_line_data text
);

create index if not exists idx_picklist_items_picklist on picklist_items(picklist_id);

-- ── Invoices ────────────────────────────────────────────────────────

create table if not exists invoices (
  id uuid primary key default uuid_generate_v4(),
  invoice_number text not null unique,
  picklist_id uuid references picklists(id) on delete set null,
  party_id uuid references parties(id) on delete set null,
  route_code text,
  sales_rep text,
  date date not null default current_date,
  total_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'paid', 'partial')),
  sap_raw_data text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_picklist on invoices(picklist_id);
create index if not exists idx_invoices_party on invoices(party_id);

-- ── Invoice Items ───────────────────────────────────────────────────

create table if not exists invoice_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  sku text not null default '',
  product_name text not null default '',
  quantity numeric(10,2) not null default 0,
  mrp numeric(10,2) not null default 0,
  rate numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  tax_amount numeric(10,2) not null default 0
);

create index if not exists idx_invoice_items_invoice on invoice_items(invoice_id);

-- ── Deliveries ──────────────────────────────────────────────────────

create table if not exists deliveries (
  id uuid primary key default uuid_generate_v4(),
  picklist_id uuid references picklists(id) on delete set null,
  party_id uuid not null references parties(id) on delete cascade,
  worker_id uuid references workers(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'out_for_delivery', 'delivered', 'failed', 'partial')),
  sequence_order integer not null default 0,
  delivery_date date,
  started_at timestamptz,
  delivered_at timestamptz,
  total_amount numeric(12,2) not null default 0,
  delivered_amount numeric(12,2) not null default 0,
  collected_amount numeric(12,2) not null default 0,
  payment_mode text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deliveries_picklist on deliveries(picklist_id);
create index if not exists idx_deliveries_worker on deliveries(worker_id);
create index if not exists idx_deliveries_status on deliveries(status);

-- ── Delivery Items ──────────────────────────────────────────────────

create table if not exists delivery_items (
  id uuid primary key default uuid_generate_v4(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  sku text not null default '',
  product_name text not null default '',
  ordered_qty numeric(10,2) not null default 0,
  delivered_qty numeric(10,2) not null default 0,
  rate numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  notes text
);

create index if not exists idx_delivery_items_delivery on delivery_items(delivery_id);

-- ── Payments ────────────────────────────────────────────────────────

create table if not exists payments (
  id uuid primary key default uuid_generate_v4(),
  delivery_id uuid references deliveries(id) on delete set null,
  party_id uuid not null references parties(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  worker_id uuid references workers(id) on delete set null,
  amount numeric(12,2) not null,
  payment_mode text not null check (payment_mode in ('cash', 'cheque', 'credit')),
  cheque_number text,
  cheque_date date,
  cheque_bank text,
  notes text,
  payment_date date not null default current_date,
  status text not null default 'collected' check (status in ('collected', 'pending', 'bounced')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_party on payments(party_id);
create index if not exists idx_payments_delivery on payments(delivery_id);

-- ── Expenses ────────────────────────────────────────────────────────

create table if not exists expenses (
  id uuid primary key default uuid_generate_v4(),
  category text not null,
  amount numeric(12,2) not null,
  date date not null default current_date,
  description text,
  worker_id uuid references workers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Updated-at trigger ──────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply to all tables with updated_at
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'profiles','workers','pin_users','routes','parties','products',
    'picklists','invoices','deliveries','delivery_items','payments','expenses'
  ]) loop
    execute format(
      'create or replace trigger set_updated_at before update on %I for each row execute function update_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ── RLS Policies ────────────────────────────────────────────────────

alter table profiles enable row level security;
alter table workers enable row level security;
alter table pin_users enable row level security;
alter table routes enable row level security;
alter table parties enable row level security;
alter table products enable row level security;
alter table picklists enable row level security;
alter table picklist_parties enable row level security;
alter table picklist_items enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table deliveries enable row level security;
alter table delivery_items enable row level security;
alter table payments enable row level security;
alter table expenses enable row level security;

-- For now, allow all authenticated users full access (refine per role later)
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'profiles','workers','pin_users','routes','parties','products',
    'picklists','picklist_parties','picklist_items',
    'invoices','invoice_items','deliveries','delivery_items','payments','expenses'
  ]) loop
    execute format(
      'create policy "Allow authenticated access" on %I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end;
$$;

-- ── Auto-create profile on signup ───────────────────────────────────

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'owner');
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
