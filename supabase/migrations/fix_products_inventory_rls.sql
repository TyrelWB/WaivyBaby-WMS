-- products, bins, inventory, and product_barcodes had Row Level Security
-- enabled (likely toggled on in the Supabase dashboard) with no policy
-- attached. With RLS on and zero policies, Postgres denies every row to
-- every request that isn't using the service-role key — so any page that
-- queries these tables directly from the browser (nearly all of Pick,
-- Pack, Receive, Ship, Inventory Control, and several admin pages) was
-- silently getting empty results instead of an error.
--
-- This app has no database-level multi-tenancy: org scoping is enforced
-- entirely in application code via explicit org_id filters, the same way
-- every other table in this schema already works. These policies restore
-- that same behavior for these four tables instead of introducing a new,
-- inconsistent access model.

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to products" ON products;
CREATE POLICY "Allow all access to products" ON products
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to bins" ON bins;
CREATE POLICY "Allow all access to bins" ON bins
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to inventory" ON inventory;
CREATE POLICY "Allow all access to inventory" ON inventory
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to product_barcodes" ON product_barcodes;
CREATE POLICY "Allow all access to product_barcodes" ON product_barcodes
  FOR ALL USING (true) WITH CHECK (true);
