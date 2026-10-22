-- =============================================================================
-- Migration: 20261022_order_ready_sync_distributed_lock.sql
-- Purpose: Atomic PostgreSQL distributed lease lock per store_code to prevent
--          concurrent / duplicate Toast POS order synchronizations across
--          multiple serverless instances (Phase 9).
--
-- Features:
-- 1. Single atomic UPSERT with conditional WHERE (expires_at <= clock_timestamp())
--    guarantees at most one active sync per store_code within the lease window.
-- 2. Independent rows per store_code allow multiple stores to synchronize
--    simultaneously without blocking each other.
-- 3. Automatic TTL expiration ensures a crashed serverless instance never
--    permanently blocks future synchronizations for that store.
-- 4. Table is NOT part of supabase_realtime publication (zero Realtime noise).
-- =============================================================================

-- =============================================================================
-- FORWARD SQL
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.order_ready_sync_leases (
  store_code text PRIMARY KEY,
  holder_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.order_ready_sync_leases ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_acquire_order_ready_sync_lease(
  p_store_code text,
  p_holder_id text,
  p_lease_ms integer DEFAULT 4500,
  p_force boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_store text;
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz;
  v_acquired_holder text;
BEGIN
  IF p_store_code IS NULL OR btrim(p_store_code) = '' THEN
    RETURN false;
  END IF;

  v_normalized_store := upper(btrim(p_store_code));
  v_expires := v_now + (GREATEST(COALESCE(p_lease_ms, 4500), 200) || ' milliseconds')::interval;

  INSERT INTO public.order_ready_sync_leases (
    store_code,
    holder_id,
    acquired_at,
    expires_at,
    updated_at
  )
  VALUES (
    v_normalized_store,
    COALESCE(NULLIF(btrim(p_holder_id), ''), 'default-holder'),
    v_now,
    v_expires,
    v_now
  )
  ON CONFLICT (store_code) DO UPDATE
  SET
    holder_id = EXCLUDED.holder_id,
    acquired_at = EXCLUDED.acquired_at,
    expires_at = EXCLUDED.expires_at,
    updated_at = EXCLUDED.updated_at
  WHERE
    public.order_ready_sync_leases.expires_at <= v_now
    OR p_force = true
  RETURNING holder_id INTO v_acquired_holder;

  RETURN v_acquired_holder IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_order_ready_sync_lease(
  p_store_code text,
  p_holder_id text,
  p_cooldown_ms integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_store text;
  v_now timestamptz := clock_timestamp();
  v_new_expires timestamptz;
  v_updated_store text;
BEGIN
  IF p_store_code IS NULL OR btrim(p_store_code) = '' THEN
    RETURN false;
  END IF;

  v_normalized_store := upper(btrim(p_store_code));

  IF COALESCE(p_cooldown_ms, 0) <= 0 THEN
    v_new_expires := v_now;
  ELSE
    v_new_expires := v_now + (p_cooldown_ms || ' milliseconds')::interval;
  END IF;

  UPDATE public.order_ready_sync_leases
  SET
    expires_at = v_new_expires,
    updated_at = v_now
  WHERE
    store_code = v_normalized_store
    AND holder_id = COALESCE(NULLIF(btrim(p_holder_id), ''), 'default-holder')
  RETURNING store_code INTO v_updated_store;

  RETURN v_updated_store IS NOT NULL;
END;
$$;

-- =============================================================================
-- ROLLBACK SQL (DOCUMENTED — DO NOT EXECUTE AUTOMATICALLY)
-- =============================================================================
-- DROP FUNCTION IF EXISTS public.release_order_ready_sync_lease(text, text, integer);
-- DROP FUNCTION IF EXISTS public.try_acquire_order_ready_sync_lease(text, text, integer, boolean);
-- DROP TABLE IF EXISTS public.order_ready_sync_leases;
