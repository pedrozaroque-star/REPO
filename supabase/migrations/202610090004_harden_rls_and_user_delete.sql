-- ==============================================================================
-- Migration: 202610090004_harden_rls_and_user_delete.sql
-- Description: Endurece las políticas RLS en public.app_orders y public.app_quotes
-- para que usuarios autenticados solo tengan permiso SELECT (lectura de sus propias
-- órdenes/cotizaciones) y jamás puedan hacer INSERT/UPDATE/DELETE directos desde el
-- cliente (ej. alterar payment_status = 'PAID'). Ajusta el DEFAULT de payment_status
-- a 'PENDING_PAYMENT' y revoca execute_sql de roles públicos/clientes.
-- ==============================================================================

-- 1. Ajustar DEFAULT de payment_status en public.app_orders
ALTER TABLE public.app_orders
  ALTER COLUMN payment_status SET DEFAULT 'PENDING_PAYMENT';

-- 2. Reemplazar políticas permisivas FOR ALL en public.app_orders por FOR SELECT exclusivo
DROP POLICY IF EXISTS "Users can view and manage their own orders" ON public.app_orders;
DROP POLICY IF EXISTS "Users can manage own orders" ON public.app_orders;
DROP POLICY IF EXISTS "Users can read own orders" ON public.app_orders;

CREATE POLICY "Users can read own orders"
  ON public.app_orders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 3. Asegurar que public.app_quotes solo permita SELECT de las cotizaciones propias
DROP POLICY IF EXISTS "Users can read own quotes" ON public.app_quotes;

CREATE POLICY "Users can read own quotes"
  ON public.app_quotes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 4. Revocar execute_sql de PUBLIC, anon y authenticated; exclusivo para service_role
REVOKE ALL ON FUNCTION public.execute_sql(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sql(TEXT) TO service_role;
