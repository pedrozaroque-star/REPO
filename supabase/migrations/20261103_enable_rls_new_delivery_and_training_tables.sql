-- =============================================================================
-- MIGRATION: 20261103_enable_rls_new_delivery_and_training_tables.sql
-- DESCRIPTION: Enables Row-Level Security (RLS) and service_role-only policies
--              on the 5 tables created between Oct 28 and Oct 30, 2026
--              (delivery_platform_orders, delivery_platform_payouts,
--               delivery_platform_store_mappings, training_enrollments,
--               training_sop_modules) plus policy on order_ready_sync_leases,
--              resolving Supabase Security Advisor `rls_disabled_in_public`.
-- =============================================================================

DO $$
DECLARE
  t text;
  server_only_tables text[] := ARRAY[
    'delivery_platform_orders',
    'delivery_platform_payouts',
    'delivery_platform_store_mappings',
    'training_enrollments',
    'training_sop_modules',
    'order_ready_sync_leases'
  ];
BEGIN
  FOREACH t IN ARRAY server_only_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated;', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role;', t);
      EXECUTE format('DROP POLICY IF EXISTS "service_role_full_access_%s" ON public.%I;', t, t);
      EXECUTE format(
        'CREATE POLICY "service_role_full_access_%s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
        t, t
      );
    END IF;
  END LOOP;
END $$;
