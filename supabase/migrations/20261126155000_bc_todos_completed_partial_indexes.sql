-- Basecamp Completed Todos Partial Indexes (eliminates 2.09s avg / 5.05s peak Seq Scans on 14k+ completed rows)
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Pre-created online via CREATE INDEX CONCURRENTLY with zero downtime.

CREATE INDEX IF NOT EXISTS idx_bc_todos_project_completed_at
  ON public.bc_todos (project_id, completed_at DESC NULLS LAST, created_at DESC)
  WHERE is_completed = true;

CREATE INDEX IF NOT EXISTS idx_bc_todos_todolist_completed_at
  ON public.bc_todos (todolist_id, completed_at DESC NULLS LAST, created_at DESC)
  WHERE is_completed = true;
