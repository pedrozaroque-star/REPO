-- ==========================================
-- @module Basecamp Schema Migration
-- @description Estructura de base de datos relacional para emulación de Basecamp.
--              Soporta Proyectos, To-dos, Messages, Comments, Campfire Chats, Events y Checkins.
-- @businessRules Acceso total a usuarios autenticados para colaboración.
-- @date 2026-06-02
-- ==========================================

-- 1. PROYECTOS / PROJECTS
CREATE TABLE IF NOT EXISTS public.basecamp_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'white',
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2. TAREAS / TODOS
CREATE TABLE IF NOT EXISTS public.basecamp_todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    list_name TEXT NOT NULL,
    task_name TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    assignee TEXT,
    due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. ANUNCIOS / MESSAGES
CREATE TABLE IF NOT EXISTS public.basecamp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. COMENTARIOS / COMMENTS
CREATE TABLE IF NOT EXISTS public.basecamp_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_type TEXT NOT NULL, -- 'message' o 'todo'
    parent_id UUID NOT NULL,
    content TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. CHAT / CAMPFIRE
CREATE TABLE IF NOT EXISTS public.basecamp_campfire (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. EVENTOS / EVENTS
CREATE TABLE IF NOT EXISTS public.basecamp_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    event_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. CHECKINS
CREATE TABLE IF NOT EXISTS public.basecamp_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Habilitar RLS en todas las tablas / Enable RLS on all tables
ALTER TABLE public.basecamp_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_campfire ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_checkins ENABLE ROW LEVEL SECURITY;

-- Crear políticas de acceso libre para usuarios autenticados / Create policies for authenticated users
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN ARRAY ARRAY['basecamp_projects', 'basecamp_todos', 'basecamp_messages', 'basecamp_comments', 'basecamp_campfire', 'basecamp_events', 'basecamp_checkins']
    LOOP
        EXECUTE format('
            CREATE POLICY "Allow authenticated users full access" ON public.%I
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);
        ', t);
    END LOOP;
END $$;
