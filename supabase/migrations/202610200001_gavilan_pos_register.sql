-- =============================================================================
-- Gavilan POS — Cashier Register (Caja) data-driven catalog + manager approvals
-- Fecha: 2026-10-20
--
-- 1) gavilan_pos_register_modifiers
--    Botones de modificador de la pantalla de caja por familia (Tacos, Burritos...),
--    sembrados desde el uso REAL de las cajeras (pmix_daily_cache: 349 días x 15 tiendas)
--    y con precio REAL cobrado (empírico PMIX; fallback toast_menu_items / export Toast).
--    kind:
--      CHIP     -> modificador Toast opcional (1 toque)
--      REQUIRED -> opción de un grupo obligatorio (tortilla, estilo de huevo, queso nachos, tacos del plate...)
--      NOTE     -> nota que las cajeras escribían a mano en Toast y ahora es botón (sin GUID Toast, $0)
--
-- 2) gavilan_pos_manager_pins
--    PIN de autorización de gerente (hash scrypt + salt). Nunca se guarda el PIN en claro.
--
-- 3) gavilan_pos_discount_approvals
--    Bitácora de descuentos autorizados (Empleado / Policía) con quién autorizó.
--
-- RLS habilitado sin políticas públicas: solo el backend (service role) lee/escribe.
-- Sin columnas generadas (regla 428C9).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gavilan_pos_register_modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CHIP', 'REQUIRED', 'NOTE')),
  group_key TEXT NOT NULL DEFAULT 'chips',
  label TEXT NOT NULL,
  toast_guid TEXT,
  toast_name TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_source TEXT NOT NULL DEFAULT 'PMIX_EMPIRICAL',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_alert BOOLEAN NOT NULL DEFAULT false,
  usage_units INTEGER NOT NULL DEFAULT 0,
  usage_share_pct NUMERIC(8,3) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  source_window TEXT NOT NULL DEFAULT 'pmix_daily_cache 349 dias x 15 tiendas',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gavilan_pos_register_modifiers_uniq UNIQUE (family, group_key, label)
);

CREATE INDEX IF NOT EXISTS idx_gpos_reg_mods_family ON public.gavilan_pos_register_modifiers (family, kind, sort_order);

CREATE TABLE IF NOT EXISTS public.gavilan_pos_manager_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_number INTEGER,
  approver_name TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gavilan_pos_manager_pins_email_uniq UNIQUE (approver_email)
);

CREATE TABLE IF NOT EXISTS public.gavilan_pos_discount_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_order_id TEXT,
  store_number INTEGER,
  business_date DATE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('EMPLEADO', 'POLICIA', 'VOID_ORDER')),
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  approver_name TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  requested_by_email TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gpos_disc_appr_date ON public.gavilan_pos_discount_approvals (business_date, store_number);

ALTER TABLE public.gavilan_pos_register_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gavilan_pos_manager_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gavilan_pos_discount_approvals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.gavilan_pos_register_modifiers FROM anon, authenticated;
REVOKE ALL ON public.gavilan_pos_manager_pins FROM anon, authenticated;
REVOKE ALL ON public.gavilan_pos_discount_approvals FROM anon, authenticated;
