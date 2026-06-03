-- ==========================================
-- @module Basecamp Schema V2 Migration
-- @description Esquema completo de base de datos para la integración con Basecamp 3 API.
--              Reemplaza el esquema simplificado V1 (basecamp_*) con tablas normalizadas (bc_*)
--              que reflejan fielmente la estructura de la API de Basecamp:
--              OAuth tokens, People, Projects, Memberships, TodoSets/Lists/Todos,
--              Message Boards/Messages, Comments, Campfires, Vaults/Documents/Uploads,
--              Schedules/Entries, Questionnaires/Questions/Answers, Pings, Notifications, Sync Log.
-- @businessRules
--   - Supabase es la fuente de verdad (source of truth); Basecamp es sincronización secundaria
--   - Cada entidad sincronizada desde Basecamp tiene un campo `bc_id` (BIGINT UNIQUE) para mapeo
--   - RLS habilitado en TODAS las tablas con política de acceso total para usuarios autenticados (fase inicial)
--   - Las tablas V1 (basecamp_*) NO se eliminan para permitir migración gradual de datos
--   - El sistema debe soportar migración futura lejos de Basecamp
-- @dataFlow
--   Basecamp API → sync service → bc_* tables (Supabase)
--   Frontend → Supabase queries → bc_* tables
--   bc_sync_log registra historial de sincronizaciones
-- @notes
--   - V1 tables (basecamp_projects, basecamp_todos, etc.) are preserved but deprecated
--   - bc_id columns are BIGINT because Basecamp IDs can exceed INT range
--   - ON DELETE CASCADE is used for container→child relationships
--   - ON DELETE SET NULL is used for author/person references to preserve data if person is removed
-- @date 2026-06-03
-- ==========================================

-- ============================================================
-- 1. bc_oauth_tokens — Almacena tokens OAuth2 de Basecamp
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_oauth_tokens_user_id ON public.bc_oauth_tokens(user_id);

-- ============================================================
-- 2. bc_people — Miembros del equipo sincronizados desde Basecamp
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    role TEXT,
    title TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_people_bc_id ON public.bc_people(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_people_email ON public.bc_people(email);

-- ============================================================
-- 3. bc_projects — Proyectos de Basecamp
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT 'white',
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    member_count INT NOT NULL DEFAULT 0,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_projects_bc_id ON public.bc_projects(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_projects_created_by ON public.bc_projects(created_by);

-- ============================================================
-- 4. bc_memberships — Membresía de personas en proyectos (N:N)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES public.bc_people(id) ON DELETE CASCADE,
    role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_memberships_project_id ON public.bc_memberships(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_memberships_person_id ON public.bc_memberships(person_id);

-- ============================================================
-- 5. bc_todosets — Contenedor de listas de tareas por proyecto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_todosets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_todosets_bc_id ON public.bc_todosets(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_todosets_project_id ON public.bc_todosets(project_id);

-- ============================================================
-- 6. bc_todolists — Listas de tareas nombradas (e.g. 'Cases', 'Pedidos')
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_todolists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    todoset_id UUID REFERENCES public.bc_todosets(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    position INT,
    completed_count INT NOT NULL DEFAULT 0,
    total_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_todolists_bc_id ON public.bc_todolists(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_todolists_project_id ON public.bc_todolists(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_todolists_todoset_id ON public.bc_todolists(todoset_id);

-- ============================================================
-- 7. bc_todos — Tareas individuales
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    todolist_id UUID NOT NULL REFERENCES public.bc_todolists(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    due_date DATE,
    position INT,
    created_by_person_id UUID REFERENCES public.bc_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_todos_bc_id ON public.bc_todos(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_todos_project_id ON public.bc_todos(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_todos_todolist_id ON public.bc_todos(todolist_id);
CREATE INDEX IF NOT EXISTS idx_bc_todos_created_by ON public.bc_todos(created_by_person_id);
CREATE INDEX IF NOT EXISTS idx_bc_todos_due_date ON public.bc_todos(due_date);
CREATE INDEX IF NOT EXISTS idx_bc_todos_is_completed ON public.bc_todos(is_completed);

-- ============================================================
-- 8. bc_todo_assignees — Asignaciones de tareas (N:N todo ↔ person)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_todo_assignees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    todo_id UUID NOT NULL REFERENCES public.bc_todos(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES public.bc_people(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(todo_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_todo_assignees_todo_id ON public.bc_todo_assignees(todo_id);
CREATE INDEX IF NOT EXISTS idx_bc_todo_assignees_person_id ON public.bc_todo_assignees(person_id);

-- ============================================================
-- 9. bc_message_boards — Contenedor de mensajes por proyecto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_message_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_message_boards_bc_id ON public.bc_message_boards(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_message_boards_project_id ON public.bc_message_boards(project_id);

-- ============================================================
-- 10. bc_messages — Posts del tablón de mensajes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    board_id UUID REFERENCES public.bc_message_boards(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    content TEXT,
    category TEXT,
    author_person_id UUID REFERENCES public.bc_people(id) ON DELETE SET NULL,
    comments_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_messages_bc_id ON public.bc_messages(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_messages_project_id ON public.bc_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_messages_board_id ON public.bc_messages(board_id);
CREATE INDEX IF NOT EXISTS idx_bc_messages_author ON public.bc_messages(author_person_id);

-- ============================================================
-- 11. bc_comments — Comentarios polimórficos (message, todo, document, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    parent_type TEXT NOT NULL, -- 'message', 'todo', 'document', etc.
    parent_id UUID NOT NULL,
    content TEXT NOT NULL,
    author_person_id UUID REFERENCES public.bc_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_comments_bc_id ON public.bc_comments(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_comments_project_id ON public.bc_comments(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_comments_parent ON public.bc_comments(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_bc_comments_author ON public.bc_comments(author_person_id);

-- ============================================================
-- 12. bc_campfires — Contenedor de chat por proyecto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_campfires (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_campfires_bc_id ON public.bc_campfires(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_campfires_project_id ON public.bc_campfires(project_id);

-- ============================================================
-- 13. bc_campfire_lines — Mensajes individuales de chat
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_campfire_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    campfire_id UUID NOT NULL REFERENCES public.bc_campfires(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    author_person_id UUID REFERENCES public.bc_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_campfire_lines_bc_id ON public.bc_campfire_lines(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_campfire_lines_project_id ON public.bc_campfire_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_campfire_lines_campfire_id ON public.bc_campfire_lines(campfire_id);
CREATE INDEX IF NOT EXISTS idx_bc_campfire_lines_author ON public.bc_campfire_lines(author_person_id);

-- ============================================================
-- 14. bc_vaults — Contenedor de documentos y archivos por proyecto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_vaults_bc_id ON public.bc_vaults(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_vaults_project_id ON public.bc_vaults(project_id);

-- ============================================================
-- 15. bc_documents — Documentos creados en el proyecto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    vault_id UUID REFERENCES public.bc_vaults(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    content TEXT,
    author_person_id UUID REFERENCES public.bc_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_documents_bc_id ON public.bc_documents(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_documents_project_id ON public.bc_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_documents_vault_id ON public.bc_documents(vault_id);
CREATE INDEX IF NOT EXISTS idx_bc_documents_author ON public.bc_documents(author_person_id);

-- ============================================================
-- 16. bc_uploads — Archivos subidos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    vault_id UUID REFERENCES public.bc_vaults(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    content_type TEXT,
    byte_size BIGINT,
    download_url TEXT,
    author_person_id UUID REFERENCES public.bc_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_uploads_bc_id ON public.bc_uploads(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_uploads_project_id ON public.bc_uploads(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_uploads_vault_id ON public.bc_uploads(vault_id);
CREATE INDEX IF NOT EXISTS idx_bc_uploads_author ON public.bc_uploads(author_person_id);

-- ============================================================
-- 17. bc_schedules — Contenedor de calendario por proyecto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_schedules_bc_id ON public.bc_schedules(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_schedules_project_id ON public.bc_schedules(project_id);

-- ============================================================
-- 18. bc_schedule_entries — Eventos del calendario
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_schedule_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES public.bc_schedules(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    all_day BOOLEAN NOT NULL DEFAULT false,
    author_person_id UUID REFERENCES public.bc_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_schedule_entries_bc_id ON public.bc_schedule_entries(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_schedule_entries_project_id ON public.bc_schedule_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_schedule_entries_schedule_id ON public.bc_schedule_entries(schedule_id);
CREATE INDEX IF NOT EXISTS idx_bc_schedule_entries_starts_at ON public.bc_schedule_entries(starts_at);

-- ============================================================
-- 19. bc_questionnaires — Contenedor de check-ins por proyecto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_questionnaires (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_questionnaires_bc_id ON public.bc_questionnaires(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_questionnaires_project_id ON public.bc_questionnaires(project_id);

-- ============================================================
-- 20. bc_questions — Preguntas de check-in
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    questionnaire_id UUID NOT NULL REFERENCES public.bc_questionnaires(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    schedule_text TEXT,
    is_paused BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_questions_bc_id ON public.bc_questions(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_questions_project_id ON public.bc_questions(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_questions_questionnaire_id ON public.bc_questions(questionnaire_id);

-- ============================================================
-- 21. bc_answers — Respuestas a preguntas de check-in
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.bc_questions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    author_person_id UUID REFERENCES public.bc_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_answers_bc_id ON public.bc_answers(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_answers_project_id ON public.bc_answers(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_answers_question_id ON public.bc_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_bc_answers_author ON public.bc_answers(author_person_id);

-- ============================================================
-- 22. bc_pings — Mensajes directos (1-on-1)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_pings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE,
    sender_person_id UUID NOT NULL REFERENCES public.bc_people(id) ON DELETE CASCADE,
    recipient_person_id UUID NOT NULL REFERENCES public.bc_people(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_pings_bc_id ON public.bc_pings(bc_id);
CREATE INDEX IF NOT EXISTS idx_bc_pings_sender ON public.bc_pings(sender_person_id);
CREATE INDEX IF NOT EXISTS idx_bc_pings_recipient ON public.bc_pings(recipient_person_id);

-- ============================================================
-- 23. bc_notifications — Notificaciones internas (Hey!)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.bc_projects(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES public.bc_people(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    recording_type TEXT,
    recording_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_notifications_project_id ON public.bc_notifications(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_notifications_person_id ON public.bc_notifications(person_id);
CREATE INDEX IF NOT EXISTS idx_bc_notifications_is_read ON public.bc_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_bc_notifications_type ON public.bc_notifications(type);

-- ============================================================
-- 24. bc_sync_log — Historial de sincronización
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bc_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type TEXT NOT NULL,
    status TEXT NOT NULL,
    records_synced INT NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bc_sync_log_sync_type ON public.bc_sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_bc_sync_log_status ON public.bc_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_bc_sync_log_started_at ON public.bc_sync_log(started_at);

-- ============================================================
-- HABILITAR RLS EN TODAS LAS TABLAS / Enable RLS on all tables
-- ============================================================
ALTER TABLE public.bc_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_todosets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_todolists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_todo_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_message_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_campfires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_campfire_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_schedule_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_questionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_sync_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLÍTICAS RLS — Acceso total para usuarios autenticados (fase inicial)
-- RLS Policies — Full access for authenticated users (initial phase)
-- ============================================================

-- bc_oauth_tokens: Solo el propietario puede ver/editar sus propios tokens
-- Only token owner can access their own tokens
CREATE POLICY "bc_oauth_tokens_owner_access" ON public.bc_oauth_tokens
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Todas las demás tablas: acceso total para usuarios autenticados
-- All other tables: full access for authenticated users
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'bc_people',
        'bc_projects',
        'bc_memberships',
        'bc_todosets',
        'bc_todolists',
        'bc_todos',
        'bc_todo_assignees',
        'bc_message_boards',
        'bc_messages',
        'bc_comments',
        'bc_campfires',
        'bc_campfire_lines',
        'bc_vaults',
        'bc_documents',
        'bc_uploads',
        'bc_schedules',
        'bc_schedule_entries',
        'bc_questionnaires',
        'bc_questions',
        'bc_answers',
        'bc_pings',
        'bc_notifications',
        'bc_sync_log'
    ])
    LOOP
        EXECUTE format(
            'CREATE POLICY "bc_%s_authenticated_full_access" ON public.%I
             FOR ALL
             TO authenticated
             USING (true)
             WITH CHECK (true);',
            t, t
        );
    END LOOP;
END $$;

-- ============================================================
-- TRIGGER: updated_at automático para tablas que lo tienen
-- Auto-update updated_at timestamp on row modification
-- ============================================================
CREATE OR REPLACE FUNCTION public.bc_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a todas las tablas con columna updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'bc_oauth_tokens',
        'bc_people',
        'bc_projects',
        'bc_todolists',
        'bc_todos',
        'bc_messages',
        'bc_documents',
        'bc_schedule_entries'
    ])
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at
             BEFORE UPDATE ON public.%I
             FOR EACH ROW
             EXECUTE FUNCTION public.bc_set_updated_at();',
            t, t
        );
    END LOOP;
END $$;

-- ============================================================
-- FIN DE LA MIGRACIÓN V2 / END OF V2 MIGRATION
-- ============================================================
