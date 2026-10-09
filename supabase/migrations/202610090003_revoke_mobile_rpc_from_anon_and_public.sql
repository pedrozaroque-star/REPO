-- ==============================================================================
-- Migration: 202610090003_revoke_mobile_rpc_from_anon_and_public.sql
-- Description: Revoca explícitamente permisos de ejecución sobre las funciones RPC
-- críticas de órdenes móviles a PUBLIC, anon y authenticated. Solo service_role tiene acceso.
-- ==============================================================================

REVOKE ALL ON FUNCTION public.app_order_create_transaction(
    UUID, BIGINT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_outbox_batch(TEXT, INT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.app_order_create_transaction(
    UUID, BIGINT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER
) TO service_role;

GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(TEXT, INT) TO service_role;
