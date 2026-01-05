
-- 1. DATOS DE CUSTOMER_FEEDBACK (El que funciona)
SELECT 
    'CUSTOMER_FEEDBACK' as tabla,
    id, 
    photo_urls as valor, 
    pg_typeof(photo_urls) as tipo_dato_postgres,
    jsonb_typeof(to_jsonb(photo_urls)) as tipo_json
FROM customer_feedback 
WHERE photo_urls IS NOT NULL 
LIMIT 1;

-- 2. DATOS DE SUPERVISOR_INSPECTIONS (El que falla)
SELECT 
    'SUPERVISOR_INSPECTIONS' as tabla,
    id, 
    photos as valor, 
    pg_typeof(photos) as tipo_dato_postgres,
    jsonb_typeof(to_jsonb(photos)) as tipo_json
FROM supervisor_inspections 
WHERE photos IS NOT NULL 
LIMIT 1;
