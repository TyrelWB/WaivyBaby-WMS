-- Run this in your Supabase SQL editor
-- Wix integration retired (replaced by the Lovable storefront via /api/external/*)

DELETE FROM integrations WHERE provider = 'wix';

-- Wix-era columns are left in place (historical data for past Wix orders/products):
--   products.wix_product_id, products.wix_variant_id, products.wix_inventory_item_id
--   orders.wix_order_id
