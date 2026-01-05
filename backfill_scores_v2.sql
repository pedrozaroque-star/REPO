-- SCRIPT DE RECUPERACIÓN V2 (CORREGIDO)
-- La estructura real usa claves cortas (servicio, carnes, aseo...)
-- Este sí funcionará.

UPDATE supervisor_inspections
SET 
    -- 1. Servicio al Cliente ("servicio")
    service_score = COALESCE(
        (answers -> 'servicio' ->> 'score')::integer, 
        0
    ),

    -- 2. Carnes ("carnes")
    meat_score = COALESCE(
        (answers -> 'carnes' ->> 'score')::integer, 
        0
    ),

    -- 3. Alimentos ("alimentos")
    food_score = COALESCE(
        (answers -> 'alimentos' ->> 'score')::integer, 
        0
    ),

    -- 4. Tortillas ("tortillas")
    tortilla_score = COALESCE(
        (answers -> 'tortillas' ->> 'score')::integer, 
        0
    ),

    -- 5. Limpieza ("limpieza")
    cleaning_score = COALESCE(
        (answers -> 'limpieza' ->> 'score')::integer, 
        0
    ),

    -- 6. Bitácoras ("bitacoras")
    log_score = COALESCE(
        (answers -> 'bitacoras' ->> 'score')::integer, 
        0
    ),

    -- 7. Aseo Personal ("aseo")
    grooming_score = COALESCE(
        (answers -> 'aseo' ->> 'score')::integer, 
        0
    )

WHERE service_score = 0;

-- Verificamos resultados
SELECT id, service_score, cleaning_score FROM supervisor_inspections WHERE service_score > 0 LIMIT 5;
