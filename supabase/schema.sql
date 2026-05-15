-- ============================================================
-- WMS DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================================

-- Organizations (multi-tenant from day 1)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin users (linked to Supabase auth)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  warehouse_id UUID REFERENCES warehouses(id),
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'viewer')),
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workers (PIN-based login, no Supabase auth)
CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id),
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'picker' CHECK (role IN ('picker', 'packer', 'receiver', 'all')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Baskets / totes
CREATE TABLE IF NOT EXISTS baskets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id),
  barcode TEXT NOT NULL UNIQUE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'damaged')),
  current_order_id UUID,
  current_worker_id UUID REFERENCES workers(id),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  lead_time_days INTEGER DEFAULT 7,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products / SKUs
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) DEFAULT 0,
  image_url TEXT,
  supplier_id UUID REFERENCES suppliers(id),
  reorder_point INTEGER DEFAULT 0,
  weight DECIMAL(8,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, sku)
);

-- Product barcodes (supports multiple barcodes / aliases per product)
CREATE TABLE IF NOT EXISTS product_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  barcode TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, barcode)
);

-- Warehouse zones
CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  zone_type TEXT DEFAULT 'standard' CHECK (zone_type IN ('standard', 'fragile', 'cold', 'heavy', 'overstock')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bin locations (aisle-shelf-bin, e.g. A-02-C)
CREATE TABLE IF NOT EXISTS bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  zone_id UUID REFERENCES zones(id),
  barcode TEXT UNIQUE,
  location_code TEXT NOT NULL,
  capacity INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(warehouse_id, location_code)
);

-- Inventory per product per bin
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  bin_id UUID REFERENCES bins(id),
  warehouse_id UUID REFERENCES warehouses(id),
  org_id UUID REFERENCES organizations(id),
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  qty_available INTEGER NOT NULL DEFAULT 0,
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  qty_picked INTEGER NOT NULL DEFAULT 0,
  qty_damaged INTEGER NOT NULL DEFAULT 0,
  expiry_date DATE,
  batch_number TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, bin_id)
);

-- Inventory adjustment log
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID REFERENCES inventory(id),
  product_id UUID REFERENCES products(id),
  org_id UUID REFERENCES organizations(id),
  worker_id UUID REFERENCES workers(id),
  admin_id UUID REFERENCES admin_users(id),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN (
    'receive', 'adjust', 'damage', 'return', 'cycle_count',
    'reserve', 'unreserve', 'pick', 'pack', 'ship',
    'manual_add', 'manual_remove', 'manual_set'
  )),
  qty_before INTEGER NOT NULL,
  qty_change INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id),
  order_number TEXT NOT NULL,
  barcode TEXT UNIQUE,
  customer_name TEXT,
  customer_email TEXT,
  shipping_address JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'picking', 'picked', 'packing', 'packed', 'shipping', 'shipped', 'complete', 'cancelled', 'on_hold')),
  is_bulk BOOLEAN DEFAULT FALSE,
  is_rush BOOLEAN DEFAULT FALSE,
  notes TEXT,
  total_boxes INTEGER DEFAULT 1,
  assigned_picker_id UUID REFERENCES workers(id),
  assigned_packer_id UUID REFERENCES workers(id),
  basket_id UUID REFERENCES baskets(id),
  carrier TEXT,
  tracking_number TEXT,
  shipped_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  hold_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, order_number)
);

-- Order items
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity_ordered INTEGER NOT NULL,
  quantity_picked INTEGER DEFAULT 0,
  quantity_packed INTEGER DEFAULT 0,
  quantity_short INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reserved', 'picked', 'packed', 'short', 'damaged')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Boxes (multi-box orders)
CREATE TABLE IF NOT EXISTS boxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  box_number INTEGER NOT NULL,
  barcode TEXT UNIQUE,
  box_size TEXT CHECK (box_size IN ('small', 'medium', 'large', 'custom')),
  weight_expected DECIMAL(8,2),
  weight_actual DECIMAL(8,2),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'packing', 'closed', 'sealed', 'shipped')),
  tracking_number TEXT,
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Box items
CREATE TABLE IF NOT EXISTS box_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id),
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks (task-based system)
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id),
  task_type TEXT NOT NULL CHECK (task_type IN ('pick', 'pack', 'receive', 'putaway', 'replenish', 'cycle_count', 'exception', 'return')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'blocked')),
  priority INTEGER DEFAULT 0,
  order_id UUID REFERENCES orders(id),
  assigned_worker_id UUID REFERENCES workers(id),
  assigned_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Exceptions queue
CREATE TABLE IF NOT EXISTS exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id),
  order_id UUID REFERENCES orders(id),
  worker_id UUID REFERENCES workers(id),
  product_id UUID REFERENCES products(id),
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('short_pick', 'wrong_item', 'damaged', 'missing', 'overcount', 'basket_conflict', 'unknown_barcode', 'other')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'snoozed', 'resolved', 'overridden')),
  resolved_by UUID REFERENCES admin_users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full scan event log
CREATE TABLE IF NOT EXISTS scan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  worker_id UUID REFERENCES workers(id),
  task_id UUID REFERENCES tasks(id),
  order_id UUID REFERENCES orders(id),
  barcode TEXT NOT NULL,
  barcode_type TEXT CHECK (barcode_type IN ('product', 'basket', 'box', 'order', 'bin', 'unknown')),
  scan_action TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'error', 'warning')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Worker sessions (for crash/disconnect recovery)
CREATE TABLE IF NOT EXISTS worker_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID REFERENCES workers(id) ON DELETE CASCADE UNIQUE,
  task_id UUID REFERENCES tasks(id),
  order_id UUID REFERENCES orders(id),
  basket_id UUID REFERENCES baskets(id),
  session_data JSONB DEFAULT '{}',
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Receiving records
CREATE TABLE IF NOT EXISTS receiving (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  warehouse_id UUID REFERENCES warehouses(id),
  supplier_id UUID REFERENCES suppliers(id),
  worker_id UUID REFERENCES workers(id),
  reference_number TEXT,
  supplier_name TEXT,
  expected_date DATE,
  received_date TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'complete', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS receiving_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_id UUID REFERENCES receiving(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity_expected INTEGER,
  quantity_received INTEGER DEFAULT 0,
  bin_id UUID REFERENCES bins(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'received', 'over')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Returns / RMAs
CREATE TABLE IF NOT EXISTS returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id),
  order_id UUID REFERENCES orders(id),
  rma_number TEXT,
  customer_name TEXT,
  reason TEXT CHECK (reason IN ('wrong_item', 'damaged', 'not_as_described', 'changed_mind', 'defective', 'other')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'inspecting', 'restocked', 'disposed', 'refunded')),
  notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID REFERENCES returns(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity_returned INTEGER NOT NULL DEFAULT 1,
  condition TEXT DEFAULT 'good' CHECK (condition IN ('new', 'good', 'damaged', 'unsellable')),
  restock BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cycle counts
CREATE TABLE IF NOT EXISTS cycle_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  warehouse_id UUID REFERENCES warehouses(id),
  zone_id UUID REFERENCES zones(id),
  name TEXT,
  assigned_to UUID REFERENCES workers(id),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cycle_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_count_id UUID REFERENCES cycle_counts(id) ON DELETE CASCADE,
  bin_id UUID REFERENCES bins(id),
  product_id UUID REFERENCES products(id),
  qty_expected INTEGER,
  qty_counted INTEGER,
  discrepancy INTEGER GENERATED ALWAYS AS (COALESCE(qty_counted, 0) - COALESCE(qty_expected, 0)) STORED,
  counted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log (every important action)
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'worker', 'system')),
  actor_id UUID,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUTO-UPDATE updated_at on orders
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_org_status ON orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_picker ON orders(assigned_picker_id);
CREATE INDEX IF NOT EXISTS idx_orders_packer ON orders(assigned_packer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_bin ON inventory(bin_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_worker ON scan_events(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_order ON scan_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_worker ON tasks(assigned_worker_id, status);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_exceptions_org_status ON exceptions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_org ON returns(org_id, status);
CREATE INDEX IF NOT EXISTS idx_receiving_org ON receiving(org_id, status);
