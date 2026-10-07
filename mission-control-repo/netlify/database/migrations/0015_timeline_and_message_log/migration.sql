-- When the request last changed status (used for "time in status" and sorting).
ALTER TABLE recovery_requests ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- Timeline: creation, status changes, notes, duplicate submissions, messages sent by staff.
CREATE TABLE IF NOT EXISTS recovery_events (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES recovery_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- 'created' | 'status' | 'note' | 'duplicate' | 'message'
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recovery_events_request_idx ON recovery_events (request_id, created_at);

-- Every text/email we try to send (customer and team), with the provider's answer.
CREATE TABLE IF NOT EXISTS message_log (
  id SERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES recovery_requests(id) ON DELETE CASCADE,
  audience TEXT NOT NULL,          -- 'customer' | 'team'
  channel TEXT NOT NULL,           -- 'sms' | 'email'
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL,            -- sent | queued | accepted | delivered | undelivered | failed | skipped
  provider_id TEXT,                -- Twilio message SID or Resend id
  error TEXT,
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS message_log_request_idx ON message_log (request_id, created_at);
CREATE INDEX IF NOT EXISTS message_log_provider_idx ON message_log (provider_id);
