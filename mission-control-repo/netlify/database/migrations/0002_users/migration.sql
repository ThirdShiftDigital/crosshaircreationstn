-- Multi-user accounts with per-module permissions

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit_content BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit_bookings BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit_leads BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit_tasks BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit_notes BOOLEAN NOT NULL DEFAULT FALSE,
  can_view_square BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_team BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Link sessions to a specific user
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Seed the permanent owner account (Chris) — full access, cannot be edited or removed by anyone
INSERT INTO users (
  name, email, password_hash, password_salt, is_owner,
  can_edit_content, can_edit_bookings, can_edit_leads, can_edit_tasks, can_edit_notes, can_view_square, can_manage_team
) VALUES (
  'Chris Keyes', 'chris@crosshaircreationstn.com',
  '02cb870f34cd26e683ce4cbdaefef2d38b3b9a93a914a7406943f1edf146ba086943d7aae54da25e19431158db515461722f297b932393fe3484025cb2306cf2',
  'c816c8810347e298998ce285f46016d2',
  TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
)
ON CONFLICT (email) DO NOTHING;
