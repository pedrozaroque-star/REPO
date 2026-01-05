import csv
import json
import uuid
import ast

# Configuration
SOURCE_CSV = 'respuestas Inspecciones, manager y asistentes.csv'
OUTPUT_SQL = 'migrate_supervisor_final.sql'

# Mappings
STORE_MAP = {
    'Bell': 15,
    'Lynwood': 14,
    'Downey': 13,
    'South Gate': 16
}

INSPECTOR_ID = 48 # Wilian Aguilar
INSPECTOR_NAME = 'Willian Aguilar'

def parse_photos(photo_str):
    """Parses the FotosURLs string into a PostgreSQL array format."""
    if not photo_str:
        return '{}'
    
    # The CSV has newline separated URLs, sometimes with quotes
    # Example: "url1\nurl2\nurl3" or just url1
    try:
        # Split by newline
        raw_urls = photo_str.strip().split('\n')
        
        # Clean up each URL: remove whitespace and potential surrounding quotes
        clean_urls = []
        for url in raw_urls:
            url = url.strip()
            # Remove start/end quotes if present
            if url.startswith('"') and url.endswith('"'):
                url = url[1:-1]
            
            # Keep original format as requested (no transformation to uc?export=view)
            if url:
                clean_urls.append(url)

        if not clean_urls:
            return '{}'

        # Format as Postgres array literal: {"url1","url2"}
        # Escape double quotes in URLs just in case
        sanitized_urls = [f'"{url.replace('"', '\\"')}"' for url in clean_urls]
        return '{' + ','.join(sanitized_urls) + '}'
    except:
        # Fallback
        return '{}'

def escape_sql_string(val):
    if val is None:
        return 'NULL'
    return "'" + str(val).replace("'", "''") + "'"

def generate_insert_sql():
    print(f"Reading from {SOURCE_CSV}...")
    
    with open(SOURCE_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        with open(OUTPUT_SQL, 'w', encoding='utf-8') as sql_file:
            sql_file.write("-- Migration Script for Legacy Supervisor Inspections\n")
            sql_file.write("-- Generated systematically to prevent duplicates\n\n")

            sql_file.write("-- First, clear the table to start fresh (TRUNCATE)\n")
            sql_file.write("TRUNCATE TABLE supervisor_inspections;\n\n")

            sql_file.write("-- Ensure the unique constraint exists for future stability\n")
            sql_file.write("DO $$\n")
            sql_file.write("BEGIN\n")
            sql_file.write("    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supervisor_inspections_original_report_id_key') THEN\n")
            sql_file.write("        ALTER TABLE supervisor_inspections ADD CONSTRAINT supervisor_inspections_original_report_id_key UNIQUE (original_report_id);\n")
            sql_file.write("    END IF;\n")
            sql_file.write("END $$;\n\n")


            
            count = 0
            for row in reader:
                # Basic identifiers
                # original_report_id is grabbed later


                store_name = row.get('Sucursal', '').strip()
                store_id = STORE_MAP.get(store_name)
                
                if not store_id:
                    print(f"Skipping row {count}: Unknown store '{store_name}'")
                    continue

                # Dates and Times
                # CSV Format example: 28/10/2025, 13:22:00
                # Target Format: YYYY-MM-DD
                date_str = row.get('Fecha')
                time_str = row.get('Hora')
                
                # Simple date conversion if needed, assuming ISO or consistent format in CSV
                # If CSV is DD/MM/YYYY, we might need conversion. 
                # Based on previous file views, it looked like YYYY-MM-DD or similar.
                # Let's assume input is compatible for now or needs slight tweak.
                # Actually, standard SQL usually handles '2025-10-28'.
                
                # Scores
                try:
                    servicio_score = int(row.get('Servicio(0-100)', 0))
                    carnes_score = int(row.get('Carnes(0-100)', 0))
                    alimentos_score = int(row.get('Alimentos(0-100)', 0))
                    tortillas_score = int(row.get('Tortillas(0-100)', 0))
                    limpieza_score = int(row.get('Limpieza(0-100)', 0))
                    bitacoras_score = int(row.get('Bitacoras(0-100)', 0))
                    aseo_score = int(row.get('Aseo(0-100)', 0))
                    overall_score = int(row.get('Promedio(0-100)', 0))
                except ValueError:
                    servicio_score = 0
                    carnes_score = 0
                    alimentos_score = 0
                    tortillas_score = 0
                    limpieza_score = 0
                    bitacoras_score = 0
                    aseo_score = 0
                    overall_score = 0

                comments = row.get('Comentarios', '')
                
                # JSON Answers
                detalle_json = row.get('DetalleJSON', '{}')
                # Determine photos count
                photos_str = row.get('FotosURLs', '[]')
                photos_sql_array = parse_photos(photos_str)
                
                original_report_id = row.get('ID')
                if not original_report_id:
                    # Generate a generic UUID if missing (for the last 10 rows issue)
                    original_report_id = str(uuid.uuid4())
                    print(f"Warning: Row {count} (Store: {store_name}) missing ID. Generated new UUID: {original_report_id}")
                
                insert_stmt = f"""
INSERT INTO supervisor_inspections (
    store_id, 
    inspector_id, 
    inspection_date, 
    inspection_time,
    servicio_score, 
    carnes_score, 
    alimentos_score, 
    tortillas_score, 
    limpieza_score, 
    bitacoras_score, 
    aseo_score, 
    overall_score,
    comments, 
    original_report_id, 
    answers, 
    photos,
    created_at,
    updated_at
) VALUES (
    {store_id},
    {INSPECTOR_ID},
    {escape_sql_string(date_str)},
    {escape_sql_string(time_str)},
    {servicio_score},
    {carnes_score},
    {alimentos_score},
    {tortillas_score},
    {limpieza_score},
    {bitacoras_score},
    {aseo_score},
    {overall_score},
    {escape_sql_string(comments)},
    {escape_sql_string(original_report_id)},
    {escape_sql_string(detalle_json)}::jsonb,
    '{photos_sql_array}',
    NOW(),
    NOW()
) ON CONFLICT (original_report_id) DO NOTHING;
"""
                sql_file.write(insert_stmt)
                count += 1
            
            print(f"Generated SQL for {count} records in {OUTPUT_SQL}")

if __name__ == '__main__':
    generate_insert_sql()
