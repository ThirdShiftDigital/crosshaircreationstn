ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_new_bookings BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_new_recovery BOOLEAN NOT NULL DEFAULT FALSE;

-- Carry Chris's existing alert phone/preferences over so nothing regresses
UPDATE users
SET phone = '+16155495067', notify_new_bookings = TRUE, notify_new_recovery = TRUE
WHERE is_owner = TRUE;
