-- One-time submission id sent by the /recovery form. A repeat submit with the
-- same id (double tap, network retry) returns the original request instead of
-- creating a second one. Postgres allows many NULLs in a unique index, so older
-- rows without an id are unaffected.
ALTER TABLE recovery_requests ADD COLUMN IF NOT EXISTS submission_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS recovery_requests_submission_id_key ON recovery_requests (submission_id);

-- Speeds up the "same phone + type in the last few minutes" duplicate check.
CREATE INDEX IF NOT EXISTS recovery_requests_created_at_idx ON recovery_requests (created_at);
