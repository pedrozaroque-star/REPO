-- Migration: Basecamp 1:1 Parity (Todolist Groups, Mention SGIDs, Date Ranges, Boosts, Comment Edits & Enabled Tools)
-- Applied to production project teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)

ALTER TABLE public.bc_people
  ADD COLUMN IF NOT EXISTS attachable_sgid text;

ALTER TABLE public.bc_projects
  ADD COLUMN IF NOT EXISTS enabled_tools text[];

ALTER TABLE public.bc_todolists
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS bc_completed_ratio text;

CREATE TABLE IF NOT EXISTS public.bc_todolist_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bc_id bigint UNIQUE NOT NULL,
  project_id uuid NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
  todolist_id uuid NOT NULL REFERENCES public.bc_todolists(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  position integer DEFAULT 1,
  completed_count integer DEFAULT 0,
  total_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_todolist_groups_todolist
  ON public.bc_todolist_groups(todolist_id, position);

ALTER TABLE public.bc_todolist_groups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bc_todolist_groups'
      AND policyname = 'bc_bc_todolist_groups_authenticated_full_access'
  ) THEN
    CREATE POLICY bc_bc_todolist_groups_authenticated_full_access
      ON public.bc_todolist_groups
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.bc_todos
  ADD COLUMN IF NOT EXISTS starts_on date,
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.bc_todolist_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completion_subscriber_ids uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS subscriber_ids uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS boosts_count integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bc_todos_group_id
  ON public.bc_todos(group_id);

ALTER TABLE public.bc_comments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS boosts_count integer DEFAULT 0;

ALTER TABLE public.bc_messages
  ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS boosts_count integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bc_messages_project_pinned
  ON public.bc_messages(project_id, is_pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bc_boosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bc_id bigint UNIQUE NOT NULL,
  project_id uuid NOT NULL REFERENCES public.bc_projects(id) ON DELETE CASCADE,
  recording_type text NOT NULL,
  recording_id uuid NOT NULL,
  booster_person_id uuid REFERENCES public.bc_people(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bc_boosts_recording
  ON public.bc_boosts(recording_type, recording_id);

ALTER TABLE public.bc_boosts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bc_boosts'
      AND policyname = 'bc_bc_boosts_authenticated_full_access'
  ) THEN
    CREATE POLICY bc_bc_boosts_authenticated_full_access
      ON public.bc_boosts
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'bc_todolist_groups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bc_todolist_groups;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'bc_boosts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bc_boosts;
  END IF;
END $$;
