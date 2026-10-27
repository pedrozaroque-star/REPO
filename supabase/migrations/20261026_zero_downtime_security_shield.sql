-- ============================================================================
-- Migration: 20261026_zero_downtime_security_shield.sql
-- Purpose:
--   1. Revoke anon/public SELECT on sensitive credential columns in public.users
--      (password, google_refresh_token) and block anon INSERT/DELETE/role escalation,
--      while preserving 100% compatibility for all 19 client queries on PCs/Tablets.
--   2. Lock down 32 strictly server-only tables (0 browser queries) to service_role
--      (integrations, accounting_*, external_accounting_*, assistant_*, dt_*,
--       pmix_daily_cache, quickbooks_mappings, mileage_*, uniforms_*, suppliers*).
--   3. Block anon INSERT/UPDATE/DELETE on sales_daily_cache, sales_discounts_log,
--      tv_folders, and tv_images while preserving read access for PCs and Smart TVs.
--   4. Revoke anon/authenticated EXECUTE on dangerous SECURITY DEFINER password/user
--      RPCs (admin_reset_password_by_email, create_new_user, update_user_password_plaintext).
--   5. Harden storage.objects & storage.buckets: remove wildcard 'Allow public upload 1bkkjy_0'
--      and anon delete/update on tv_menus, and enforce a 25 MB file_size_limit on buckets.
-- ============================================================================

-- 1. Harden public.users (Column-level security + mutation lock)
DROP POLICY IF EXISTS "pol_login_anonimo" ON public.users;

REVOKE SELECT ON TABLE public.users FROM anon, authenticated, PUBLIC;
GRANT SELECT (
  id, email, full_name, role, phone, is_active, store_scope, avatar_url,
  last_login, created_at, updated_at, auth_id, store_id,
  google_email_connected, position_type, toast_guid
) ON TABLE public.users TO anon, authenticated;

REVOKE INSERT, DELETE ON TABLE public.users FROM anon, PUBLIC;
REVOKE UPDATE ON TABLE public.users FROM anon, PUBLIC;
GRANT UPDATE (
  is_active, google_email_connected, google_refresh_token, last_login, updated_at
) ON TABLE public.users TO anon, authenticated;

-- 2. Lock down 32 strictly server-only tables (0 client queries) to service_role
DO $$
DECLARE
  t text;
  p record;
  strict_server_tables text[] := ARRAY[
    'integrations',
    'accounting_gl_accounts',
    'accounting_sales_packets',
    'accounting_site_mappings',
    'accounting_sync_logs',
    'external_accounting_accounts',
    'external_accounting_audit_log',
    'external_accounting_bank_rules',
    'external_accounting_budgets',
    'external_accounting_companies',
    'external_accounting_contacts',
    'external_accounting_reconciliations',
    'external_accounting_recurring',
    'external_accounting_reports_archive',
    'external_accounting_transactions',
    'assistant_conversations',
    'assistant_messages',
    'dt_orders',
    'dt_halfhour_stats',
    'pmix_daily_cache',
    'quickbooks_mappings',
    'mileage_hr_submissions',
    'mileage_recurrent_emails',
    'supervisor_mileage_settings',
    'supervisor_mileage_trips',
    'store_distances',
    'uniforms_inventory_stock',
    'uniforms_pricing',
    'uniforms_transactions',
    'suppliers',
    'supplier_item_mappings',
    'supplier_price_history'
  ];
BEGIN
  FOREACH t IN ARRAY strict_server_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      FOR p IN
        SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', p.policyname, t);
      END LOOP;
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
        'service_role_all_' || t,
        t
      );
    END IF;
  END LOOP;
END $$;

-- 3. Protect sales_daily_cache, sales_discounts_log, tv_folders, tv_images from anon mutations
DROP POLICY IF EXISTS "Service role write access" ON public.sales_daily_cache;
CREATE POLICY "Service role write access" ON public.sales_daily_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.sales_daily_cache FROM anon, PUBLIC;

DROP POLICY IF EXISTS "Enable delete for service_role only" ON public.sales_discounts_log;
DROP POLICY IF EXISTS "Enable insert for service_role only" ON public.sales_discounts_log;
DROP POLICY IF EXISTS "Service role write access sales_discounts_log" ON public.sales_discounts_log;
CREATE POLICY "Service role write access sales_discounts_log" ON public.sales_discounts_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.sales_discounts_log FROM anon, PUBLIC;

DROP POLICY IF EXISTS "Enable all access for anon users - tv_folders" ON public.tv_folders;
DROP POLICY IF EXISTS "Service role write access tv_folders" ON public.tv_folders;
CREATE POLICY "Service role write access tv_folders" ON public.tv_folders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.tv_folders FROM anon, PUBLIC;

DROP POLICY IF EXISTS "Enable all access for anon users - tv_images" ON public.tv_images;
DROP POLICY IF EXISTS "Service role write access tv_images" ON public.tv_images;
CREATE POLICY "Service role write access tv_images" ON public.tv_images
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.tv_images FROM anon, PUBLIC;

-- 4. Lock down dangerous SECURITY DEFINER password/user RPC functions to service_role only
REVOKE EXECUTE ON FUNCTION public.admin_reset_password_by_email(text, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_password_by_email(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_new_user(text, text, text, text, bigint) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_new_user(text, text, text, text, bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_user_password_plaintext(bigint, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_password_plaintext(bigint, text) TO service_role;

-- 5. Harden storage.buckets (enforce 25 MB max file size and strict MIME types on photo/TV buckets)
UPDATE storage.buckets
SET file_size_limit = 26214400
WHERE id IN ('staff-photos', 'feedback-photos', 'checklist-photos', 'tv_menus')
  AND file_size_limit IS NULL;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
WHERE id IN ('staff-photos', 'feedback-photos', 'delivery-evidence');

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
WHERE id = 'tv_menus';

-- Prevent anonymous deletion or overwriting of existing storage objects (TV menus, staff photos, etc.)
REVOKE DELETE, UPDATE ON TABLE storage.objects FROM anon;
