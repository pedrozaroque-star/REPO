import json
import os

chunks_path = r"C:\Users\pedro\.gemini\antigravity\brain\7f8d96b2-5c80-4156-a707-9b12d85ca4af\scratch\step_3532_chunks_clean.json"
base_file_path = r"c:\Users\pedro\Desktop\teg-modernizado\app\roles\page.tsx"

if not os.path.exists(chunks_path):
    print("Chunks file not found")
    exit(1)

with open(chunks_path, "r", encoding="utf-8") as f:
    chunks = json.load(f)

print(f"Loaded {len(chunks)} chunks.")

with open(base_file_path, "r", encoding="utf-8") as f:
    file_content = f.read()

# We will apply chunks one by one
# Since chunks are defined for a specific base file, we should find each TargetContent and replace it.
# To make it robust against small line differences, we can search for the exact TargetContent.
# If it's found, we replace it.
success_count = 0
for idx, chunk in enumerate(chunks):
    target = chunk.get("TargetContent")
    replacement = chunk.get("ReplacementContent")
    
    # Check if target matches exactly in the file_content
    if target in file_content:
        # Check occurrences
        occurrences = file_content.count(target)
        if occurrences == 1:
            file_content = file_content.replace(target, replacement)
            print(f"Chunk {idx+1}: Successfully replaced unique occurrence.")
            success_count += 1
        else:
            print(f"Chunk {idx+1}: Target found but has {occurrences} occurrences in the file! Skipping for safety.")
    else:
        print(f"Chunk {idx+1}: Target content NOT found in the file! Skipping.")

if success_count == len(chunks):
    # Save the modified content back to base_file_path
    with open(base_file_path, "w", encoding="utf-8") as f:
        f.write(file_content)
    print("\nAll chunks applied successfully! page.tsx has been updated.")
else:
    print(f"\nFailed to apply all chunks. Only applied {success_count}/{len(chunks)} chunks. Check if target strings have changed.")
