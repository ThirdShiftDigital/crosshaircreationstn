ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_square_bookings BOOLEAN NOT NULL DEFAULT FALSE;

-- The owner account already has full access via is_owner, but keep this explicit for consistency
UPDATE users SET can_manage_square_bookings = TRUE WHERE is_owner = TRUE;
