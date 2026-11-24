-- ============================================================================
-- Migration: Portion Control Alerts, 5:00 PM Shift Handover Counts & Anomaly Store Metadata
-- Date: 2026-11-23
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Description:
--   1. Creates `public.portion_control_alerts` to persist multi-day telescoping
--      mass-balance portion control alerts (Carne Asada #1 priority + all 8 meats),
--      AM vs PM shift attribution, on-duty staff snapshots, and Escalera de Mando
--      accountability workflow (Open -> Acknowledged -> Coached -> Supervisor Verified -> Resolved).
--   2. Creates `public.meat_shift_handover_counts` for the 5:00 PM AM->PM shift-change
--      physical count of sealed bags in walk-in cooler + open cooked/raw lbs on line,
--      enabling exact physical isolation of AM vs PM meat variance.
--   3. Adds `store_number` and `store_name` columns to `public.food_cost_anomalies`.
--   4. Enables Row Level Security (RLS) with `service_role` full access and
--      `authenticated` staff read access (`public.is_teg_staff()`).
-- ============================================================================

-- 1. Create `public.portion_control_alerts`
CREATE TABLE IF NOT EXISTS public.portion_control_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id bigint NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  span_days int NOT NULL DEFAULT 7,
  meat_key text NOT NULL,
  meat_name text NOT NULL,
  inventory_item_id uuid,
  theoretical_lbs numeric NOT NULL DEFAULT 0,
  actual_lbs numeric NOT NULL DEFAULT 0,
  variance_lbs numeric NOT NULL DEFAULT 0,
  variance_bags numeric NOT NULL DEFAULT 0,
  variance_pct numeric NOT NULL DEFAULT 0,
  excess_oz_per_taco numeric DEFAULT 0,
  dollar_loss_store numeric NOT NULL DEFAULT 0,
  dollar_loss_bodega numeric NOT NULL DEFAULT 0,
  dominant_shift text NOT NULL DEFAULT 'BOTH',
  am_theo_lbs numeric DEFAULT 0,
  pm_theo_lbs numeric DEFAULT 0,
  am_actual_lbs numeric,
  pm_actual_lbs numeric,
  am_staff jsonb DEFAULT '[]'::jsonb,
  pm_staff jsonb DEFAULT '[]'::jsonb,
  manager_email text,
  assistant_emails text[] DEFAULT '{}',
  supervisor_email text,
  escalated_to_execs boolean DEFAULT false,
  severity text NOT NULL DEFAULT 'warning',
  status text NOT NULL DEFAULT 'open',
  email_sent_at timestamptz,
  acknowledged_by text,
  acknowledged_at timestamptz,
  coaching_shift text,
  coaching_staff_names text,
  corrective_action_notes text,
  supervisor_verified_by text,
  supervisor_verified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_portion_control_alerts_window UNIQUE (store_id, period_start, period_end, meat_key)
);

CREATE INDEX IF NOT EXISTS idx_portion_control_alerts_store_status
  ON public.portion_control_alerts (store_id, status, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_portion_control_alerts_status_severity
  ON public.portion_control_alerts (status, severity, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_portion_control_alerts_period_end
  ON public.portion_control_alerts (period_end DESC);

-- 2. Create `public.meat_shift_handover_counts` (5:00 PM AM -> PM Shift Handover)
CREATE TABLE IF NOT EXISTS public.meat_shift_handover_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id bigint NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  meat_key text NOT NULL DEFAULT 'asada',
  sealed_bags numeric NOT NULL DEFAULT 0,
  open_cooked_lbs numeric NOT NULL DEFAULT 0,
  counted_by_name text NOT NULL,
  counted_by_user_id bigint,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_meat_shift_handover_store_date_meat UNIQUE (store_id, business_date, meat_key)
);

CREATE INDEX IF NOT EXISTS idx_meat_shift_handover_store_date
  ON public.meat_shift_handover_counts (store_id, business_date DESC, meat_key);

-- 3. Alter `public.food_cost_anomalies` with store metadata columns
ALTER TABLE public.food_cost_anomalies
  ADD COLUMN IF NOT EXISTS store_number bigint,
  ADD COLUMN IF NOT EXISTS store_name text;

-- 4. Maintain `updated_at` timestamps automatically
CREATE OR REPLACE FUNCTION public.touch_portion_control_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_portion_control_alerts_updated_at ON public.portion_control_alerts;
CREATE TRIGGER trg_portion_control_alerts_updated_at
  BEFORE UPDATE ON public.portion_control_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_portion_control_updated_at();

DROP TRIGGER IF EXISTS trg_meat_shift_handover_updated_at ON public.meat_shift_handover_counts;
CREATE TRIGGER trg_meat_shift_handover_updated_at
  BEFORE UPDATE ON public.meat_shift_handover_counts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_portion_control_updated_at();

REVOKE EXECUTE ON FUNCTION public.touch_portion_control_updated_at()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_portion_control_updated_at()
  TO service_role;

-- 5. Enable RLS & Configure Policies (`service_role` full access, `authenticated` TEG staff SELECT)
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'portion_control_alerts',
    'meat_shift_handover_counts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', v_tbl);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM authenticated', v_tbl);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_tbl);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'teg_staff_select_' || v_tbl, v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service_role_all_' || v_tbl, v_tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_teg_staff())',
      'teg_staff_select_' || v_tbl,
      v_tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'service_role_all_' || v_tbl,
      v_tbl
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
