-- Correct Chris's real cell number and guarantee his notifications are on,
-- regardless of what may have gotten changed via the dashboard UI previously.
UPDATE users
SET phone = '+16159453161', notify_new_bookings = TRUE, notify_new_recovery = TRUE
WHERE is_owner = TRUE;
