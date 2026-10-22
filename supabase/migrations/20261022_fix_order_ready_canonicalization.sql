-- =============================================================================
-- Migration: 20261022_fix_order_ready_canonicalization.sql
-- Purpose: Corrective migration for Order Ready announcements canonicalization
--          and no-op UPDATE suppression trigger.
--
-- Fixes over 20261022_stop_realtime_storm_order_ready.sql:
-- 1. Uses "quantity" as the official item quantity key (matching Toast POS and
--    lib/order-ready-sync.ts), while accepting legacy "qty" as fallback and
--    always emitting "quantity" in the canonical JSONB output.
-- 2. Preserves real numeric quantities (including quantity = 0 without silently
--    converting 0 to 1, and distinguishing quantity: 1 from quantity: 2).
-- 3. Deterministic sorting of modifiers and items while preserving duplicate
--    item entries and preserving exact visual item/modifier names.
-- 4. Safe handling of NULL, empty string, missing modifiers, non-array JSON,
--    and distinct invalid JSON strings (never equating two different invalid
--    JSON payloads).
-- 5. Full-row comparison in fn_suppress_noop_order_ready_update() using
--    (to_jsonb(NEW) - 'items_summary') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'items_summary')
--    instead of a manual partial column list, ensuring updates to store_code,
--    store_name, store_id, order_guid, business_date, status, ready_at,
--    announced, announced_at, etc. are never suppressed.
-- =============================================================================

-- =============================================================================
-- FORWARD SQL
-- =============================================================================

CREATE OR REPLACE FUNCTION public.canonicalize_order_items_jsonb(p_raw text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parsed jsonb;
BEGIN
  -- 1. Handle SQL NULL distinctly from non-null content
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Handle empty/whitespace-only string as empty canonical array
  IF btrim(p_raw) = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  -- 3. Parse JSON safely; preserve distinct invalid JSON strings
  BEGIN
    parsed := p_raw::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('__invalid_json__', p_raw);
  END;

  -- 4. If valid JSON is not an array, preserve its distinct value
  IF jsonb_typeof(parsed) <> 'array' THEN
    RETURN jsonb_build_object('__non_array_json__', parsed);
  END IF;

  -- 5. Canonicalize array elements:
  --    - Official key "quantity" (fallback to "qty", default 1 only when absent/null)
  --    - Preserves quantity = 0
  --    - Preserves exact visual "name"
  --    - Sorts "modifiers" deterministically
  --    - Sorts items deterministically while preserving duplicate rows
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        canon_item
        ORDER BY
          COALESCE(canon_item->>'name', ''),
          COALESCE((canon_item->'modifiers')::text, '[]'),
          COALESCE((canon_item->'quantity')::text, '1'),
          item_ord
      )
      FROM (
        SELECT
          item_ord,
          CASE
            WHEN jsonb_typeof(elem) = 'object' THEN
              jsonb_build_object(
                'name', COALESCE(elem->>'name', ''),
                'quantity',
                  CASE
                    WHEN elem ? 'quantity' AND jsonb_typeof(elem->'quantity') = 'number' THEN
                      elem->'quantity'
                    WHEN elem ? 'quantity' AND jsonb_typeof(elem->'quantity') = 'string'
                         AND btrim(elem->>'quantity') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
                      to_jsonb((btrim(elem->>'quantity'))::numeric)
                    WHEN elem ? 'qty' AND jsonb_typeof(elem->'qty') = 'number' THEN
                      elem->'qty'
                    WHEN elem ? 'qty' AND jsonb_typeof(elem->'qty') = 'string'
                         AND btrim(elem->>'qty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
                      to_jsonb((btrim(elem->>'qty'))::numeric)
                    ELSE
                      to_jsonb(1)
                  END,
                'modifiers',
                  CASE
                    WHEN elem ? 'modifiers' AND jsonb_typeof(elem->'modifiers') = 'array' THEN
                      COALESCE(
                        (
                          SELECT jsonb_agg(mod_val ORDER BY mod_val::text, mod_ord)
                          FROM jsonb_array_elements(elem->'modifiers') WITH ORDINALITY AS m(mod_val, mod_ord)
                        ),
                        '[]'::jsonb
                      )
                    ELSE
                      '[]'::jsonb
                  END
              )
            ELSE
              jsonb_build_object('__raw_elem__', elem)
          END AS canon_item
        FROM jsonb_array_elements(parsed) WITH ORDINALITY AS item_el(elem, item_ord)
      ) sub
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_suppress_noop_order_ready_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Compare all columns except items_summary via JSONB subtraction,
  -- and compare items_summary via canonicalize_order_items_jsonb.
  IF ((to_jsonb(NEW) - 'items_summary') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'items_summary'))
     AND (public.canonicalize_order_items_jsonb(NEW.items_summary) IS NOT DISTINCT FROM public.canonicalize_order_items_jsonb(OLD.items_summary))
  THEN
    RETURN NULL;
  END IF;

  -- When the update is persisted and NEW.items_summary is a valid JSON array,
  -- store the canonicalized representation.
  IF NEW.items_summary IS NOT NULL AND btrim(NEW.items_summary) <> '' THEN
    BEGIN
      IF jsonb_typeof(NEW.items_summary::jsonb) = 'array' THEN
        NEW.items_summary := public.canonicalize_order_items_jsonb(NEW.items_summary)::text;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'order_ready_announcements'
      AND t.tgname = 'trg_suppress_noop_order_ready_update'
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER trg_suppress_noop_order_ready_update
    BEFORE UPDATE ON public.order_ready_announcements
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_suppress_noop_order_ready_update();
  END IF;
END;
$$;

-- =============================================================================
-- ROLLBACK SQL (DOCUMENTED — DO NOT EXECUTE AUTOMATICALLY)
-- =============================================================================
-- Option A: Rollback to the prior 20261022_stop_realtime_storm_order_ready.sql
--           definitions (keeps no-op trigger active with previous definition):
--
-- CREATE OR REPLACE FUNCTION public.canonicalize_order_items_jsonb(p_raw text)
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- IMMUTABLE
-- AS $$
-- DECLARE
--   parsed jsonb;
-- BEGIN
--   IF p_raw IS NULL OR btrim(p_raw) = '' THEN
--     RETURN '[]'::jsonb;
--   END IF;
--   parsed := p_raw::jsonb;
--   IF jsonb_typeof(parsed) <> 'array' THEN
--     RETURN '[]'::jsonb;
--   END IF;
--   RETURN COALESCE(
--     (
--       SELECT jsonb_agg(
--         jsonb_build_object(
--           'name', COALESCE(elem->>'name', ''),
--           'qty', COALESCE(elem->'qty', to_jsonb(1)),
--           'modifiers', COALESCE(
--             (
--               SELECT jsonb_agg(mod_elem ORDER BY mod_elem::text)
--               FROM jsonb_array_elements(
--                 CASE
--                   WHEN jsonb_typeof(elem->'modifiers') = 'array' THEN elem->'modifiers'
--                   ELSE '[]'::jsonb
--                 END
--               ) AS mod_elem
--             ),
--             '[]'::jsonb
--           )
--         )
--         ORDER BY COALESCE(elem->>'name', ''), COALESCE((elem->'modifiers')::text, '[]')
--       )
--       FROM jsonb_array_elements(parsed) AS elem
--     ),
--     '[]'::jsonb
--   );
-- EXCEPTION WHEN OTHERS THEN
--   RETURN to_jsonb(p_raw);
-- END;
-- $$;
--
-- Option B: Full removal of trigger and helper functions (ONLY after application
--           fixes in lib/order-ready-sync.ts and order-ready routes are deployed):
--
-- DROP TRIGGER IF EXISTS trg_suppress_noop_order_ready_update ON public.order_ready_announcements;
-- DROP FUNCTION IF EXISTS public.fn_suppress_noop_order_ready_update();
-- DROP FUNCTION IF EXISTS public.canonicalize_order_items_jsonb(text);
