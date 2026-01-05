-- SCRIPT DE RECUPERACIÓN DE DATOS HISTÓRICOS
-- Este script llena las nuevas columnas (service_score, cleaning_score, etc.)
-- extrayendo los datos que ya existen dentro de la columna JSON "answers".

UPDATE supervisor_inspections
SET 
    -- 1. Servicio al Cliente
    service_score = COALESCE(
        (answers -> 'Servicio al Cliente' ->> 'score')::integer, 
        0
    ),

    -- 2. Carnes
    meat_score = COALESCE(
        (answers -> 'Procedimiento de Carnes' ->> 'score')::integer, 
        0
    ),

    -- 3. Alimentos
    food_score = COALESCE(
        (answers -> 'Preparación de Alimentos' ->> 'score')::integer, 
        0
    ),

    -- 4. Tortillas
    tortilla_score = COALESCE(
        (answers -> 'Seguimiento a Tortillas' ->> 'score')::integer, 
        0
    ),

    -- 5. Limpieza (Critical)
    cleaning_score = COALESCE(
        (answers -> 'Limpieza General y Baños' ->> 'score')::integer, 
        0
    ),

    -- 6. Bitácoras
    log_score = COALESCE(
        (answers -> 'Checklists y Bitácoras' ->> 'score')::integer, 
        0
    ),

    -- 7. Aseo Personal
    grooming_score = COALESCE(
        (answers -> 'Aseo Personal' ->> 'score')::integer, 
        0
    )

WHERE service_score = 0 
   OR cleaning_score = 0;

-- Confirmación
SELECT COUNT(*) as registros_actualizados FROM supervisor_inspections WHERE service_score > 0;
