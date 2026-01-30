-- FIX: Permitir que los usuarios guarden sus propios tokens de Google
-- Ejecuta esto en el SQL Editor de Supabase para desbloquear la tabla 'users'

-- 1. Asegurar que RLS está activo (buenas prácticas, pero flexibles)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar políticas antiguas restrictivas (limpieza)
DROP POLICY IF EXISTS "Users can view own data" ON users;
DROP POLICY IF EXISTS "Users can update own data" ON users;
DROP POLICY IF EXISTS "Enable read access for all users" ON users;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON users;
DROP POLICY IF EXISTS "Enable update for users based on email" ON users;

-- 3. Crear Política Permisiva para el Usuario Dueño
-- Permite VER (Select) y EDITAR (Update) solo si el ID coincide con su usuario logueado
CREATE POLICY "Users can manage own data"
ON users
FOR ALL
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 4. (Opcional) Si nada funciona, descomenta la siguiente línea para desactivar seguridad totalmente:
-- ALTER TABLE users DISABLE ROW LEVEL SECURITY;
