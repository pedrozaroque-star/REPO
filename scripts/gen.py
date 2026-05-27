import csv

csv_file = 'scripts/procedures.csv'
sql_file = 'supabase/migrations/20260527000000_operating_procedures.sql'

sql = """
CREATE TABLE IF NOT EXISTS operating_procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    start_time TIME,
    duration_minutes NUMERIC,
    activity TEXT NOT NULL,
    shift_type TEXT NOT NULL,
    frequency TEXT NOT NULL,
    role TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE operating_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON operating_procedures;
CREATE POLICY "Enable read access for all users" ON operating_procedures FOR SELECT USING (true);

TRUNCATE TABLE operating_procedures;

INSERT INTO operating_procedures (start_time, duration_minutes, activity, shift_type, frequency, role, description)
VALUES
"""

values = []
with open(csv_file, 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    next(reader) # skip header
    for row in reader:
        if len(row) < 5: continue
        no, horario, tiempo, actividad, tipo, dia, dt, responsable, descripcion = row + [''] * (9 - len(row))
        
        # Parse time
        time_str = 'NULL'
        if horario.strip():
            # Example: 8:00 AM
            try:
                t = horario.strip()
                am_pm = t[-2:]
                hm = t[:-2].strip()
                h, m = hm.split(':')
                h = int(h)
                if am_pm.upper() == 'PM' and h < 12: h += 12
                if am_pm.upper() == 'AM' and h == 12: h = 0
                time_str = f"'{h:02d}:{m}:00'"
            except:
                pass
                
        # Parse duration
        duration_mins = 'NULL'
        if tiempo.strip():
            import re
            m = re.search(r'([\d.]+)', tiempo.strip())
            if m: duration_mins = m.group(1)
            
        # Default dia
        if not dia.strip(): dia = 'Diario'
        if tipo.strip() == 'Zierre': tipo = 'Cierre'
        
        def escape(s):
            if not s.strip(): return 'NULL'
            return "'" + s.strip().replace("'", "''") + "'"
            
        v = f"({time_str}, {duration_mins}, {escape(actividad)}, {escape(tipo)}, {escape(dia)}, {escape(responsable)}, {escape(descripcion)})"
        values.append(v)

sql += ",\n".join(values) + ";\n"

with open(sql_file, 'w', encoding='utf-8') as f:
    f.write(sql)
    
print(f"Generated {sql_file}")
