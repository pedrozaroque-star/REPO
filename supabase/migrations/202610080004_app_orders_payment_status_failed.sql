-- Migration: 202610080004_app_orders_payment_status_failed.sql
-- Description: Allow 'FAILED' in app_orders.payment_status check constraint.

ALTER TABLE public.app_orders DROP CONSTRAINT IF EXISTS app_orders_payment_status_check;
ALTER TABLE public.app_orders ADD CONSTRAINT app_orders_payment_status_check 
  CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED'));
