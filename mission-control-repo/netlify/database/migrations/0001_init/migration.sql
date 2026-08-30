-- Crosshair Creations dashboard schema

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

-- Simple key/value store for editable site content (pricing, text fields, contact info)
CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  service TEXT,
  contact TEXT,
  scheduled_date DATE,
  scheduled_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, completed, cancelled
  price TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  interest TEXT,
  status TEXT NOT NULL DEFAULT 'new', -- new, contacted, quoted, won, lost
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  due_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed default content values matching what's currently live on the site
INSERT INTO site_content (key, value) VALUES
  ('re_essentials_price', '$225'),
  ('re_plus_price', '$325'),
  ('re_premium_price', '$495'),
  ('drone_basic_price', '$175'),
  ('drone_standard_price', '$299'),
  ('drone_commercial_price', '$599'),
  ('construction_monthly_price', '$299'),
  ('construction_biweekly_price', '$549/mo'),
  ('construction_weekly_price', '$999/mo'),
  ('recovery_deer_day_price', '$185'),
  ('recovery_pet_price', '$200'),
  ('recovery_deer_night_price', '$250'),
  ('recovery_large_property_price', '$350'),
  ('recovery_extended_thermal_price', '$450'),
  ('business_essentials_price', '$199'),
  ('business_growth_price', '$349'),
  ('business_premium_price', '$599'),
  ('contact_phone', '(615) 549-5067'),
  ('contact_email', 'info@crosshaircreationstn.com'),
  ('hero_subtext', 'Professional aerial photography and drone videography for real estate, business, and unforgettable moments across Middle Tennessee.')
ON CONFLICT (key) DO NOTHING;
