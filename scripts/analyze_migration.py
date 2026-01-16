import csv
import json
import uuid

# Target file for SQL
output_sql = 'supervisor_migration.sql'

# ID Mappings
STORE_MAPPING = {
    "Bell": 15,
    "Lynwood": 14,
    "Downey": 13,
    "South Gate": 16
}

INSPECTOR_ID = 48 # Wilian Aguilar

# 1. Get existing IDs
existing_ids = set()
try:
    with open('supervisor_inspections_rows.csv', mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['original_report_id']:
                existing_ids.add(row['original_report_id'])
except FileNotFoundError:
    print("Warning: supervisor_inspections_rows.csv not found. Assuming clean migration.")

# 2. Process legacy CSV
migration_count = 0
sql_statements = []

legacy_file = 'respuestas Inspecciones, manager y asistentes.csv'

with open(legacy_file, mode='r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        report_id = row['original_report_id']
        
        # Skip if already exists
        if report_id in existing_ids:
            continue
            
        # Parse store
        store_id = STORE_MAPPING.get(row['Sucursal'])
        if not store_id:
            print(f"Warning: Unknown store '{row['Sucursal']}' for report {report_id}. Skipping.")
            continue
            
        # Parse scores and dates
        # Columns: Timestamp,Fecha,Hora,Sucursal,Inspector,Carnes,Alimentos,Limpieza,Bitacoras,Aseo,Servicio,Tortillas,Comments,DetalleJSON,FotosURLs,original_report_id
        
        try:
            # Map columns to DB schema
            # Note: We use the names from the target table export for consistency where possible
            data = {
                'store_id': store_id,
                'inspector_id': INSPECTOR_ID,
                'inspection_date': row['Fecha'],
                'inspection_time': row['Hora'],
                'comments': row['Comments'].replace("'", "''"),
                'original_report_id': report_id,
                'created_at': row['Timestamp'],
                'meat_score': int(row['Carnes']) if row['Carnes'] else 0,
                'food_score': int(row['Alimentos']) if row['Alimentos'] else 0,
                'cleaning_score': int(row['Limpieza']) if row['Limpieza'] else 0,
                'log_score': int(row['Bitacoras']) if row['Bitacoras'] else 0,
                'grooming_score': int(row['Aseo']) if row['Aseo'] else 0,
                'service_score': int(row['Servicio']) if row['Servicio'] else 0,
                'tortilla_score': int(row['Tortillas']) if row['Tortillas'] else 0,
            }
            
            # Parse DetalleJSON
            answers_json = row['DetalleJSON']
            # DetalleJSON in legacy: {"carnes":{...}, "alimentos":{...}, ...}
            # The target table uses 'answers' column (JSONB)
            
            # Parse Photos
            photo_links = row['FotosURLs'].split(',') if row['FotosURLs'] else []
            photos_array = json.dumps([link.strip() for link in photo_links if link.strip()])
            
            # Construct SQL
            columns = ', '.join(data.keys()) + ', answers, photos'
            values = []
            for k, v in data.items():
                if isinstance(v, str):
                    values.append(f"'{v}'")
                else:
                    values.append(str(v))
            
            # Add JSON fields
            values.append(f"'{answers_json}'::jsonb")
            values.append(f"'{photos_array}'::jsonb")
            
            sql = f"INSERT INTO supervisor_inspections ({columns}) VALUES ({', '.join(values)}) ON CONFLICT (original_report_id) DO NOTHING;"
            sql_statements.append(sql)
            migration_count += 1
            
        except Exception as e:
            print(f"Error processing row {report_id}: {e}")

# Save SQL
with open(output_sql, 'w', encoding='utf-8') as f:
    f.write('\n'.join(sql_statements))

print(f"Successfully generated {migration_count} migration statements in {output_sql}")
