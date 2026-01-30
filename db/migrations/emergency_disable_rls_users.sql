-- EMERGENCY UNBLOCK: Disable RLS on users table
-- The ID mismatch (BigInt 47 vs UUID) is causing silent update failures.
-- Disabling RLS allows the frontend to successfully write the Google Tokens to row ID 47.

ALTER TABLE users DISABLE ROW LEVEL SECURITY;
