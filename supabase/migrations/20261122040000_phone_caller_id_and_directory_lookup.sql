-- Caller ID (CNAM + Tacos Gavilan Directory + 30-day Cache) for Multi-Store Phone Agent

ALTER TABLE public.phone_calls
  ADD COLUMN IF NOT EXISTS caller_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS caller_name_source TEXT NULL;

CREATE TABLE IF NOT EXISTS public.phone_caller_id_cache (
  phone_digits TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  raw_cnam TEXT NULL,
  display_name TEXT NULL,
  caller_type TEXT NULL,
  source TEXT NOT NULL DEFAULT 'twilio_cnam',
  looked_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

ALTER TABLE public.phone_caller_id_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phone_caller_id_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.phone_caller_id_cache TO service_role;

CREATE INDEX IF NOT EXISTS idx_phone_caller_id_cache_expires
  ON public.phone_caller_id_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_toast_employees_phone_digits10
  ON public.toast_employees ((right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10)))
  WHERE phone IS NOT NULL AND length(regexp_replace(phone, '\D', '', 'g')) >= 10;

CREATE INDEX IF NOT EXISTS idx_phone_callbacks_phone_digits10_recent
  ON public.phone_callback_requests ((right(regexp_replace(COALESCE(caller_phone, ''), '\D', '', 'g'), 10)), created_at DESC)
  WHERE source = 'twilio' AND caller_phone IS NOT NULL AND length(regexp_replace(caller_phone, '\D', '', 'g')) >= 10;

CREATE OR REPLACE FUNCTION public.resolve_phone_caller_directory(p_digits10 text)
RETURNS TABLE (
  display_name text,
  source text,
  caller_type text,
  role_hint text,
  matched_store_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw text := regexp_replace(COALESCE(p_digits10, ''), '\D', '', 'g');
  v_digits text := CASE
    WHEN length(v_raw) = 11 AND left(v_raw, 1) = '1' THEN right(v_raw, 10)
    ELSE v_raw
  END;
  v_name text;
  v_role text;
  v_type text;
  v_src text;
  v_store_id bigint;
BEGIN
  IF length(v_digits) <> 10 THEN
    RETURN;
  END IF;

  -- 1. Usuarios administrativos / gerentes internos con nombre personal real (excluir cuentas genéricas como Admin, Bell, Manager, etc.)
  SELECT
    regexp_replace(btrim(COALESCE(u.full_name, '')), '\s+', ' ', 'g'),
    COALESCE(NULLIF(btrim(u.role::text), ''), 'staff'),
    u.store_id
  INTO v_name, v_role, v_store_id
  FROM public.users u
  WHERE u.is_active IS NOT FALSE
    AND u.phone IS NOT NULL
    AND length(regexp_replace(u.phone::text, '\D', '', 'g')) >= 10
    AND right(regexp_replace(u.phone::text, '\D', '', 'g'), 10) = v_digits
    AND length(btrim(COALESCE(u.full_name, ''))) >= 3
    AND lower(regexp_replace(btrim(u.full_name), '\s+', ' ', 'g')) NOT IN (
      'admin', 'administrador', 'administrator', 'manager', 'gerente', 'general manager',
      'supervisor', 'asistente', 'assistant', 'cajero', 'cocina', 'kiosk', 'kiosko',
      'tablet', 'tableta', 'bodega', 'preparador', 'test', 'demo', 'user', 'usuario',
      'central', 'broadway', 'slauson', 'lynwood', 'bell', 'compton', 'downey',
      'rialto', 'santa ana', 'long beach', 'south gate', 'huntington park', 'vernon',
      'bell gardens', 'walnut park', 'normandie', 'whittier', 'pico rivera'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.stores st
      WHERE lower(btrim(st.name::text)) = lower(regexp_replace(btrim(u.full_name), '\s+', ' ', 'g'))
    )
  ORDER BY
    CASE WHEN position(' ' in btrim(u.full_name)) > 0 THEN 0 ELSE 1 END,
    u.id ASC
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    RETURN QUERY SELECT v_name, 'employee'::text, 'employee'::text, v_role, v_store_id;
    RETURN;
  END IF;

  -- 2. Empleados sincronizados de Toast POS (public.toast_employees)
  SELECT
    regexp_replace(
      btrim(COALESCE(NULLIF(btrim(te.chosen_name), ''), btrim(COALESCE(te.first_name, '') || ' ' || COALESCE(te.last_name, '')))),
      '\s+', ' ', 'g'
    )
  INTO v_name
  FROM public.toast_employees te
  WHERE te.phone IS NOT NULL
    AND length(regexp_replace(COALESCE(te.phone, ''), '\D', '', 'g')) >= 10
    AND right(regexp_replace(COALESCE(te.phone, ''), '\D', '', 'g'), 10) = v_digits
    AND length(btrim(COALESCE(NULLIF(btrim(te.chosen_name), ''), btrim(COALESCE(te.first_name, '') || ' ' || COALESCE(te.last_name, ''))))) >= 2
  ORDER BY te.last_updated DESC NULLS LAST
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    RETURN QUERY SELECT v_name, 'employee'::text, 'employee'::text, 'toast_employee'::text, NULL::bigint;
    RETURN;
  END IF;

  -- 3. Sucursales de Tacos Gavilan (public.stores)
  SELECT
    'Sucursal #' || s.id::text || ' ' || btrim(s.name::text),
    s.id
  INTO v_name, v_store_id
  FROM public.stores s
  WHERE s.is_active IS NOT FALSE
    AND s.phone IS NOT NULL
    AND length(regexp_replace(s.phone::text, '\D', '', 'g')) >= 10
    AND right(regexp_replace(s.phone::text, '\D', '', 'g'), 10) = v_digits
  ORDER BY s.id ASC
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    RETURN QUERY SELECT v_name, 'store'::text, 'employee'::text, 'store'::text, v_store_id;
    RETURN;
  END IF;

  -- 4. Proveedores activos (public.suppliers)
  SELECT
    CASE
      WHEN NULLIF(btrim(COALESCE(sp.contact_name, '')), '') IS NOT NULL AND NULLIF(btrim(COALESCE(sp.name, '')), '') IS NOT NULL
        THEN regexp_replace(btrim(sp.contact_name), '\s+', ' ', 'g') || ' (' || regexp_replace(btrim(sp.name), '\s+', ' ', 'g') || ')'
      ELSE regexp_replace(btrim(COALESCE(NULLIF(btrim(sp.contact_name), ''), sp.name, '')), '\s+', ' ', 'g')
    END
  INTO v_name
  FROM public.suppliers sp
  WHERE sp.is_active IS NOT FALSE
    AND sp.contact_phone IS NOT NULL
    AND length(regexp_replace(sp.contact_phone, '\D', '', 'g')) >= 10
    AND right(regexp_replace(sp.contact_phone, '\D', '', 'g'), 10) = v_digits
    AND length(btrim(COALESCE(NULLIF(btrim(sp.contact_name), ''), sp.name, ''))) >= 2
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    RETURN QUERY SELECT v_name, 'vendor'::text, 'vendor'::text, 'supplier'::text, NULL::bigint;
    RETURN;
  END IF;

  -- 5. Clientes de lealtad Gavilan POS (public.gavilan_pos_loyalty_accounts)
  SELECT regexp_replace(btrim(la.customer_name), '\s+', ' ', 'g')
  INTO v_name
  FROM public.gavilan_pos_loyalty_accounts la
  WHERE la.phone IS NOT NULL
    AND length(regexp_replace(la.phone, '\D', '', 'g')) >= 10
    AND right(regexp_replace(la.phone, '\D', '', 'g'), 10) = v_digits
    AND length(btrim(COALESCE(la.customer_name, ''))) >= 2
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    RETURN QUERY SELECT v_name, 'loyalty'::text, 'customer'::text, 'loyalty'::text, NULL::bigint;
    RETURN;
  END IF;

  -- 6. Clientes o llamantes recurrentes previos en Twilio (public.phone_callback_requests)
  SELECT
    regexp_replace(btrim(cb.caller_name), '\s+', ' ', 'g'),
    COALESCE(NULLIF(btrim(cb.caller_type), ''), 'customer'),
    cb.store_id::bigint
  INTO v_name, v_type, v_store_id
  FROM public.phone_callback_requests cb
  WHERE cb.source = 'twilio'
    AND cb.caller_phone IS NOT NULL
    AND length(regexp_replace(COALESCE(cb.caller_phone, ''), '\D', '', 'g')) >= 10
    AND right(regexp_replace(COALESCE(cb.caller_phone, ''), '\D', '', 'g'), 10) = v_digits
    AND length(btrim(COALESCE(cb.caller_name, ''))) >= 2
    AND lower(btrim(cb.caller_name)) NOT IN (
      'cliente', 'customer', 'caller', 'unknown', 'persona', 'usuario',
      'n/a', 'none', 'anonymous', 'anonimo', 'anónimo', 'desconocido', 'not provided', 'driver'
    )
  ORDER BY cb.created_at DESC
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    RETURN QUERY SELECT v_name, 'returning_caller'::text, v_type, 'previous_callback'::text, v_store_id;
    RETURN;
  END IF;

  -- 7. Caché CNAM de 30 días (public.phone_caller_id_cache)
  SELECT
    c.display_name,
    COALESCE(NULLIF(btrim(c.source), ''), 'twilio_cnam'),
    CASE WHEN upper(COALESCE(c.caller_type, '')) = 'BUSINESS' THEN 'vendor' ELSE 'customer' END
  INTO v_name, v_src, v_type
  FROM public.phone_caller_id_cache c
  WHERE c.phone_digits = v_digits
    AND c.expires_at > now()
    AND c.display_name IS NOT NULL
    AND length(btrim(c.display_name)) >= 2
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    RETURN QUERY SELECT v_name, v_src, v_type, 'cnam_cache'::text, NULL::bigint;
    RETURN;
  END IF;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_phone_caller_directory(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_phone_caller_directory(text) TO service_role;
