-- ============================================================================
-- SCHEMAS FOR MILESIQ MODULE (Control y Cálculo de Millas para Supervisores)
-- Tacos Gavilan
-- ============================================================================

-- 1. Tabla de viajes de supervisores (MilesIQ Trips)
CREATE TABLE IF NOT EXISTS supervisor_mileage_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supervisor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    supervisor_name TEXT NOT NULL,
    supervisor_email TEXT NOT NULL,
    trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
    start_time TEXT, -- ej. '02:39 PM'
    end_time TEXT,
    origin_type TEXT NOT NULL DEFAULT 'store' CHECK (origin_type IN ('store', 'bodega', 'office', 'home', 'custom')),
    origin_store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    origin_name TEXT NOT NULL, -- ej. 'Central Gavilan'
    destination_type TEXT NOT NULL DEFAULT 'store' CHECK (destination_type IN ('store', 'bodega', 'office', 'home', 'custom')),
    destination_store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    destination_name TEXT NOT NULL, -- ej. 'L. A. Broadway Gavilan'
    is_round_trip BOOLEAN DEFAULT FALSE,
    purpose TEXT NOT NULL DEFAULT 'Business' CHECK (purpose IN ('Business', 'Personal', 'Commute')),
    purpose_notes TEXT,
    odometer_start NUMERIC(10,2),
    odometer_end NUMERIC(10,2),
    distance_miles NUMERIC(10,2) NOT NULL CHECK (distance_miles >= 0),
    rate_per_mile NUMERIC(6,3) NOT NULL DEFAULT 0.725,
    mileage_value NUMERIC(10,2) GENERATED ALWAYS AS (distance_miles * rate_per_mile) STORED,
    parking_amount NUMERIC(10,2) DEFAULT 0.00,
    tolls_amount NUMERIC(10,2) DEFAULT 0.00,
    total_reimbursement NUMERIC(10,2) GENERATED ALWAYS AS ((distance_miles * rate_per_mile) + COALESCE(parking_amount, 0) + COALESCE(tolls_amount, 0)) STORED,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'submitted_hr', 'paid', 'rejected')),
    hr_submission_id UUID,
    hr_submitted_at TIMESTAMPTZ,
    rejection_reason TEXT,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de envíos a RRHH (HR Submissions Log)
CREATE TABLE IF NOT EXISTS mileage_hr_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    submitted_by_id UUID NOT NULL REFERENCES users(id),
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
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
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
    current_rate_per_mile NUMERIC(6,3) DEFAULT 0.725,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Inserts iniciales de correos recurrentes de prueba si no existen
INSERT INTO mileage_recurrent_emails (email, label, use_count)
VALUES 
    ('rrhh@tacosgavilan.com', 'Recursos Humanos Corporativo', 5),
    ('nomina@tacosgavilan.com', 'Departamento de Nómina', 3)
ON CONFLICT (email) DO NOTHING;

-- Insert de tarifa inicial si no existe
INSERT INTO supervisor_mileage_settings (id, current_rate_per_mile)
VALUES ('00000000-0000-0000-0000-000000000001', 0.725)
ON CONFLICT (id) DO NOTHING;

-- Matriz de distancias predeterminadas de ejemplo basadas en tiendas reales
INSERT INTO store_distances (origin_name, destination_name, distance_miles, notes)
VALUES 
    ('Central Gavilan', 'L. A. Broadway Gavilan', 2.90, 'Ruta directa vía Broadway'),
    ('Central Gavilan', 'Slauson Gavilan', 6.20, 'Vía Slauson Ave'),
    ('Slauson Gavilan', 'Hollywood Gavilan', 12.50, 'Vía Freeway 101'),
    ('L. A. Broadway Gavilan', 'Slauson Gavilan', 3.20, 'Vía Broadway y Slauson'),
    ('Bodega Central', 'Central Gavilan', 4.50, 'Surtido de almacén')
ON CONFLICT (origin_name, destination_name) DO UPDATE SET distance_miles = EXCLUDED.distance_miles;
