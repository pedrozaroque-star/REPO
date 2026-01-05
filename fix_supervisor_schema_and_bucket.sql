-- SOLUCIÓN FINAL Y DEFINITIVA
-- Ejecuta TODO este script en el SQL Editor de Supabase

BEGIN;

-- 1. ARREGLAR BUCKET (Fotos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('checklist-photos', 'checklist-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de seguridad para el bucket
DROP POLICY IF EXISTS "Public Access Checklist Photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload Checklist Photos" ON storage.objects;
DROP POLICY IF EXISTS "Fotos son públicas" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios autenticados pueden subir fotos" ON storage.objects;

CREATE POLICY "Public Access Checklist Photos" ON storage.objects FOR SELECT
USING ( bucket_id = 'checklist-photos' );

CREATE POLICY "Authenticated Upload Checklist Photos" ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'checklist-photos' AND auth.role() = 'authenticated' );

-- 2. ARREGLAR COLUMNAS FALTANTES
-- Agregamos todas las columnas de puntaje necesarias
ALTER TABLE supervisor_inspections ADD COLUMN IF NOT EXISTS service_score INTEGER DEFAULT 0;
ALTER TABLE supervisor_inspections ADD COLUMN IF NOT EXISTS meat_score INTEGER DEFAULT 0;
ALTER TABLE supervisor_inspections ADD COLUMN IF NOT EXISTS food_score INTEGER DEFAULT 0;
ALTER TABLE supervisor_inspections ADD COLUMN IF NOT EXISTS tortilla_score INTEGER DEFAULT 0;
ALTER TABLE supervisor_inspections ADD COLUMN IF NOT EXISTS cleaning_score INTEGER DEFAULT 0;
ALTER TABLE supervisor_inspections ADD COLUMN IF NOT EXISTS log_score INTEGER DEFAULT 0;
ALTER TABLE supervisor_inspections ADD COLUMN IF NOT EXISTS grooming_score INTEGER DEFAULT 0;

-- 3. FORZAR ACTUALIZACIÓN DE CACHÉ (CRÍTICO)
-- Esto le dice a Supabase que lea las nuevas columnas INMEDIATAMENTE
NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT 'Base de datos actualizada y caché recargada exitosamente' as status;
