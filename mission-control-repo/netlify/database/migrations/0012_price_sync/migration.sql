CREATE TABLE IF NOT EXISTS price_sync_mapping (
  content_key TEXT PRIMARY KEY,
  square_variation_id TEXT NOT NULL,
  square_variation_name TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);
