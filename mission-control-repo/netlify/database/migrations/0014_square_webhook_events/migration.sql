-- Square retries webhooks it isn't sure we received. Recording each event_id
-- lets the webhook ignore repeats instead of sending duplicate booking alerts.
CREATE TABLE IF NOT EXISTS square_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
