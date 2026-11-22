-- Migration: Basecamp 100% Standalone Auto-Cutover, Project Membership Uniqueness & 'basecamp' Restricted Role
-- Applied to production teg-tacos-gavilan (ywwwdcvgfculqmcfkihq) on 2026-11-21

-- 1. Update is_teg_staff() to recognize the restricted 'basecamp' role for bc_* RLS read access
CREATE OR REPLACE FUNCTION public.is_teg_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT (
    auth.role() = 'service_role'
    OR public.teg_staff_role() = ANY (ARRAY[
      'admin',
      'supervisor',
      'regional_manager',
      'manager',
      'gerente',
      'asistente',
      'assistant',
      'shift_leader',
      'auditor',
      'planificador',
      'basecamp',
      'raquel',
      'external_accounting',
      'employee'
    ])
  );
$function$;

-- 2. Expand public.users role check constraint to support 'basecamp' and 'planificador'
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (
  (role)::text = ANY (ARRAY[
    'admin',
    'manager',
    'gerente',
    'general_manager',
    'supervisor',
    'regional_manager',
    'user',
    'asistente',
    'assistant',
    'shift_leader',
    'planificador',
    'basecamp',
    'auditor',
    'accounting',
    'contador'
  ]::text[])
);

-- 3. Create singleton runtime mode table for Hybrid <-> Standalone Auto-Cutover
CREATE TABLE IF NOT EXISTS public.bc_system_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  runtime_mode text NOT NULL DEFAULT 'hybrid' CHECK (runtime_mode IN ('hybrid', 'standalone')),
  auto_cutover_enabled boolean NOT NULL DEFAULT true,
  standalone_activated_at timestamptz,
  standalone_reason text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.bc_system_config (id, runtime_mode, auto_cutover_enabled)
VALUES (1, 'hybrid', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.bc_system_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bc_system_config_staff_select" ON public.bc_system_config;
CREATE POLICY "bc_system_config_staff_select" ON public.bc_system_config
  FOR SELECT USING (public.is_teg_staff());

DROP POLICY IF EXISTS "bc_system_config_service_all" ON public.bc_system_config;
CREATE POLICY "bc_system_config_service_all" ON public.bc_system_config
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 4. Deduplicate & enforce uniqueness on bc_memberships (project_id, person_id)
DELETE FROM public.bc_memberships a
USING public.bc_memberships b
WHERE a.ctid < b.ctid
  AND a.project_id = b.project_id
  AND a.person_id = b.person_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_memberships_project_person_uniq
  ON public.bc_memberships (project_id, person_id);

-- 5. Provision active Basecamp-only collaborators (Edisson & Eduardo Rojas) for Google SSO access to /basecamp
INSERT INTO public.users (email, full_name, role, is_active)
VALUES
  ('rc970248@gmail.com', 'Edisson', 'basecamp', true),
  ('eduardo@tacosgavilan.com', 'Eduardo Rojas', 'basecamp', true)
ON CONFLICT (email) DO NOTHING;

-- 6. Trigger to prevent external Basecamp/37signals sync from overwriting archived Supabase Storage avatars on bc_people
CREATE OR REPLACE FUNCTION public.preserve_bc_people_supabase_avatar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.avatar_url IS NOT NULL
     AND OLD.avatar_url LIKE '%/storage/v1/object/public/%'
     AND (
       NEW.avatar_url IS NULL
       OR NEW.avatar_url = ''
       OR (
         NEW.avatar_url NOT LIKE '%/storage/v1/object/public/%'
         AND (
           NEW.avatar_url ILIKE '%basecamp%'
           OR NEW.avatar_url ILIKE '%37signals%'
         )
       )
     )
  THEN
    NEW.avatar_url := OLD.avatar_url;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_preserve_bc_people_supabase_avatar ON public.bc_people;
CREATE TRIGGER trg_preserve_bc_people_supabase_avatar
  BEFORE UPDATE ON public.bc_people
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_bc_people_supabase_avatar();
