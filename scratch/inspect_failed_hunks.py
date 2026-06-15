import os
import re

rej_path = r"c:\Users\pedro\Desktop\teg-modernizado\app\roles\page.tsx.rej"
out_path = r"c:\Users\pedro\Desktop\teg-modernizado\scratch\failed_hunks_summary.txt"

if not os.path.exists(rej_path):
    print("No reject file found")
    exit(0)

content = open(rej_path, 'r', encoding='utf-8').read()
hunk_headers = re.findall(r'^@@ -\d+,\d+ \+\d+,\d+ @@.*', content, re.MULTILINE)
hunk_bodies = re.split(r'^@@ -\d+,\d+ \+\d+,\d+ @@.*', content, flags=re.MULTILINE)

# Skip file header
hunk_bodies = hunk_bodies[1:]

with open(out_path, 'w', encoding='utf-8') as out_f:
    out_f.write(f"Total rejects: {len(hunk_headers)}\n")
    for i in range(len(hunk_headers)):
        header = hunk_headers[i]
        body = hunk_bodies[i].strip()
        out_f.write(f"\n\n=================== REJECT {i+1} ===================\n")
        out_f.write(f"Header: {header}\n")
        
        # Split body lines
        lines = body.split('\n')
        original = []
        replacement = []
        for line in lines:
            if line.startswith('-'):
                original.append(line[1:])
            elif line.startswith('+'):
                replacement.append(line[1:])
            elif line.startswith(' '):
                original.append(line[1:])
                replacement.append(line[1:])
                
        out_f.write("\n--- ORIGINAL ---\n")
        out_f.write('\n'.join(original))
        out_f.write("\n\n--- REPLACEMENT ---\n")
        out_f.write('\n'.join(replacement))

print("Saved failed hunks summary to", out_path)
