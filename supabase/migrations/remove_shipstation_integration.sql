-- Run this in your Supabase SQL editor
-- ShipStation replaced by Shippo for rates, labels, and tracking

DELETE FROM integrations WHERE provider = 'shipstation';
DELETE FROM order_integrations WHERE provider = 'shipstation';
