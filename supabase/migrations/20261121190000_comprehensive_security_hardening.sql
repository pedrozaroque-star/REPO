-- ============================================================================
-- Migration: Comprehensive Database, RLS, Column-Level & Storage Hardening
-- Date: 2026-11-21
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Description:
--   1. Introduces unforgeable JWT role helpers (`teg_staff_role`, `is_teg_staff`,
--      `is_teg_admin_or_supervisor`) reading top-level server-signed `user_role`
--      so public Mobile App `authenticated` customers can never access internal
--      staff tables, and hardens `current_user_role()` against `user_metadata`
--      spoofing.
--   2. Enforces PostgreSQL Column-Level Privileges on `public.users`, revoking
--      client read access to `password` and `google_refresh_token` and blocking
--      all direct client `INSERT/UPDATE/DELETE` on `public.users`.
--   3. Removes wide-open `PUBLIC` / `anon` (`USING (true)`) policies across
--      financial, payroll, recipe, inventory, schedule, POS, and Basecamp tables,
--      preserving exact least-privilege `anon` access ONLY where required by
--      public QR surveys, store kiosks, and dining-room TVs.
--   4. Revokes `anon` execution on `SECURITY DEFINER` and introspection RPCs
--      (`execute_sql`, `get_func_def`, `list_triggers_on_eval`, etc.), upgrades
--      notification triggers to `SECURITY DEFINER` with pinned `search_path`,
--      and pins `search_path = public, pg_temp` on all mutable functions.
--   5. Hardens Supabase Storage buckets (`tv_menus`, `checklist-photos`,
--      `training-media`, `staff-photos`) against anonymous deletion/overwrite
--      and non-media stored-XSS uploads.
-- ============================================================================

-- 1. Core Staff Role Helpers (pinned search_path, unforgeable top-level JWT claim)
CREATE OR REPLACE FUNCTION public.teg_staff_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_claims jsonb;
BEGIN
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN '';
  END;
  IF v_claims IS NULL THEN
    RETURN '';
  END IF;
  RETURN LOWER(COALESCE(NULLIF(v_claims ->> 'user_role', ''), ''));
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_teg_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT (
    auth.role() = 'service_role'
    OR public.teg_staff_role() = ANY (ARRAY[
      'admin',
      'supervisor',
      'regional_manager',
      'manager',
      'gerente',
      'asistente',
      'assistant',
      'shift_leader',
      'auditor',
      'planificador',
      'raquel',
      'external_accounting',
      'employee'
    ])
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_teg_admin_or_supervisor()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT (
    auth.role() = 'service_role'
    OR public.teg_staff_role() = ANY (ARRAY['admin', 'supervisor', 'regional_manager'])
  );
$function$;

-- Harden current_user_role() so user_metadata->>'role' can never be spoofed by mobile customers
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN 'admin';
  END IF;
  RETURN NULLIF(public.teg_staff_role(), '');
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_claims jsonb;
  v_raw text;
BEGIN
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v_claims IS NULL THEN
    RETURN NULL;
  END IF;
  v_raw := COALESCE(NULLIF(v_claims ->> 'userId', ''), NULLIF(v_claims ->> 'sub', ''));
  IF v_raw IS NOT NULL AND v_raw ~ '^[0-9]+$' THEN
    RETURN v_raw::bigint;
  END IF;
  RETURN NULL;
END;
$function$;

-- 2. Lock Down public.users (Column-Level Secret Isolation + Service-Role-Only Writes)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teg_rls_access_users" ON public.users;
DROP POLICY IF EXISTS "read_users_authenticated" ON public.users;
DROP POLICY IF EXISTS "pol_editar_admin" ON public.users;
DROP POLICY IF EXISTS "users_self_or_admin" ON public.users;
DROP POLICY IF EXISTS "service_role_all_users" ON public.users;
DROP POLICY IF EXISTS "teg_staff_select_safe_users" ON public.users;

REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.users TO service_role;
GRANT SELECT (
  id,
  email,
  full_name,
  role,
  phone,
  is_active,
  store_scope,
  avatar_url,
  last_login,
  created_at,
  updated_at,
  auth_id,
  store_id,
  google_email_connected,
  position_type,
  toast_guid
) ON public.users TO authenticated;

CREATE POLICY "service_role_all_users"
  ON public.users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "teg_staff_select_safe_users"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (public.is_teg_staff());

-- 3. Upgrade Notification Triggers to SECURITY DEFINER with Pinned search_path
--    so Kiosk/Checklist inserts write notifications safely without exposing `notifications` or `users` to `anon`
ALTER FUNCTION public.notify_kiosk_activity() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_checklist_notifications() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_hierarchy() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_status_change() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_feedback_review() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_feedback_notifications() SECURITY DEFINER SET search_path = public, pg_temp;

-- Pin search_path on all remaining functions flagged by Supabase Security Linter (0011)
ALTER FUNCTION public.get_user_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_role() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_my_claims() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_auth_context() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_claimed_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.log_inventory_price_change() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_meat_history_avg(bigint, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.execute_sql(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bc_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_func_def(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.list_triggers_on_eval() SET search_path = public, pg_temp;
ALTER FUNCTION public.canonicalize_order_items_jsonb(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_suppress_noop_order_ready_update() SET search_path = public, pg_temp;

-- Harden SECURITY DEFINER RPCs & revoke anonymous / unauthorized execution (Linter 0028 / 0029)
CREATE OR REPLACE FUNCTION public.decrement_claimed_count(shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_teg_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.open_shifts
  SET claimed_count = GREATEST(COALESCE(claimed_count, 0) - 1, 0)
  WHERE id = shift_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_feedback_leaderboard()
RETURNS TABLE(store_id bigint, store_name text, total_reviews bigint, average_score numeric, nps_score numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_teg_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT
    s.id AS store_id,
    s.name::text AS store_name,
    COUNT(f.id) AS total_reviews,
    COALESCE(
      ROUND(
        AVG(
          CASE
            WHEN f.source = 'google' THEN f.rating
            ELSE (COALESCE(f.service_rating, 0) + COALESCE(f.food_quality_rating, 0) + COALESCE(f.cleanliness_rating, 0) + COALESCE(f.speed_rating, 0)) / 4.0
          END
        )::numeric,
        1
      ),
      0
    ) AS average_score,
    CASE
      WHEN COUNT(f.id) FILTER (WHERE f.nps_category IS NOT NULL) > 0
      THEN ROUND(((COUNT(f.id) FILTER (WHERE f.nps_category = 'promoter') - COUNT(f.id) FILTER (WHERE f.nps_category = 'detractor'))::numeric / COUNT(f.id) FILTER (WHERE f.nps_category IS NOT NULL)) * 100)
      ELSE 0
    END AS nps_score
  FROM public.stores s
  LEFT JOIN public.customer_feedback f ON s.id = f.store_id
  GROUP BY s.id, s.name
  HAVING COUNT(f.id) > 0
  ORDER BY average_score DESC;
END;
$function$;

ALTER FUNCTION public.get_feedback_overview(bigint, text) SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.execute_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sql(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_func_def(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_func_def(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.list_triggers_on_eval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_triggers_on_eval() TO service_role;

REVOKE EXECUTE ON FUNCTION public.decrement_claimed_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decrement_claimed_count(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_auth_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_context() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_claims() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_claims() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_feedback_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_feedback_leaderboard() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_feedback_overview(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_feedback_overview(bigint, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_order_ready_sync_lease(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_order_ready_sync_lease(text, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.try_acquire_order_ready_sync_lease(text, text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_order_ready_sync_lease(text, text, integer, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION
  public.handle_checklist_notifications(),
  public.handle_feedback_notifications(),
  public.invalidate_food_cost_cache_on_inventory_change(),
  public.notify_feedback_review(),
  public.notify_hierarchy(),
  public.notify_kiosk_activity(),
  public.notify_status_change()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.handle_checklist_notifications(),
  public.handle_feedback_notifications(),
  public.invalidate_food_cost_cache_on_inventory_change(),
  public.notify_feedback_review(),
  public.notify_hierarchy(),
  public.notify_kiosk_activity(),
  public.notify_status_change()
TO service_role;

-- 4. Lock Internal Staff Tables strictly to `public.is_teg_staff()` & `service_role` (Zero `anon` or Customer Access)
DO $$
DECLARE
  v_tbl text;
  v_pol record;
  v_staff_tables text[] := ARRAY[
    'activity_logs',
    'assistant_checklists',
    'bean_cooking_logs',
    'bean_timer_presets',
    'break_manual_overrides',
    'calendar_events',
    'checklist_completions',
    'event_intelligence',
    'feedback_comments',
    'gavilan_pos_cash_closeouts',
    'gavilan_pos_cash_events',
    'gavilan_pos_loyalty_accounts',
    'gavilan_pos_menu_items',
    'gavilan_pos_orders',
    'gavilan_pos_store_configs',
    'gavilan_pos_timeclock_entries',
    'inspection_comments',
    'inventory_automation_pilot_lines',
    'inventory_automation_pilot_sessions',
    'inventory_categories',
    'inventory_counts',
    'inventory_items',
    'inventory_order_lines',
    'inventory_orders',
    'inventory_par_ideal',
    'inventory_price_history',
    'inventory_usage_log',
    'inventory_weekly_bases',
    'maintenance_service_logs',
    'manager_checklists',
    'meat_consumption_daily_summary',
    'meat_consumption_history',
    'modifier_rules',
    'notifications',
    'open_shifts',
    'operating_procedures',
    'order_ready_daily_metrics',
    'par_settings',
    'position_activities',
    'preparador_requests',
    'punch_violations',
    'punches',
    'recipe_automation_rules',
    'recipes',
    'sales_daily_cache',
    'sales_discounts_log',
    'sales_projections_cache',
    'schedule_template_items',
    'schedule_templates',
    'schedules',
    'shared_brand_expenses',
    'shift_claims',
    'shifts',
    'station_assignments',
    'store_operating_expenses',
    'store_order_template',
    'store_staffing_config',
    'supervisor_inspections',
    'toast_employees',
    'toast_jobs',
    'toast_menu_items',
    'toast_ticket_consumption_snapshots',
    'tv_folders',
    'tv_images',
    'weekly_budgets',
    'weekly_operations_reports',
    'bc_answers',
    'bc_boosts',
    'bc_campfire_lines',
    'bc_campfires',
    'bc_comments',
    'bc_documents',
    'bc_memberships',
    'bc_message_boards',
    'bc_messages',
    'bc_notifications',
    'bc_people',
    'bc_pings',
    'bc_projects',
    'bc_questionnaires',
    'bc_questions',
    'bc_schedule_entries',
    'bc_schedules',
    'bc_sync_log',
    'bc_todo_assignees',
    'bc_todolist_groups',
    'bc_todolists',
    'bc_todos',
    'bc_todosets',
    'bc_uploads',
    'bc_vaults'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_staff_tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind IN ('r', 'p')
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', v_tbl);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', v_tbl);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_tbl);

      FOR v_pol IN
        SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
      END LOOP;

      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'service_role_all_' || v_tbl,
        v_tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_teg_staff()) WITH CHECK (public.is_teg_staff())',
        'teg_staff_all_' || v_tbl,
        v_tbl
      );
    END IF;
  END LOOP;
END $$;

-- 5. Least-Privilege Policies for Public Kiosk / QR / TV / Customer Mobile App Tables

-- 5a. public.stores: Public read-only (kiosks/QR); admin/service_role write
REVOKE ALL ON TABLE public.stores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stores TO anon, authenticated;
GRANT ALL ON TABLE public.stores TO service_role;
DROP POLICY IF EXISTS "kiosk_stores_select" ON public.stores;
DROP POLICY IF EXISTS "stores_select_all" ON public.stores;
DROP POLICY IF EXISTS "stores_modify_admin" ON public.stores;
DROP POLICY IF EXISTS "service_role_all_stores" ON public.stores;
DROP POLICY IF EXISTS "teg_admin_write_stores" ON public.stores;
CREATE POLICY "stores_select_all" ON public.stores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "teg_admin_write_stores" ON public.stores FOR ALL TO authenticated
  USING (public.teg_staff_role() = 'admin')
  WITH CHECK (public.teg_staff_role() = 'admin');
CREATE POLICY "service_role_all_stores" ON public.stores FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5b. public.templates, template_sections, template_questions: Public read-only (for /feedback-publico & /evaluacion/kiosk); Admin write
DO $$
DECLARE
  v_tbl text;
  v_pol record;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['templates', 'template_sections', 'template_questions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_tbl);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', v_tbl);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', v_tbl);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_tbl);

    FOR v_pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
    END LOOP;

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', 'public_read_' || v_tbl, v_tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_teg_admin_or_supervisor()) WITH CHECK (public.is_teg_admin_or_supervisor())',
      'teg_admin_write_' || v_tbl,
      v_tbl
    );
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', 'service_role_all_' || v_tbl, v_tbl);
  END LOOP;
END $$;

-- 5c. public.app_menu_cache: Public read-only; service_role write
REVOKE ALL ON TABLE public.app_menu_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_menu_cache TO anon, authenticated;
GRANT ALL ON TABLE public.app_menu_cache TO service_role;
DROP POLICY IF EXISTS "service_role_all_app_menu_cache" ON public.app_menu_cache;
CREATE POLICY "service_role_all_app_menu_cache" ON public.app_menu_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5d. public.customer_feedback: Anon INSERT only (QR /clientes & /feedback-publico); TEG Staff SELECT/UPDATE; service_role ALL
REVOKE ALL ON TABLE public.customer_feedback FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.customer_feedback TO anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.customer_feedback TO authenticated;
GRANT ALL ON TABLE public.customer_feedback TO service_role;
DROP POLICY IF EXISTS "kiosk_feedback_insert" ON public.customer_feedback;
DROP POLICY IF EXISTS "kiosk_insert_feedback" ON public.customer_feedback;
DROP POLICY IF EXISTS "Service role full access customer_feedback" ON public.customer_feedback;
DROP POLICY IF EXISTS "teg_staff_read_update_feedback" ON public.customer_feedback;
CREATE POLICY "kiosk_insert_feedback"
  ON public.customer_feedback
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (store_id IS NOT NULL AND char_length(COALESCE(comments, '')) <= 5000);
CREATE POLICY "teg_staff_read_update_feedback"
  ON public.customer_feedback
  FOR ALL
  TO authenticated
  USING (public.is_teg_staff())
  WITH CHECK (public.is_teg_staff());
CREATE POLICY "Service role full access customer_feedback"
  ON public.customer_feedback
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5e. public.staff_evaluations: Anon INSERT only (Kiosk /evaluacion/kiosk); TEG Staff SELECT/UPDATE; service_role ALL
REVOKE ALL ON TABLE public.staff_evaluations FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.staff_evaluations TO anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.staff_evaluations TO authenticated;
GRANT ALL ON TABLE public.staff_evaluations TO service_role;
DROP POLICY IF EXISTS "Ver evaluaciones" ON public.staff_evaluations;
DROP POLICY IF EXISTS "admin_select_staff_eval" ON public.staff_evaluations;
DROP POLICY IF EXISTS "kiosk_staff_insert" ON public.staff_evaluations;
DROP POLICY IF EXISTS "teg_staff_read_update_staff_eval" ON public.staff_evaluations;
DROP POLICY IF EXISTS "service_role_all_staff_evaluations" ON public.staff_evaluations;
CREATE POLICY "kiosk_staff_insert"
  ON public.staff_evaluations
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (store_id IS NOT NULL);
CREATE POLICY "teg_staff_read_update_staff_eval"
  ON public.staff_evaluations
  FOR ALL
  TO authenticated
  USING (public.is_teg_staff())
  WITH CHECK (public.is_teg_staff());
CREATE POLICY "service_role_all_staff_evaluations"
  ON public.staff_evaluations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5f. public.order_ready_announcements & order_ready_settings: Public SELECT only (TV /order-ready-board?tv=1); TEG Staff / service_role write
DO $$
DECLARE
  v_tbl text;
  v_pol record;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['order_ready_announcements', 'order_ready_settings']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_tbl);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', v_tbl);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', v_tbl);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_tbl);

    FOR v_pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
    END LOOP;

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', 'public_tv_read_' || v_tbl, v_tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_teg_staff()) WITH CHECK (public.is_teg_staff())',
      'teg_staff_write_' || v_tbl,
      v_tbl
    );
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', 'service_role_all_' || v_tbl, v_tbl);
  END LOOP;
END $$;

-- 5g. Customer Mobile App User-Scoped Tables: Revoke anon grants & enforce explicit WITH CHECK (auth.uid() = user_id)
REVOKE ALL ON TABLE
  public.app_carts,
  public.app_devices,
  public.app_favorite_orders,
  public.app_rewards_balances,
  public.app_rewards_transactions,
  public.app_orders,
  public.app_quotes,
  public.app_users
FROM PUBLIC, anon;

DROP POLICY IF EXISTS "Users can manage their own cart" ON public.app_carts;
CREATE POLICY "Users can manage their own cart" ON public.app_carts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own device tokens" ON public.app_devices;
CREATE POLICY "Users can manage their own device tokens" ON public.app_devices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their favorite orders" ON public.app_favorite_orders;
CREATE POLICY "Users can manage their favorite orders" ON public.app_favorite_orders FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own reward balance" ON public.app_rewards_balances;
CREATE POLICY "Users can view their own reward balance" ON public.app_rewards_balances FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own reward transactions" ON public.app_rewards_transactions;
CREATE POLICY "Users can view their own reward transactions" ON public.app_rewards_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 5h. Phone Agent Tables (Linter 0008): Add explicit service_role policies & revoke anon/authenticated
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'phone_agent_config',
    'phone_call_status_tombstones',
    'phone_callback_requests',
    'phone_calls',
    'phone_knowledge_base',
    'phone_special_hours'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_tbl);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service_role_all_' || v_tbl, v_tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'service_role_all_' || v_tbl,
        v_tbl
      );
    END IF;
  END LOOP;
END $$;

-- 5i. Revoke dangling `anon` privileges on remaining backend service_role-only tables
REVOKE ALL ON TABLE
  public.integrations,
  public.food_cost_daily_cache,
  public.accounting_gl_accounts,
  public.accounting_sales_packets,
  public.accounting_site_mappings,
  public.accounting_sync_logs,
  public.app_order_outbox,
  public.app_payment_events,
  public.viele_items,
  public.viele_order_items,
  public.viele_orders,
  public.viele_store_pars,
  public.viele_store_sort_orders
FROM PUBLIC, anon, authenticated;

-- 6. Harden Supabase Storage Buckets (MIME allowlists + eliminate anonymous TV/bucket delete & arbitrary upload)
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ],
  file_size_limit = COALESCE(file_size_limit, 26214400)
WHERE id = 'checklist-photos';

UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav',
    'audio/mp4'
  ],
  file_size_limit = COALESCE(file_size_limit, 52428800)
WHERE id = 'training-media';

DROP POLICY IF EXISTS "Anon Delete Access tv_menus" ON storage.objects;
DROP POLICY IF EXISTS "Anon Update Access tv_menus" ON storage.objects;
DROP POLICY IF EXISTS "Anon Upload Access tv_menus" ON storage.objects;
DROP POLICY IF EXISTS "Allow public upload 1bkkjy_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow public upload staff" ON storage.objects;
DROP POLICY IF EXISTS "Allow public upload feedback" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete Checklist Photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload Checklist Photos" ON storage.objects;
DROP POLICY IF EXISTS "teg_staff_manage_tv_menus" ON storage.objects;
DROP POLICY IF EXISTS "teg_staff_manage_staff_photos" ON storage.objects;
DROP POLICY IF EXISTS "kiosk_insert_feedback_photos" ON storage.objects;
DROP POLICY IF EXISTS "kiosk_insert_checklist_photos" ON storage.objects;
DROP POLICY IF EXISTS "teg_staff_delete_checklist_photos" ON storage.objects;

CREATE POLICY "teg_staff_manage_tv_menus"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'tv_menus' AND public.is_teg_admin_or_supervisor())
  WITH CHECK (bucket_id = 'tv_menus' AND public.is_teg_admin_or_supervisor());

CREATE POLICY "teg_staff_manage_staff_photos"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'staff-photos' AND public.is_teg_staff())
  WITH CHECK (bucket_id = 'staff-photos' AND public.is_teg_staff());

CREATE POLICY "kiosk_insert_feedback_photos"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'feedback-photos');

CREATE POLICY "kiosk_insert_checklist_photos"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'checklist-photos');

CREATE POLICY "teg_staff_delete_checklist_photos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'checklist-photos' AND public.is_teg_staff());
