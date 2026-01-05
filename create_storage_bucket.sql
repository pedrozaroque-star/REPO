-- Script para crear el Bucket de Fotos
-- Este script crea el bucket 'checklist-photos' si no existe y configura sus políticas de seguridad.

-- 1. Crear el bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('checklist-photos', 'checklist-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Eliminar políticas antiguas para evitar conflictos
DROP POLICY IF EXISTS "Fotos son públicas" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios autenticados pueden subir fotos" ON storage.objects;
DROP POLICY IF EXISTS "Public Access Checklist Photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload Checklist Photos" ON storage.objects;

-- 3. Crear Políticas de Seguridad (RLS)

-- Política de LECTURA: Todo el mundo puede ver las fotos (necesario para mostrarlas en la app)
CREATE POLICY "Public Access Checklist Photos"
ON storage.objects FOR SELECT
USING ( bucket_id = 'checklist-photos' );

-- Política de ESCRITURA: Solo usuarios autenticados pueden subir fotos
CREATE POLICY "Authenticated Upload Checklist Photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'checklist-photos' 
  AND auth.role() = 'authenticated'
);

-- Política de ELIMINACIÓN: Usuarios pueden borrar (opcional, refinable)
CREATE POLICY "Authenticated Delete Checklist Photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'checklist-photos' 
  AND auth.role() = 'authenticated'
);

-- 4. Verificar configuración
SELECT * FROM storage.buckets WHERE id = 'checklist-photos';
