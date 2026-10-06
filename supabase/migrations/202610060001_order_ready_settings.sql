-- Migración para configuración global del Order Ready Board
-- Permite que solo usuarios administradores elijan la voz de la cadena y se propague a todas las sucursales.

CREATE TABLE IF NOT EXISTS public.order_ready_settings (
    id TEXT PRIMARY KEY DEFAULT 'global',
    voice TEXT NOT NULL DEFAULT 'Kore',
    voice_language TEXT NOT NULL DEFAULT 'bilingual',
    voice_volume NUMERIC NOT NULL DEFAULT 1.0,
    voice_speed NUMERIC NOT NULL DEFAULT 0.92,
    enable_chime BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_by TEXT NULL
);

-- Asegurar registro inicial global si no existe
INSERT INTO public.order_ready_settings (id, voice, voice_language, voice_volume, voice_speed, enable_chime)
VALUES ('global', 'Kore', 'bilingual', 1.0, 0.92, true)
ON CONFLICT (id) DO NOTHING;

-- Habilitar RLS
ALTER TABLE public.order_ready_settings ENABLE ROW LEVEL SECURITY;

-- Política de lectura para usuarios autenticados y anon (tableros públicos o de pantalla)
DROP POLICY IF EXISTS "Permitir lectura de order_ready_settings" ON public.order_ready_settings;
CREATE POLICY "Permitir lectura de order_ready_settings"
    ON public.order_ready_settings
    FOR SELECT
    USING (true);

-- Agregar a publicación realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'order_ready_settings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.order_ready_settings;
    END IF;
END $$;
