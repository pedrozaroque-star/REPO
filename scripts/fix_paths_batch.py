import os

# Directory to scan
DIR = 'scripts'

# Replacements to apply
REPLACEMENTS = [
    ("fs.readFileSync('.env.local')", "fs.readFileSync('../.env.local')"),
    ("require('./lib/", "require('../lib/"),
    ("from './lib/", "from '../lib/"),
    ("require('.env.local')", "require('../.env.local')"), # Rare but possible
]

def fix_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        new_content = content
        for old, new in REPLACEMENTS:
            new_content = new_content.replace(old, new)
        
        if new_content != content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Fixed: {filepath}")
        else:
            print(f"No changes: {filepath}")
            
    except Exception as e:
        print(f"Error processing {filepath}: {e}")

def main():
    if not os.path.exists(DIR):
        print(f"Directory {DIR} not found.")
        return

    count = 0
    for root, dirs, files in os.walk(DIR):
        for name in files:
            if name.endswith('.js') or name.endswith('.ts'):
                fix_file(os.path.join(root, name))
                count += 1
    print(f"Scanned {count} files.")

if __name__ == '__main__':
    main()
