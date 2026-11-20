-- Migration: Mobile & Tablet OS User UI Preferences (Editable Dock & Home View Mode)
-- Date: 2026-11-20
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Purpose:
--   Persist per-user Mobile/Tablet OS preferences:
--     1. dock_modules (jsonb array of 1..4 customizable BottomTabBar shortcut IDs)
--     2. home_view_mode ('os' | 'web' so users can toggle between OS Home Screen and classic Web Hub)
--   Accessed strictly server-side via service_role in /api/mobile-os/preferences after verifyStaffAuth(req).

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_ui_preferences (
  user_key text PRIMARY KEY,
  dock_modules jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT chk_user_ui_preferences_dock_array CHECK (jsonb_typeof(dock_modules) = 'array'),
  home_view_mode text NOT NULL DEFAULT 'os'
    CONSTRAINT chk_user_ui_preferences_home_mode CHECK (home_view_mode IN ('os', 'web')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ui_preferences
  ADD COLUMN IF NOT EXISTS home_view_mode text NOT NULL DEFAULT 'os';

COMMENT ON TABLE public.user_ui_preferences IS
  'Preferencias de interfaz móvil/tablet por usuario autenticado (dock_modules editables y home_view_mode os|web) en Tacos Gavilan.';

ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_ui_preferences FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_ui_preferences TO service_role;

DROP POLICY IF EXISTS "Service role full access user_ui_preferences" ON public.user_ui_preferences;
CREATE POLICY "Service role full access user_ui_preferences"
  ON public.user_ui_preferences
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
