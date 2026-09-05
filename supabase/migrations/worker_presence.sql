-- Presence tracking so the system knows which workers are actively on which task
-- right now, used to auto-route completed picks straight to an online packer
-- (or back to the picker themselves if nobody else is packing).
ALTER TABLE workers ADD COLUMN IF NOT EXISTS active_task TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
