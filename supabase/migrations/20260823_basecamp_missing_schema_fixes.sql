-- Migration: 20260823_basecamp_missing_schema_fixes.sql
-- Description: Ensure bc_vaults columns and bc_attachment_cache table exist for full Basecamp 3/4 integration

-- 1. Ensure bc_vaults has name, parent_vault_id, and updated_at
ALTER TABLE IF EXISTS public.bc_vaults ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Docs & Files';
ALTER TABLE IF EXISTS public.bc_vaults ADD COLUMN IF NOT EXISTS parent_vault_id UUID REFERENCES public.bc_vaults(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS public.bc_vaults ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_bc_vaults_project ON public.bc_vaults(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_vaults_parent ON public.bc_vaults(parent_vault_id);

-- 2. Create bc_attachment_cache table for storing mapped Supabase Storage URLs
CREATE TABLE IF NOT EXISTS public.bc_attachment_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    basecamp_url TEXT UNIQUE NOT NULL,
    supabase_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_attachment_cache_url ON public.bc_attachment_cache(basecamp_url);

-- Enable RLS
ALTER TABLE public.bc_attachment_cache ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'bc_attachment_cache' AND policyname = 'bc_attachment_cache_authenticated'
    ) THEN
        CREATE POLICY "bc_attachment_cache_authenticated" 
        ON public.bc_attachment_cache FOR ALL TO authenticated USING (true);
    END IF;
END $$;
