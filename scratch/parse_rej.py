import re
import os

rej_path = r"c:\Users\pedro\Desktop\teg-modernizado\app\roles\page.tsx.rej"
if not os.path.exists(rej_path):
    print("No reject file found")
    exit(0)

content = open(rej_path, 'r', encoding='utf-8').read()
# Find all hunks by splitting on the @@ hunk header pattern
hunk_headers = re.findall(r'^@@ -\d+,\d+ \+\d+,\d+ @@.*', content, re.MULTILINE)
hunk_bodies = re.split(r'^@@ -\d+,\d+ \+\d+,\d+ @@.*', content, flags=re.MULTILINE)

# The first element of hunk_bodies is the file header, so discard it or handle separately
file_header = hunk_bodies[0]
hunk_bodies = hunk_bodies[1:]

print(f"Total hunk headers: {len(hunk_headers)}")
print(f"Total hunk bodies: {len(hunk_bodies)}")

with open("scratch/rej_summary.txt", "w", encoding="utf-8") as out_f:
    out_f.write(f"Total rejected hunks: {len(hunk_headers)}\n")

    for i in range(len(hunk_headers)):
        header = hunk_headers[i]
        body = hunk_bodies[i].strip()
        out_f.write(f"\n=================== REJECT {i+1} ===================\n")
        out_f.write(f"Header: {header}\n")
        
        body_lines = body.split('\n')
        original = []
        replacement = []
        for line in body_lines:
            if line.startswith('-'):
                original.append(line[1:])
            elif line.startswith('+'):
                replacement.append(line[1:])
            elif line.startswith(' '):
                original.append(line[1:])
                replacement.append(line[1:])
                
        out_f.write(f"Original lines count: {len(original)}\n")
        out_f.write("Original first few lines:\n")
        for line in original[:6]:
            out_f.write(f"   {repr(line)}\n")
        out_f.write(f"Replacement lines count: {len(replacement)}\n")
        out_f.write("Replacement first few lines:\n")
        for line in replacement[:6]:
            out_f.write(f"   {repr(line)}\n")

