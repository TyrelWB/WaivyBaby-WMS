-- Receiver role becomes Inventory Control, with expanded responsibilities
-- (inventory adjustments, locations, shopping list, cycle counts, damage reports, returns).
-- Also widens the constraint to include 'shipper', which was already in use in code
-- but never added to this constraint.
ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_role_check;
ALTER TABLE workers ADD CONSTRAINT workers_role_check
  CHECK (role IN ('picker', 'packer', 'inventory', 'shipper', 'all'));

UPDATE workers SET role = 'inventory' WHERE role = 'receiver';
