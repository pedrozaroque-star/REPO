-- Migración para soportar Google Reviews en customer_feedback
-- Fecha: 2026-01-21
-- Descripción: Agrega columnas para fuente externa, ID externo, rating y URLs.

-- 1. Modificar tabla customer_feedback
ALTER TABLE customer_feedback
ADD COLUMN IF NOT EXISTS source text DEFAULT 'internal', -- 'internal', 'google', 'yelp'
ADD COLUMN IF NOT EXISTS external_id text UNIQUE, -- ID único de Google para evitar duplicados
ADD COLUMN IF NOT EXISTS rating numeric(2,1), -- Estrellas de Google (ej: 4.5)
ADD COLUMN IF NOT EXISTS author_url text, -- Link al perfil del usuario
ADD COLUMN IF NOT EXISTS original_url text; -- Link directo a la reseña

-- Crear índice para búsquedas rápidas por fuente
CREATE INDEX IF NOT EXISTS idx_customer_feedback_source ON customer_feedback(source);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_external_id ON customer_feedback(external_id);

-- 2. Modificar tabla stores para guardar el ID de Google Maps
ALTER TABLE stores
ADD COLUMN IF NOT EXISTS google_place_id text;

-- 3. Comentario explicativo
COMMENT ON COLUMN customer_feedback.source IS 'Fuente del feedback: internal (QR), google, etc.';
COMMENT ON COLUMN customer_feedback.rating IS 'Rating externo (estrellas 1-5) si aplica';
