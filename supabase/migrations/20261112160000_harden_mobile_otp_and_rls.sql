-- ============================================================================
-- Migration: 20261112160000_harden_mobile_otp_and_rls.sql
-- Description:
--   1. Creates durable `public.app_mobile_otp_challenges` table (service_role only)
--      so email OTP codes, per-IP/email rate limits, and brute-force lockouts
--      never create unverified ghost users in `auth.users` or `app_users`.
--   2. Creates O(1) `public.get_auth_user_id_by_email(text)` helper RPC
--      restricted exclusively to `service_role`.
--   3. Removes stale audit ghost user `nonexistent-audit-test@tacosgavilan.com`.
--   4. Removes permissive `teg_rls_access_*` policies on `stores` and
--      `customer_feedback` (plus broad `authenticated_select_feedback`),
--      after migrating internal TEG admin views to authenticated `/api/stores`
--      and `/api/feedback` routes.
--   5. Adds `'delivery'` to `app_orders_pickup_method_check` and
--      `app_quotes_pickup_method_check` constraints.
-- ============================================================================

-- 1. Durable OTP Challenge & Rate Limit Table
CREATE TABLE IF NOT EXISTS public.app_mobile_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  client_ip text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_until timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_mobile_otp_email_created
  ON public.app_mobile_otp_challenges (lower(email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_mobile_otp_ip_created
  ON public.app_mobile_otp_challenges (client_ip, created_at DESC)
  WHERE client_ip IS NOT NULL;

ALTER TABLE public.app_mobile_otp_challenges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_mobile_otp_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_mobile_otp_challenges TO service_role;

DROP POLICY IF EXISTS "Service role full access app_mobile_otp_challenges" ON public.app_mobile_otp_challenges;
CREATE POLICY "Service role full access app_mobile_otp_challenges"
  ON public.app_mobile_otp_challenges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. O(1) Email Lookup RPC in auth.users (replaces 1000-user pagination cap)
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
    AND deleted_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO service_role;

-- 3. Remove Ghost Audit User (nonexistent-audit-test@tacosgavilan.com)
DELETE FROM public.app_users
WHERE id = '7c5da6b3-edaf-476f-a524-575652beb95e';

DELETE FROM auth.users
WHERE id = '7c5da6b3-edaf-476f-a524-575652beb95e'
   OR lower(email) = 'nonexistent-audit-test@tacosgavilan.com';

-- 4. Lock Down Permissive RLS on stores, customer_feedback, and app_users
DROP POLICY IF EXISTS "teg_rls_access_stores" ON public.stores;

DROP POLICY IF EXISTS "teg_rls_access_customer_feedback" ON public.customer_feedback;
DROP POLICY IF EXISTS "authenticated_select_feedback" ON public.customer_feedback;
DROP POLICY IF EXISTS "Service role full access customer_feedback" ON public.customer_feedback;
CREATE POLICY "Service role full access customer_feedback"
  ON public.customer_feedback
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view and edit their own profile" ON public.app_users;
DROP POLICY IF EXISTS "Users select own app_users profile" ON public.app_users;
DROP POLICY IF EXISTS "Users update own app_users profile" ON public.app_users;
DROP POLICY IF EXISTS "Service role full access app_users" ON public.app_users;

CREATE POLICY "Users select own app_users profile"
  ON public.app_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users update own app_users profile"
  ON public.app_users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Service role full access app_users"
  ON public.app_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. Allow 'delivery' in app_orders and app_quotes pickup_method checks
ALTER TABLE public.app_orders
  DROP CONSTRAINT IF EXISTS app_orders_pickup_method_check;
ALTER TABLE public.app_orders
  ADD CONSTRAINT app_orders_pickup_method_check
  CHECK (pickup_method::text = ANY (ARRAY['curbside'::character varying, 'in_store'::character varying, 'drive_thru'::character varying, 'delivery'::character varying]::text[]));

ALTER TABLE public.app_quotes
  DROP CONSTRAINT IF EXISTS app_quotes_pickup_method_check;
ALTER TABLE public.app_quotes
  ADD CONSTRAINT app_quotes_pickup_method_check
  CHECK (pickup_method = ANY (ARRAY['in_store'::text, 'curbside'::text, 'drive_thru'::text, 'delivery'::text]));
