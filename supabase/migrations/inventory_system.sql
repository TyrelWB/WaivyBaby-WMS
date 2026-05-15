-- Wix product mapping
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS wix_product_id text,
  ADD COLUMN IF NOT EXISTS wix_variant_id text,
  ADD COLUMN IF NOT EXISTS wix_inventory_item_id text;

-- Wix order ID for fulfillment callbacks
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS wix_order_id text;

-- Every inventory change logged here
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type text NOT NULL, -- receive | reserve | release | ship | adjust | damage | return | cancel
  quantity_change integer NOT NULL,
  qty_on_hand_after integer,
  qty_reserved_after integer,
  qty_available_after integer,
  reference_type text,  -- order | return | adjustment | receiving_report
  reference_id text,
  note text,
  created_at timestamptz DEFAULT now()
);

-- Every Wix / ShipStation sync attempt
CREATE TABLE IF NOT EXISTS sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,          -- wix | shipstation
  event_type text NOT NULL,        -- inventory_update | order_fulfill | order_create
  status text NOT NULL,            -- success | failed
  reference_type text,             -- product | order
  reference_id text,
  payload jsonb DEFAULT '{}',
  response jsonb DEFAULT '{}',
  error text,
  attempts integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage inventory_movements" ON inventory_movements
  USING (org_id IN (SELECT org_id FROM admin_users WHERE id = auth.uid()));

CREATE POLICY "Admins view sync_logs" ON sync_logs
  USING (org_id IN (SELECT org_id FROM admin_users WHERE id = auth.uid()));
