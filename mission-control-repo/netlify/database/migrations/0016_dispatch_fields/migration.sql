-- Dispatch details for each recovery request (all additive).
ALTER TABLE recovery_requests ADD COLUMN IF NOT EXISTS assigned_pilot TEXT;
ALTER TABLE recovery_requests ADD COLUMN IF NOT EXISTS eta_text TEXT;
ALTER TABLE recovery_requests ADD COLUMN IF NOT EXISTS outcome TEXT;           -- 'found' | 'not_found'
ALTER TABLE recovery_requests ADD COLUMN IF NOT EXISTS hours_worked NUMERIC(6,2);
ALTER TABLE recovery_requests ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
