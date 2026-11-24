-- ============================================================================
-- Migration: Mandatory Portion Control Corrections, 24h Manager SLA & Progressive Strikes (1-2-3 Expulsion)
-- Date: 2026-11-23
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Description:
--   1. Alters `public.portion_control_alerts` with 24-hour mandatory SLA columns
--      (`due_at`, `is_overdue`, `overdue_escalated_at`), `dish_equivalence_summary`,
--      and `disciplinary_action_id` linking to the mandatory Strike record.
--   2. Creates `public.portion_disciplinary_actions` as an immutable staff-readable,
--      service_role-managed audit ledger for progressive portioning discipline:
--        * Strike 1 (`strike_1_warning`): Written Warning + Mandatory Scale Recalibration (1.5 oz / 6.0 oz)
--        * Strike 2 (`strike_2_final_suspension`): Final Administrative Record + Unpaid Suspension
--        * Strike 3+ (`strike_3_expulsion`): Mandatory Expulsion / Termination (`pending_mandatory_expulsion`)
--   3. Enables Row Level Security (RLS) with `service_role` full access and
--      `authenticated` TEG staff `SELECT` only (`public.is_teg_staff()`).
-- ============================================================================

ALTER TABLE public.portion_control_alerts
  ADD COLUMN IF NOT EXISTS due_at timestamptz DEFAULT (now() + interval '24 hours'),
  ADD COLUMN IF NOT EXISTS is_overdue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overdue_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS dish_equivalence_summary jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS disciplinary_action_id uuid;

UPDATE public.portion_control_alerts
SET due_at = COALESCE(created_at, now()) + interval '24 hours'
WHERE due_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portion_control_alerts_overdue_sla
  ON public.portion_control_alerts (is_overdue, status, due_at);

CREATE TABLE IF NOT EXISTS public.portion_disciplinary_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid REFERENCES public.portion_control_alerts(id) ON DELETE SET NULL,
  store_id bigint NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  employee_key text NOT NULL,
  employee_toast_guid text,
  employee_user_id bigint,
  employee_name text NOT NULL,
  employee_role text NOT NULL,
  employee_email text,
  shift text NOT NULL DEFAULT 'PM',
  meat_key text NOT NULL DEFAULT 'asada',
  meat_name text NOT NULL DEFAULT 'Carne Asada',
  offense_number int NOT NULL,
  disciplinary_stage text NOT NULL,
  excess_bags numeric NOT NULL DEFAULT 0,
  dollar_loss_store numeric NOT NULL DEFAULT 0,
  scale_audit_completed boolean NOT NULL DEFAULT true,
  sampled_tacos_avg_oz numeric NOT NULL,
  sampled_burritos_avg_oz numeric NOT NULL,
  mandatory_commitment text NOT NULL,
  issued_by_name text NOT NULL,
  issued_by_email text,
  supervisor_verified_by text,
  supervisor_verified_at timestamptz,
  expulsion_status text NOT NULL DEFAULT 'not_applicable',
  hr_exec_notified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT chk_portion_disc_shift CHECK (shift IN ('AM', 'PM', 'BOTH')),
  CONSTRAINT chk_portion_disc_stage CHECK (
    disciplinary_stage IN ('strike_1_warning', 'strike_2_final_suspension', 'strike_3_expulsion')
  ),
  CONSTRAINT chk_portion_disc_expulsion_status CHECK (
    expulsion_status IN ('not_applicable', 'pending_mandatory_expulsion', 'expulsion_confirmed', 'appealed_by_director')
  ),
  CONSTRAINT chk_portion_disc_offense_positive CHECK (offense_number >= 1)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_portion_alerts_disciplinary_action'
  ) THEN
    ALTER TABLE public.portion_control_alerts
      ADD CONSTRAINT fk_portion_alerts_disciplinary_action
      FOREIGN KEY (disciplinary_action_id)
      REFERENCES public.portion_disciplinary_actions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_portion_disciplinary_actions_employee_created
  ON public.portion_disciplinary_actions (employee_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portion_disciplinary_actions_store_created
  ON public.portion_disciplinary_actions (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portion_disciplinary_actions_expulsion_status
  ON public.portion_disciplinary_actions (expulsion_status);

ALTER TABLE public.portion_disciplinary_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.portion_disciplinary_actions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.portion_disciplinary_actions FROM authenticated;
GRANT SELECT ON TABLE public.portion_disciplinary_actions TO authenticated;
GRANT ALL ON TABLE public.portion_disciplinary_actions TO service_role;

DROP POLICY IF EXISTS teg_staff_select_portion_disciplinary_actions ON public.portion_disciplinary_actions;
DROP POLICY IF EXISTS service_role_all_portion_disciplinary_actions ON public.portion_disciplinary_actions;

CREATE POLICY teg_staff_select_portion_disciplinary_actions
  ON public.portion_disciplinary_actions
  FOR SELECT
  TO authenticated
  USING (public.is_teg_staff());

CREATE POLICY service_role_all_portion_disciplinary_actions
  ON public.portion_disciplinary_actions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
