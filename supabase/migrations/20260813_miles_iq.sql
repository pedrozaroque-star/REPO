-- ============================================================================
-- SCHEMAS FOR MILESIQ MODULE (Control y Cálculo de Millas para Supervisores)
-- Tacos Gavilan
-- ============================================================================

-- 1. Tabla de viajes de supervisores (MilesIQ Trips)
CREATE TABLE IF NOT EXISTS supervisor_mileage_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supervisor_id TEXT NOT NULL,
    supervisor_name TEXT NOT NULL,
    supervisor_email TEXT NOT NULL,
    trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
    start_time TEXT,
    end_time TEXT,
    origin_type TEXT NOT NULL DEFAULT 'store',
    origin_store_id TEXT,
    origin_name TEXT NOT NULL,
    destination_type TEXT NOT NULL DEFAULT 'store',
    destination_store_id TEXT,
    destination_name TEXT NOT NULL,
    is_round_trip BOOLEAN DEFAULT FALSE,
    purpose TEXT NOT NULL DEFAULT 'Business',
    purpose_notes TEXT,
    odometer_start NUMERIC(10,2),
    odometer_end NUMERIC(10,2),
    distance_miles NUMERIC(10,2) NOT NULL CHECK (distance_miles >= 0),
    rate_per_mile NUMERIC(6,3) NOT NULL DEFAULT 0.760,
    mileage_value NUMERIC(10,2) GENERATED ALWAYS AS (distance_miles * rate_per_mile) STORED,
    parking_amount NUMERIC(10,2) DEFAULT 0.00,
    tolls_amount NUMERIC(10,2) DEFAULT 0.00,
    total_reimbursement NUMERIC(10,2) GENERATED ALWAYS AS ((distance_miles * rate_per_mile) + COALESCE(parking_amount, 0) + COALESCE(tolls_amount, 0)) STORED,
    status TEXT NOT NULL DEFAULT 'pending',
    hr_submission_id UUID,
    hr_submitted_at TIMESTAMPTZ,
    rejection_reason TEXT,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de envíos a RRHH (HR Submissions Log)
CREATE TABLE IF NOT EXISTS mileage_hr_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    submitted_by_id TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    total_supervisors INT NOT NULL,
    total_miles NUMERIC(10,2) NOT NULL,
    total_reimbursement NUMERIC(10,2) NOT NULL,
    email_status TEXT DEFAULT 'sent',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Catálogo de Correos Recurrentes para Envío a RRHH
CREATE TABLE IF NOT EXISTS mileage_recurrent_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    label TEXT,
    use_count INT DEFAULT 1,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Matriz de distancias estándar entre sucursales
CREATE TABLE IF NOT EXISTS store_distances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_name TEXT NOT NULL,
    destination_name TEXT NOT NULL,
    distance_miles NUMERIC(6,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(origin_name, destination_name)
);

-- 5. Configuración de tarifa global
CREATE TABLE IF NOT EXISTS supervisor_mileage_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    current_rate_per_mile NUMERIC(6,3) DEFAULT 0.760,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

-- Habilitar RLS
ALTER TABLE supervisor_mileage_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_hr_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_recurrent_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_distances ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervisor_mileage_settings ENABLE ROW LEVEL SECURITY;

-- Políticas Permisivas para RLS con cliente authenticated y service role
DROP POLICY IF EXISTS "mileage_trips_all" ON supervisor_mileage_trips;
CREATE POLICY "mileage_trips_all" ON supervisor_mileage_trips FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mileage_hr_submissions_all" ON mileage_hr_submissions;
CREATE POLICY "mileage_hr_submissions_all" ON mileage_hr_submissions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mileage_recurrent_emails_all" ON mileage_recurrent_emails;
CREATE POLICY "mileage_recurrent_emails_all" ON mileage_recurrent_emails FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "store_distances_all" ON store_distances;
CREATE POLICY "store_distances_all" ON store_distances FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mileage_settings_all" ON supervisor_mileage_settings;
CREATE POLICY "mileage_settings_all" ON supervisor_mileage_settings FOR ALL USING (true) WITH CHECK (true);

-- Datos Semilla (Initial Seeding)
INSERT INTO mileage_recurrent_emails (email, label, use_count)
VALUES 
    ('rrhh@tacosgavilan.com', 'Recursos Humanos Corporativo', 5),
    ('nomina@tacosgavilan.com', 'Departamento de Nómina', 3)
ON CONFLICT (email) DO NOTHING;

INSERT INTO supervisor_mileage_settings (id, current_rate_per_mile)
VALUES ('00000000-0000-0000-0000-000000000001', 0.760)
ON CONFLICT (id) DO NOTHING;

INSERT INTO store_distances (origin_name, destination_name, distance_miles, notes)
VALUES 
    ('Central Gavilan', 'L. A. Broadway Gavilan', 2.90, 'Ruta directa vía Broadway'),
    ('Central Gavilan', 'Slauson Gavilan', 6.20, 'Vía Slauson Ave'),
    ('Slauson Gavilan', 'Hollywood Gavilan', 12.50, 'Vía Freeway 101'),
    ('L. A. Broadway Gavilan', 'Slauson Gavilan', 3.20, 'Vía Broadway y Slauson'),
    ('Bodega Central', 'Central Gavilan', 4.50, 'Surtido de almacén')
ON CONFLICT (origin_name, destination_name) DO UPDATE SET distance_miles = EXCLUDED.distance_miles;
