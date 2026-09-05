-- Replace the old 5-tier Search & Recovery pricing with a simpler day/night + hourly model
DELETE FROM site_content WHERE key IN (
  'recovery_deer_day_price', 'recovery_pet_price', 'recovery_deer_night_price',
  'recovery_large_property_price', 'recovery_extended_thermal_price'
);

INSERT INTO site_content (key, value) VALUES
  ('recovery_day_base', '$225'),
  ('recovery_day_hourly', '$185/hr'),
  ('recovery_night_base', '$250'),
  ('recovery_night_hourly', '$225/hr')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
