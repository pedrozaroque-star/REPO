-- =============================================================================
-- MIGRATION: 20261022_stop_realtime_storm_order_ready.sql
-- PURPOSE:
--   1. Stop the runaway no-op UPDATE + Supabase Realtime broadcast storm on
--      public.order_ready_announcements (~31.4 updates/sec = 4.54M updates)
--      caused by Toast returning order selections in non-deterministic array
--      order on each poll.
--   2. Add missing composite partial index on (store_code, announced_at DESC)
--      WHERE announced_at IS NOT NULL to eliminate the 55.7-hour table scan
--      on beverageCalls polling.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.canonicalize_order_items_jsonb(p_raw text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_parsed jsonb;
  v_sorted jsonb;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_parsed := p_raw::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN to_jsonb(btrim(p_raw));
  END;

  IF jsonb_typeof(v_parsed) <> 'array' THEN
    RETURN v_parsed;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'qty', COALESCE(elem->'qty', to_jsonb(1)),
        'name', COALESCE(elem->'name', to_jsonb(''::text)),
        'modifiers', COALESCE(
          (
            SELECT jsonb_agg(m ORDER BY m::text)
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(elem->'modifiers') = 'array' THEN elem->'modifiers' ELSE '[]'::jsonb END
            ) AS m
          ),
          '[]'::jsonb
        )
      )
      ORDER BY
        COALESCE(elem->>'name', ''),
        COALESCE(elem->>'qty', '1'),
        COALESCE((elem->'modifiers')::text, '[]')
    ),
    '[]'::jsonb
  )
  INTO v_sorted
  FROM jsonb_array_elements(v_parsed) AS elem;

  RETURN v_sorted;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_suppress_noop_order_ready_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.ready_at IS NOT DISTINCT FROM OLD.ready_at
       AND NEW.announced IS NOT DISTINCT FROM OLD.announced
       AND NEW.announced_at IS NOT DISTINCT FROM OLD.announced_at
       AND NEW.dining_option IS NOT DISTINCT FROM OLD.dining_option
       AND NEW.customer_name IS NOT DISTINCT FROM OLD.customer_name
       AND NEW.order_number IS NOT DISTINCT FROM OLD.order_number
       AND public.canonicalize_order_items_jsonb(NEW.items_summary)
           IS NOT DISTINCT FROM public.canonicalize_order_items_jsonb(OLD.items_summary)
    THEN
      -- Cancel redundant no-op UPDATE: prevents dead tuples, WAL replication, and Realtime broadcast storms
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suppress_noop_order_ready_update ON public.order_ready_announcements;

CREATE TRIGGER trg_suppress_noop_order_ready_update
BEFORE UPDATE ON public.order_ready_announcements
FOR EACH ROW
EXECUTE FUNCTION public.fn_suppress_noop_order_ready_update();

CREATE INDEX IF NOT EXISTS idx_order_ready_store_announced_at
  ON public.order_ready_announcements (store_code, announced_at DESC)
  WHERE announced_at IS NOT NULL;
