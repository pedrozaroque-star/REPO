-- Función RPC para Pronóstico Estacional de Champurrado (5 años)
-- Compara la misma semana del calendario de años anteriores para predecir demanda
-- CORRECCIÓN: raw_lbs son libras reales (convertidas de oz en el CRON sync)
-- 1 Galón = 8 libras de líquido (128 oz / 16 oz per lb), NO 20

CREATE OR REPLACE FUNCTION get_champurrado_seasonal_forecast(
    p_store_id BIGINT,
    p_target_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    year_label INT,
    iso_week INT,
    avg_daily_gallons NUMERIC,
    max_daily_gallons NUMERIC,
    total_days_with_data INT,
    avg_daily_raw_units NUMERIC
) LANGUAGE plpgsql AS $$
DECLARE
    v_target_week INT;
BEGIN
    -- Obtener la semana ISO del target_date
    v_target_week := EXTRACT(WEEK FROM p_target_date)::INT;
    
    RETURN QUERY
    SELECT 
        EXTRACT(YEAR FROM m.business_date)::INT AS year_label,
        v_target_week AS iso_week,
        -- 1 Galón = 8 libras de líquido (128 oz / 16 oz per lb)
        ROUND((SUM(m.raw_lbs) / NULLIF(COUNT(DISTINCT m.business_date), 0) / 8.0)::NUMERIC, 1) AS avg_daily_gallons,
        ROUND((MAX(daily_totals.day_total) / 8.0)::NUMERIC, 1) AS max_daily_gallons,
        COUNT(DISTINCT m.business_date)::INT AS total_days_with_data,
        ROUND((SUM(m.raw_lbs) / NULLIF(COUNT(DISTINCT m.business_date), 0))::NUMERIC, 1) AS avg_daily_raw_units
    FROM public.meat_consumption_history m
    INNER JOIN (
        SELECT 
            business_date AS bd,
            SUM(raw_lbs) AS day_total
        FROM public.meat_consumption_history
        WHERE store_id = p_store_id
          AND meat_type = 'CHAMPURRADO'
          AND EXTRACT(WEEK FROM business_date) = v_target_week
        GROUP BY business_date
    ) daily_totals ON daily_totals.bd = m.business_date
    WHERE m.store_id = p_store_id
      AND m.meat_type = 'CHAMPURRADO'
      AND EXTRACT(WEEK FROM m.business_date) = v_target_week
    GROUP BY EXTRACT(YEAR FROM m.business_date)
    ORDER BY year_label DESC;
END;
$$;

-- Función complementaria: Obtener sugerencia resumida de galones diarios
-- para CUALQUIER meat_type (no solo Champurrado)
CREATE OR REPLACE FUNCTION get_seasonal_avg_gallons(
    p_store_id BIGINT,
    p_meat_type TEXT DEFAULT 'CHAMPURRADO',
    p_target_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    suggested_daily_gallons NUMERIC,
    historical_years_count INT,
    confidence TEXT
) LANGUAGE plpgsql AS $$
DECLARE
    v_target_week INT;
    v_avg NUMERIC;
    v_years INT;
BEGIN
    v_target_week := EXTRACT(WEEK FROM p_target_date)::INT;
    
    SELECT 
        -- 1 Galón = 8 libras de líquido (128 oz / 16 oz per lb)
        ROUND((SUM(raw_lbs) / NULLIF(COUNT(DISTINCT business_date), 0) / 8.0)::NUMERIC, 1),
        COUNT(DISTINCT EXTRACT(YEAR FROM business_date))::INT
    INTO v_avg, v_years
    FROM public.meat_consumption_history
    WHERE store_id = p_store_id
      AND meat_type = p_meat_type
      AND EXTRACT(WEEK FROM business_date) = v_target_week;
    
    RETURN QUERY
    SELECT 
        COALESCE(v_avg, 0) AS suggested_daily_gallons,
        COALESCE(v_years, 0) AS historical_years_count,
        CASE 
            WHEN v_years >= 3 THEN 'HIGH'
            WHEN v_years >= 2 THEN 'MEDIUM'
            WHEN v_years >= 1 THEN 'LOW'
            ELSE 'NONE'
        END AS confidence;
END;
$$;
