-- ============================================================
-- WMS INITIAL SETUP
-- Run this AFTER schema.sql
-- Replace the values below with your own before running
-- ============================================================

-- Step 1: Create your organization
INSERT INTO organizations (id, name, slug)
VALUES (
  gen_random_uuid(),
  'Your Company Name',   -- ← Change this
  'your-company'         -- ← Change this (lowercase, no spaces)
)
RETURNING id;
-- Copy the id from the output above — you'll need it below

-- Step 2: Create your warehouse
-- Replace {ORG_ID} with the id from Step 1
INSERT INTO warehouses (id, org_id, name, address, timezone)
VALUES (
  gen_random_uuid(),
  '{ORG_ID}',            -- ← Paste org id here
  'Main Warehouse',      -- ← Change this
  '123 Warehouse St',    -- ← Change this
  'America/New_York'     -- ← Change this
)
RETURNING id;
-- Copy the id from the output above — you'll need it below

-- Step 3: Link your Supabase auth user to admin_users
-- Your user must already exist in auth.users (sign up via /login first)
-- Replace {USER_ID} with your auth user id (find it in Supabase > Auth > Users)
-- Replace {ORG_ID} with the org id from Step 1
-- Replace {WAREHOUSE_ID} with the warehouse id from Step 2
INSERT INTO admin_users (id, org_id, warehouse_id, role)
VALUES (
  '{USER_ID}',           -- ← Your Supabase auth user id
  '{ORG_ID}',            -- ← Org id from Step 1
  '{WAREHOUSE_ID}',      -- ← Warehouse id from Step 2
  'admin'
);

-- Step 4: Create your first basket
-- Replace {ORG_ID} and {WAREHOUSE_ID} as above
INSERT INTO baskets (org_id, warehouse_id, barcode, name, status)
VALUES
  ('{ORG_ID}', '{WAREHOUSE_ID}', 'BSK-001', 'Basket A', 'available'),
  ('{ORG_ID}', '{WAREHOUSE_ID}', 'BSK-002', 'Basket B', 'available'),
  ('{ORG_ID}', '{WAREHOUSE_ID}', 'BSK-003', 'Basket C', 'available');

-- ============================================================
-- QUICK VERSION: Run this block all at once (auto-generates ids)
-- Just replace the string values and your {USER_ID}
-- ============================================================

DO $$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_warehouse_id UUID := gen_random_uuid();
  v_user_id UUID := '{USER_ID}';  -- ← Your Supabase auth user id
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (v_org_id, 'Your Company Name', 'your-company');

  INSERT INTO warehouses (id, org_id, name, address, timezone)
  VALUES (v_warehouse_id, v_org_id, 'Main Warehouse', '123 Warehouse St', 'America/New_York');

  INSERT INTO admin_users (id, org_id, warehouse_id, role)
  VALUES (v_user_id, v_org_id, v_warehouse_id, 'admin');

  INSERT INTO baskets (org_id, warehouse_id, barcode, name, status)
  VALUES
    (v_org_id, v_warehouse_id, 'BSK-001', 'Basket A', 'available'),
    (v_org_id, v_warehouse_id, 'BSK-002', 'Basket B', 'available'),
    (v_org_id, v_warehouse_id, 'BSK-003', 'Basket C', 'available');

  -- Test workers (remove or change PINs before going live)
  INSERT INTO workers (org_id, warehouse_id, name, pin, role, is_active)
  VALUES
    (v_org_id, v_warehouse_id, 'Test Picker',   '123456', 'picker',   true),
    (v_org_id, v_warehouse_id, 'Test Packer',   '234567', 'packer',   true),
    (v_org_id, v_warehouse_id, 'Test Receiver', '345678', 'receiver', true),
    (v_org_id, v_warehouse_id, 'Test All',      '456789', 'all',      true);

  RAISE NOTICE 'Setup complete! org_id=% warehouse_id=%', v_org_id, v_warehouse_id;
END $$;
