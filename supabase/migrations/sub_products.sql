-- Sub-products support

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_sub_product BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS product_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  sub_product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, sub_product_id)
);

CREATE TABLE IF NOT EXISTS order_item_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
  sub_product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  is_substituted BOOLEAN DEFAULT FALSE,
  original_sub_product_id UUID REFERENCES products(id),
  substituted_by UUID REFERENCES admin_users(id),
  substituted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
