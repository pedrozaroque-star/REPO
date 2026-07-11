-- ============================================================================
-- MIGRACIÓN: Crear tabla safe_counts
-- Módulo Caja Fuerte — Registro de conteos de dinero en caja fuerte por sucursal
-- ============================================================================
-- Billetes sueltos, paquetes de $1 (100 billetes), rollos BOA de monedas,
-- cajas registradoras ($250 stock c/u) y uniformes.
-- Los totales se calculan automáticamente con columnas GENERATED.
-- ============================================================================

DROP TABLE IF EXISTS safe_counts CASCADE;

CREATE TABLE safe_counts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id BIGINT NOT NULL REFERENCES stores(id),
  counted_by BIGINT NOT NULL REFERENCES users(id),
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  business_date DATE NOT NULL,

  -- ===================== BILLETES (Bills) =====================
  bills_100 INT NOT NULL DEFAULT 0,
  bills_50  INT NOT NULL DEFAULT 0,
  bills_20  INT NOT NULL DEFAULT 0,
  bills_10  INT NOT NULL DEFAULT 0,
  bills_5   INT NOT NULL DEFAULT 0,
  bills_1   INT NOT NULL DEFAULT 0,
  bills_total NUMERIC(12,2) GENERATED ALWAYS AS (
    bills_100 * 100 + bills_50 * 50 + bills_20 * 20 +
    bills_10 * 10 + bills_5 * 5 + bills_1
  ) STORED,

  -- ===================== CAMBIO — Rollos & Paquetes (Bank of America) =====================
  packs_ones    INT NOT NULL DEFAULT 0,     -- Paquetes de billetes de $1 (100 billetes = $100 c/u)
  rolls_quarter INT NOT NULL DEFAULT 0,     -- 40 monedas por rollo = $10.00 c/u
  rolls_dime    INT NOT NULL DEFAULT 0,     -- 50 monedas por rollo = $5.00 c/u
  rolls_nickel  INT NOT NULL DEFAULT 0,     -- 40 monedas por rollo = $2.00 c/u
  rolls_penny   INT NOT NULL DEFAULT 0,     -- 50 monedas por rollo = $0.50 c/u
  coins_total NUMERIC(12,2) GENERATED ALWAYS AS (
    packs_ones * 100 + rolls_quarter * 10 + rolls_dime * 5 +
    rolls_nickel * 2 + rolls_penny * 0.50
  ) STORED,

  -- Cambio suelto (monedas fuera de rollo)
  loose_change NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- ===================== CAJAS REGISTRADORAS (Cash Drawers) =====================
  num_drawers   INT NOT NULL DEFAULT 1,
  drawer_stock  NUMERIC(8,2) NOT NULL DEFAULT 250.00,
  drawers_total NUMERIC(12,2) GENERATED ALWAYS AS (
    num_drawers * drawer_stock
  ) STORED,

  -- ===================== UNIFORMES (placeholder) =====================
  uniforms_amount NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- ===================== GRAN TOTAL =====================
  grand_total NUMERIC(12,2) GENERATED ALWAYS AS (
    (bills_100 * 100 + bills_50 * 50 + bills_20 * 20 + bills_10 * 10 + bills_5 * 5 + bills_1) +
    (packs_ones * 100 + rolls_quarter * 10 + rolls_dime * 5 + rolls_nickel * 2 + rolls_penny * 0.50) +
    loose_change + (num_drawers * drawer_stock) + uniforms_amount
  ) STORED,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_safe_counts_store_date ON safe_counts(store_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_safe_counts_business_date ON safe_counts(business_date DESC);

-- Comentario de tabla
COMMENT ON TABLE safe_counts IS 'Registro de conteos de caja fuerte por sucursal. Billetes, paquetes de $1, rollos BOA, cajas registradoras y uniformes.';
