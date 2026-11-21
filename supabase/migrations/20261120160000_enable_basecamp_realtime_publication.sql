-- ============================================================================
-- Migration: 20261120160000_enable_basecamp_realtime_publication.sql
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Description: Idempotently adds all Basecamp (bc_*) tables to the
--              `supabase_realtime` publication so client WebSocket
--              `postgres_changes` listeners receive live INSERT/UPDATE/DELETE
--              events across To-dos, Messages, Campfire, Docs, Schedule,
--              Check-ins, Comments, Pings, Notifications, and Sync status.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  target_tables text[] := ARRAY[
    'bc_projects',
    'bc_todolists',
    'bc_todos',
    'bc_todo_assignees',
    'bc_messages',
    'bc_campfire_lines',
    'bc_documents',
    'bc_uploads',
    'bc_vaults',
    'bc_schedule_entries',
    'bc_questions',
    'bc_answers',
    'bc_comments',
    'bc_pings',
    'bc_notifications',
    'bc_sync_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY target_tables LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = tbl
       )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;
