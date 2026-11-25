-- Server Resilience Shield: Missing Hot-Query Indexes + service_role Safety Timeouts
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- All large indexes were pre-created online via CREATE INDEX CONCURRENTLY with zero downtime.

-- 1. delivery_platform_orders (eliminates 12.1 GB/day disk temp_files & 5.5s Seq Scans)
CREATE INDEX IF NOT EXISTS idx_deliv_orders_bdate_id
  ON public.delivery_platform_orders (business_date DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_deliv_orders_bdate_placed_id
  ON public.delivery_platform_orders (business_date DESC, placed_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_deliv_orders_disputed_id
  ON public.delivery_platform_orders (id ASC)
  WHERE is_disputed = true;

-- 2. delivery_platform_payouts (eliminates 4.5s-5.2s sorting scans)
CREATE INDEX IF NOT EXISTS idx_deliv_payouts_date_id
  ON public.delivery_platform_payouts (payout_date DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_deliv_payouts_period_end
  ON public.delivery_platform_payouts (period_end DESC, payout_date DESC);

-- 3. order_ready_announcements (eliminates 6.1s lookup by store_code + order_number on 326k rows)
CREATE INDEX IF NOT EXISTS idx_order_ready_store_order_num
  ON public.order_ready_announcements (store_code, order_number, created_at DESC);

-- 4. Basecamp hot tables (bc_todos, bc_comments, bc_attachment_cache)
CREATE INDEX IF NOT EXISTS idx_bc_todos_project_completed_upd
  ON public.bc_todos (project_id, is_completed, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_comments_project_created
  ON public.bc_comments (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_comments_content_trgm
  ON public.bc_comments USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_bc_attachment_cache_supabase_url
  ON public.bc_attachment_cache (supabase_url);

-- 5. Safety circuit-breaker timeouts for service_role (replaces dangerous 120s default & infinite idle_in_transaction)
ALTER ROLE service_role SET statement_timeout = '30s';
ALTER ROLE service_role SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE service_role SET lock_timeout = '10s';
