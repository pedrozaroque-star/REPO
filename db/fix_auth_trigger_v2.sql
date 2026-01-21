-- SOLUCIÓN AL ERROR DE CREACIÓN DE USUARIOS
-- El error "invalid input syntax for type bigint" ocurre porque existe un Trigger automático
-- que intenta copiar el ID del usuario (UUID) a la tabla public.users (que usa ID numérico/BIGINT).

-- PASO 1: Eliminar el trigger conflictivo actual
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- PASO 2: (Opcional) Si existe la función del trigger, reemplazarla por una compatible
-- Esta nueva función insertará el UUID en 'auth_id' y dejará que 'id' se autogenere.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (auth_id, email, full_name, role)
  VALUES (
    new.id, 
    new.email, 
    new.raw_user_meta_data->>'full_name',
    'auditor' -- Rol por defecto
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PASO 3: Recrear el trigger con la función corregida
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
