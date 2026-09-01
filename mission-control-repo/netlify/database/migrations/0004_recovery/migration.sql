CREATE TABLE IF NOT EXISTS recovery_requests (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  recovery_type TEXT NOT NULL, -- 'pet' or 'deer'
  location_description TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'new', -- new, contacted, en_route, resolved, closed
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_recovery_requests BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET can_view_recovery_requests = TRUE WHERE is_owner = TRUE;
