-- ==========================================
-- @module Basecamp OAuth & Sync Tables
-- @description Tablas para almacenar tokens OAuth de Basecamp y logs de sincronización.
--              Complementa el schema principal de basecamp (20260602_basecamp_schema.sql).
-- @businessRules Los tokens se auto-refrescan en el backend. Solo se mantiene 1 token activo.
-- @date 2026-06-02
-- ==========================================

-- 1. OAuth Tokens (Singleton - solo 1 fila activa para la integración)
CREATE TABLE IF NOT EXISTS public.bc_oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    account_id TEXT NOT NULL DEFAULT '5052386',
    identity JSONB,  -- Stores the user identity from Basecamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Sync Log (Registro de cada sincronización ejecutada)
CREATE TABLE IF NOT EXISTS public.bc_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type TEXT NOT NULL,         -- 'full', 'incremental', 'manual'
    status TEXT NOT NULL DEFAULT 'running',  -- 'running', 'completed', 'failed'
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    records_synced INTEGER DEFAULT 0,
    details JSONB,                   -- Detalles granulares por entidad
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add bc_id column to existing basecamp tables for API sync mapping
-- bc_id stores the numeric Basecamp 3 API record ID

ALTER TABLE public.basecamp_projects ADD COLUMN IF NOT EXISTS bc_id BIGINT UNIQUE;
ALTER TABLE public.basecamp_projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.basecamp_projects ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.basecamp_projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.basecamp_projects ADD COLUMN IF NOT EXISTS bc_data JSONB;

ALTER TABLE public.basecamp_todos ADD COLUMN IF NOT EXISTS bc_id BIGINT UNIQUE;
ALTER TABLE public.basecamp_todos ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.basecamp_todos ADD COLUMN IF NOT EXISTS position INTEGER;
ALTER TABLE public.basecamp_todos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.basecamp_messages ADD COLUMN IF NOT EXISTS bc_id BIGINT UNIQUE;
ALTER TABLE public.basecamp_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.basecamp_campfire ADD COLUMN IF NOT EXISTS bc_id BIGINT UNIQUE;
ALTER TABLE public.basecamp_campfire ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.basecamp_comments ADD COLUMN IF NOT EXISTS bc_id BIGINT UNIQUE;
ALTER TABLE public.basecamp_comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.basecamp_events ADD COLUMN IF NOT EXISTS bc_id BIGINT UNIQUE;
ALTER TABLE public.basecamp_events ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE public.basecamp_events ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
ALTER TABLE public.basecamp_events ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT true;
ALTER TABLE public.basecamp_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.basecamp_checkins ADD COLUMN IF NOT EXISTS bc_id BIGINT UNIQUE;
ALTER TABLE public.basecamp_checkins ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- People table for Basecamp contacts
CREATE TABLE IF NOT EXISTS public.basecamp_people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    admin BOOLEAN DEFAULT false,
    company JSONB,
    bc_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Todo Lists (container for todos)
CREATE TABLE IF NOT EXISTS public.basecamp_todolists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    bc_project_id BIGINT,
    name TEXT NOT NULL,
    description TEXT,
    completed BOOLEAN DEFAULT false,
    completed_count INTEGER DEFAULT 0,
    uncompleted_count INTEGER DEFAULT 0,
    position INTEGER,
    bc_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Documents (Docs & Files vault items)
CREATE TABLE IF NOT EXISTS public.basecamp_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    bc_project_id BIGINT,
    title TEXT NOT NULL,
    content TEXT,
    bc_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uploads (Files in vault)
CREATE TABLE IF NOT EXISTS public.basecamp_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    project_id UUID REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    bc_project_id BIGINT,
    filename TEXT NOT NULL,
    content_type TEXT,
    byte_size BIGINT,
    download_url TEXT,
    bc_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Answers (Checkin answers)
CREATE TABLE IF NOT EXISTS public.basecamp_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bc_id BIGINT UNIQUE NOT NULL,
    question_bc_id BIGINT,
    project_id UUID REFERENCES public.basecamp_projects(id) ON DELETE CASCADE,
    bc_project_id BIGINT,
    content TEXT NOT NULL,
    author_name TEXT,
    author_email TEXT,
    bc_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.bc_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_todolists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basecamp_answers ENABLE ROW LEVEL SECURITY;

-- Policies for new tables (authenticated access)
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY['bc_oauth_tokens', 'bc_sync_log', 'basecamp_people', 'basecamp_todolists', 'basecamp_documents', 'basecamp_uploads', 'basecamp_answers'])
    LOOP
        EXECUTE format('
            CREATE POLICY IF NOT EXISTS "Allow authenticated users full access" ON public.%I
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);
        ', t);
    END LOOP;
END $$;

-- Indexes for sync performance
CREATE INDEX IF NOT EXISTS idx_bc_sync_log_status ON public.bc_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_bc_sync_log_started ON public.bc_sync_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_basecamp_people_bc_id ON public.basecamp_people(bc_id);
CREATE INDEX IF NOT EXISTS idx_basecamp_todolists_bc_id ON public.basecamp_todolists(bc_id);
CREATE INDEX IF NOT EXISTS idx_basecamp_documents_bc_id ON public.basecamp_documents(bc_id);
CREATE INDEX IF NOT EXISTS idx_basecamp_uploads_bc_id ON public.basecamp_uploads(bc_id);
CREATE INDEX IF NOT EXISTS idx_basecamp_answers_bc_id ON public.basecamp_answers(bc_id);
