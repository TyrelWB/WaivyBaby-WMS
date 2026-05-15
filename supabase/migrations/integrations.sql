-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  credentials jsonb NOT NULL DEFAULT '{}',
  metadata jsonb DEFAULT '{}',
  is_enabled boolean DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, provider)
);

CREATE TABLE IF NOT EXISTS order_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text,
  external_order_number text,
  external_data jsonb DEFAULT '{}',
  pushed_at timestamptz,
  tracking_number text,
  carrier text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(order_id, provider)
);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage integrations"
  ON integrations
  USING (org_id IN (SELECT org_id FROM admin_users WHERE id = auth.uid()));

CREATE POLICY "Admins manage order integrations"
  ON order_integrations
  USING (org_id IN (SELECT org_id FROM admin_users WHERE id = auth.uid()));
