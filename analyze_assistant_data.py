
import csv
import json
from datetime import datetime

# Files
LEGACY_CSV = 'asistentes.csv'
SUPABASE_CSV = 'assistant_checklists_rows.csv'

# Mappings
STORE_MAP = {
    'Bell': 15,
    'Lynwood': 14,
    'Downey': 13,
    'South Gate': 16,
    'Azusa': 17 # Assuming Azusa is 17 or similar? Need to verify.
    # checking generate_supervisor_sql.py, Azusa wasn't there. 
    # I saw Azusa in asistentes.csv. 
    # I need to find the ID for Azusa. 
    # I will check SUPABASE_CSV to see if Azusa appears with an ID.
}

# If Azusa is not in STORE_MAP, I need to find it from Supabase data if possible.
# But Supabase data has store_id, not name.
# Wait, let's look at Supabase CSV again. It doesn't have store name, only store_id.
# I might need to ask the user or guess. 
# But wait, looking at the previous file view of generate_supervisor_sql.py:
# STORE_MAP = {'Bell': 15, 'Lynwood': 14, 'Downey': 13, 'South Gate': 16}
# No Azusa.
# However, `asistentes.csv` line 5 has "Azusa".
# I will output distinct store names from Legacy to be sure.

def parse_legacy_datetime(dt_str):
    # Format: 12/26/2025 20:51
    # Sometimes it might just be date?
    if not dt_str: return None
    try:
        return datetime.strptime(dt_str, '%m/%d/%Y %H:%M')
    except ValueError:
        try:
             return datetime.strptime(dt_str, '%m/%d/%Y %H:%M:%S') # If seconds exist
        except:
             return None

def parse_supabase_date(d_str):
    # 2025-11-07
    try:
        return datetime.strptime(d_str, '%Y-%m-%d').date()
    except:
        return None

def main():
    print("--- Analyzing Assistant Data Migration ---")
    
    # 1. Load Supabase Data to build a lookup set and user map
    supabase_keys = set()
    user_map = {} # Name -> ID
    
    min_sb_date = None
    max_sb_date = None
    
    print(f"Loading {SUPABASE_CSV}...")
    try:
        with open(SUPABASE_CSV, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            count = 0
            for row in reader:
                count += 1
                s_id = row.get('store_id')
                c_type = row.get('checklist_type')
                c_date_str = row.get('checklist_date')
                u_id = row.get('user_id')
                u_name = row.get('user_name')
                s_time = row.get('start_time') # 18:40:41
                
                # Update User Map (Assuming names are consistent)
                if u_name and u_id:
                    user_map[u_name] = u_id
                
                # Parse Date
                c_date = parse_supabase_date(c_date_str)
                if c_date:
                    if min_sb_date is None or c_date < min_sb_date: min_sb_date = c_date
                    if max_sb_date is None or c_date > max_sb_date: max_sb_date = c_date
                
                # Create Key: (store_id, checklist_type, date_str, user_id, start_time_HHMM)
                # Note: Legacy time might be HH:MM. Supabase is HH:MM:SS.
                # We will truncate Supabase time to HH:MM for fuzzy sort of matching
                time_key = s_time[:5] if s_time and len(s_time) >= 5 else s_time
                
                # We use user_id in key if available. Legacy has Name. 
                # We can't use user_id in the key yet because we are scanning Legacy next.
                # Actually we can translate Legacy Name -> ID using the map we are building.
                
                # Key: (store_id_str, checklist_type, date_iso_str, user_name, time_hhmm)
                # Using user_name because it's in both (Legacy has it, Supabase has it).
                key = (str(s_id), c_type, str(c_date), u_name, time_key)
                supabase_keys.add(key)
                
        print(f"Loaded {count} records from Supabase.")
        print(f"Supabase Date Range: {min_sb_date} to {max_sb_date}")
        print(f"User Map Found: {user_map}")

    except FileNotFoundError:
        print(f"Error: {SUPABASE_CSV} not found.")
        return

    # 2. Analyze Legacy Data
    print(f"\nScanning {LEGACY_CSV}...")
    
    legacy_records = []
    
    # Store Map (Augmented with guesses or manual added)
    # We really need Azusa ID. 
    # For now, we will list unmapped stores.
    
    overlap_count = 0
    last_overlap_index = -1
    
    unknown_stores = set()
    
    try:
        with open(LEGACY_CSV, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            # Read all rows to memory to handle indexing
            rows = list(reader)
            print(f"Total Legacy Rows: {len(rows)}")
            
            for index, row in enumerate(rows):
                s_name = row.get('store', '').strip()
                s_id = STORE_MAP.get(s_name)
                
                if not s_id:
                    # Temporary: Check if Azusa
                    if s_name == 'Azusa':
                        s_id = 17 # Guessing for now, will flag in output
                    else:
                        unknown_stores.add(s_name)
                        s_id = 'UNKNOWN'
                
                c_type = row.get('checklist_type')
                u_name = row.get('user', '').strip()
                
                # Date and Time
                # Legacy Start Time: 12/26/2025 20:51
                start_dt_str = row.get('start_time')
                
                start_dt = parse_legacy_datetime(start_dt_str)
                
                if start_dt:
                    c_date_str = str(start_dt.date())
                    time_key = start_dt.strftime('%H:%M')
                else:
                    # Fallback to 'date' column + 'start_time' separation if needed?
                    # Start_time column seemed to have full datetime in preview.
                    c_date_str = 'UNKNOWN'
                    time_key = 'UNKNOWN'
                
                # Construct Key
                key = (str(s_id), c_type, c_date_str, u_name, time_key)
                
                is_overlap = key in supabase_keys
                
                legacy_record = {
                    'index': index,
                    'key': key,
                    'is_overlap': is_overlap,
                    'data': row
                }
                legacy_records.append(legacy_record)
                
                if is_overlap:
                    overlap_count += 1
                    last_overlap_index = index
            
        print(f"\n--- Analysis Results ---")
        print(f"Unknown Stores: {unknown_stores}")
        print(f"Overlapping Records: {overlap_count}")
        print(f"Last Overlap Index: {last_overlap_index}")
        
        if last_overlap_index >= 0:
            last_rec = legacy_records[last_overlap_index]
            print(f"Last Overlapping Record (Index {last_overlap_index}):")
            print(f"  Date: {last_rec['data'].get('start_time')}")
            print(f"  Store: {last_rec['data'].get('store')}")
            print(f"  User: {last_rec['data'].get('user')}")
            
            # Check subsequence
            migratable_count = len(legacy_records) - 1 - last_overlap_index
            print(f"Records to Migrate (Subsequent): {migratable_count}")
            
            if migratable_count > 0:
                first_new = legacy_records[last_overlap_index + 1]
                print(f"First New Record (Index {last_overlap_index + 1}):")
                print(f"  Date: {first_new['data'].get('start_time')}")
        else:
            print("No overlap found. Migration would include ALL records (if verified).")

    except FileNotFoundError:
         print(f"Error: {LEGACY_CSV} not found.")

if __name__ == "__main__":
    main()
