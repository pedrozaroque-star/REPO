-- FIX: Type Cast UUID for Users Policy
-- El error era que 'users.id' seguramente es UUID y auth.uid() devuelve UUID, 
-- pero algún conflicto interno o definición anterior causaba la incompatibilidad.

-- 1. Intentamos la versión explícita con cast ::uuid
DROP POLICY IF EXISTS "Users can manage own data" ON users;

CREATE POLICY "Users can manage own data"
ON users
FOR ALL
TO authenticated
USING (auth.uid() = id::uuid)
WITH CHECK (auth.uid() = id::uuid);
