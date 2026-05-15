ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_name text,
  ADD COLUMN IF NOT EXISTS shipping_address_1 text,
  ADD COLUMN IF NOT EXISTS shipping_address_2 text,
  ADD COLUMN IF NOT EXISTS shipping_city text,
  ADD COLUMN IF NOT EXISTS shipping_state text,
  ADD COLUMN IF NOT EXISTS shipping_zip text,
  ADD COLUMN IF NOT EXISTS shipping_country text DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS shipping_phone text;
