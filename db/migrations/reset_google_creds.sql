-- EMERGENCY RESET: Clear Google Credentials for User 47
-- This forces the UI to show "Connect Gmail" again.

UPDATE users
SET google_refresh_token = null,
    google_email_connected = null
WHERE id = 47; -- Assuming User ID is 47 based on logs, or use email if preferred
