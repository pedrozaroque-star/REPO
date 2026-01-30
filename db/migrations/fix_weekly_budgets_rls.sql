
-- Solución RLS para weekly_budgets
-- Corre este script en el Editor SQL de Supabase

-- 1. Eliminar políticas antiguas (para limpiar)
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON weekly_budgets;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON weekly_budgets;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON weekly_budgets;

-- 2. Crear Política Universal (Permisiva para usuarios logueados)
-- "Si estás logueado, puedes leer, crear y modificar presupuestos"
CREATE POLICY "Authenticated Users Can Manage Budgets"
ON weekly_budgets
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 3. Asegurar que RLS esté activo
ALTER TABLE weekly_budgets ENABLE ROW LEVEL SECURITY;
