ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS weight_oz integer;

ALTER TABLE order_integrations
  ADD COLUMN IF NOT EXISTS label_url text;
