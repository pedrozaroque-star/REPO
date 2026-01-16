
-- Update template codes to match frontend expectations (v1 convention)

BEGIN;

UPDATE templates SET code = 'apertura_v1' WHERE code = 'checklist_apertura';
UPDATE templates SET code = 'cierre_v1' WHERE code = 'checklist_cierre';
UPDATE templates SET code = 'recorrido_v1' WHERE code = 'checklist_recorrido';
UPDATE templates SET code = 'sobrante_v1' WHERE code = 'checklist_sobrante';
UPDATE templates SET code = 'temperaturas_v1' WHERE code = 'checklist_temperaturas';

-- Verify update
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT code, title FROM templates WHERE code LIKE '%_v1' LOOP
    RAISE NOTICE 'Updated: % - %', r.code, r.title;
  END LOOP;
END $$;

COMMIT;
