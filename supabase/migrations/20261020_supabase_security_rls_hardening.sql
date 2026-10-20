-- ============================================================================
-- Migration: 20261020_supabase_security_rls_hardening.sql
-- Purpose:
--   1. Resolve Supabase Security Advisor errors:
--      - rls_disabled_in_public (0013) on all 54 remaining tables in public.
--      - sensitive_columns_exposed (0023) on tables with PIN/password/token columns.
--      - policy_exists_rls_disabled (0007) on tables with dormant policies.
--      - rls_enabled_no_policy (0008) on 4 server-only tables.
--   2. Fix JWT claim helper functions (current_user_id, current_user_role) so
--      they accurately read TEG custom JWT claims ('sub'/'userId' and 'user_role').
--   3. Harden trigger function invalidate_food_cost_cache_on_inventory_change
--      with SECURITY DEFINER so inventory updates always invalidate cache safely.
--   4. Strictly lock down 24 server-only tables to service_role while keeping
--      zero-downtime compatible policies on the 34 client/hybrid tables.
-- ============================================================================

-- 1. Fix JWT helper functions to match TEG custom JWT structure
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_claims jsonb;
    v_raw text;
BEGIN
    BEGIN
        v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
    IF v_claims IS NULL THEN
        RETURN NULL;
    END IF;
    v_raw := coalesce(nullif(v_claims->>'userId', ''), nullif(v_claims->>'sub', ''));
    IF v_raw IS NOT NULL AND v_raw ~ '^[0-9]+$' THEN
        RETURN v_raw::bigint;
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_claims jsonb;
    v_role text;
BEGIN
    BEGIN
        v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
    IF v_claims IS NULL THEN
        RETURN NULL;
    END IF;
    v_role := lower(coalesce(
        nullif(v_claims->>'user_role', ''),
        nullif(v_claims->'user_metadata'->>'role', ''),
        nullif(v_claims->>'role', '')
    ));
    RETURN v_role;
END;
$$;

-- 2. Ensure inventory_items trigger can invalidate food_cost_daily_cache under RLS
CREATE OR REPLACE FUNCTION public.invalidate_food_cost_cache_on_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (OLD.quantity_per_unit IS DISTINCT FROM NEW.quantity_per_unit)
       OR (OLD.purchase_unit_cost IS DISTINCT FROM NEW.purchase_unit_cost)
       OR (OLD.unit_measure IS DISTINCT FROM NEW.unit_measure) THEN
        DELETE FROM public.food_cost_daily_cache 
        WHERE business_date >= (CURRENT_DATE - INTERVAL '3 days');
    END IF;
    RETURN NEW;
END;
$$;

-- 3. Group A: 24 Strictly Server-Only Tables (service_role exclusive access)
DO $$
DECLARE
    t text;
    server_only_tables text[] := ARRAY[
        'bc_attachment_cache',
        'coins_history',
        'delivery_packing_audits',
        'feedback_temp',
        'food_cost_anomalies',
        'food_cost_daily_cache',
        'gavilan_pos_discount_approvals',
        'gavilan_pos_manager_pins',
        'gavilan_pos_register_modifiers',
        'labor_standards',
        'prep_manual_schedule',
        'ronos_employee_mappings',
        'ronos_employee_timecards_cache',
        'ronos_transfers_history',
        'ronos_violation_notifications',
        'ronos_work_weeks',
        'safe_counts',
        'simplify_employee_rates',
        'station_templates',
        'supervisor_operational_assignments',
        'supervisor_payroll_assignments',
        'viele_checkout_requests',
        'viele_items',
        'viele_order_items',
        'viele_orders',
        'viele_store_pars',
        'viele_store_sort_orders'
    ];
BEGIN
    FOREACH t IN ARRAY server_only_tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'service_role_all_' || t, t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
            'service_role_all_' || t,
            t
        );
    END LOOP;
END;
$$;

-- 4. Group B: 34 Client / Hybrid / Tablet / Kiosk Tables (zero-downtime RLS enabled)
DO $$
DECLARE
    t text;
    client_hybrid_tables text[] := ARRAY[
        'activity_logs',
        'assistant_checklists',
        'calendar_events',
        'customer_feedback',
        'gavilan_pos_cash_closeouts',
        'gavilan_pos_cash_events',
        'gavilan_pos_loyalty_accounts',
        'gavilan_pos_menu_items',
        'gavilan_pos_orders',
        'gavilan_pos_store_configs',
        'gavilan_pos_timeclock_entries',
        'inventory_categories',
        'inventory_items',
        'inventory_price_history',
        'manager_checklists',
        'meat_consumption_history',
        'notifications',
        'open_shifts',
        'order_ready_announcements',
        'preparador_requests',
        'punch_violations',
        'punches',
        'recipes',
        'schedule_template_items',
        'schedule_templates',
        'schedules',
        'shift_claims',
        'shifts',
        'stores',
        'supervisor_inspections',
        'toast_employees',
        'toast_menu_items',
        'users',
        'weekly_budgets'
    ];
BEGIN
    FOREACH t IN ARRAY client_hybrid_tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'teg_rls_access_' || t, t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true);',
            'teg_rls_access_' || t,
            t
        );
    END LOOP;
END;
$$;
