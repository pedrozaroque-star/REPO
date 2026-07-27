CREATE TABLE IF NOT EXISTS food_cost_anomalies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_date DATE NOT NULL,
    store_id UUID,
    item_name TEXT NOT NULL,
    toast_item_guid TEXT,
    food_cost_percent NUMERIC(10,2),
    total_cost NUMERIC(10,2),
    quantity INTEGER DEFAULT 0,
    severity TEXT DEFAULT 'warning',
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fc_anomalies_unresolved 
ON food_cost_anomalies(resolved, business_date) WHERE resolved = FALSE;

CREATE OR REPLACE FUNCTION invalidate_food_cost_cache_on_inventory_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.quantity_per_unit IS DISTINCT FROM NEW.quantity_per_unit)
       OR (OLD.purchase_unit_cost IS DISTINCT FROM NEW.purchase_unit_cost)
       OR (OLD.unit_measure IS DISTINCT FROM NEW.unit_measure) THEN
        DELETE FROM food_cost_daily_cache 
        WHERE business_date >= (CURRENT_DATE - INTERVAL '3 days');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invalidate_fc_cache_on_inventory_change ON inventory_items;
CREATE TRIGGER trg_invalidate_fc_cache_on_inventory_change
    AFTER UPDATE ON inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION invalidate_food_cost_cache_on_inventory_change();
