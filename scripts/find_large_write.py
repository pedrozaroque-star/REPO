import json
import os
import re

log_path = r"C:\Users\pedro\.gemini\antigravity\brain\7f8d96b2-5c80-4156-a707-9b12d85ca4af\.system_generated\logs\transcript.jsonl"

if not os.path.exists(log_path):
    print("Log not found")
    exit(1)

decoder = json.JSONDecoder()

with open(log_path, "rb") as f:
    data_bytes = f.read()

data = data_bytes.decode("utf-8", errors="ignore")

# Find all occurrences of "write_to_file" or "replace_file_content" or "multi_replace_file_content"
pos = 0
while True:
    idx = data.find('roles/page.tsx', pos)
    if idx == -1:
        break
    
    # Let's find the step start
    step_start = data.rfind('{"step_index"', 0, idx)
    if step_start != -1:
        # Check step_index
        sub_str = data[step_start:step_start + 100]
        match = re.search(r'"step_index":(\d+)', sub_str)
        if match:
            step_num = int(match.group(1))
            print(f"Found mention of roles/page.tsx in step {step_num}")
            
            # Let's see if this step contains a write or patch
            win_start = step_start
            win_end = min(len(data), step_start + 2 * 1024 * 1024)
            step_text = data[win_start:win_end]
            try:
                clean_step = re.sub(r'[\x00-\x1f]', lambda m: '\\u{:04x}'.format(ord(m.group(0))), step_text)
                obj, _ = decoder.raw_decode(clean_step)
                
                tool_calls = obj.get("tool_calls", [])
                for tc in tool_calls:
                    name = tc.get("name")
                    args = tc.get("args") or tc.get("Arguments")
                    if args and "TargetFile" in args and "roles/page.tsx" in args["TargetFile"]:
                        if name == "write_to_file":
                            content = args.get("CodeContent", "")
                            print(f"  -> write_to_file in step {step_num}, content length: {len(content)}")
                        elif name == "replace_file_content":
                            content = args.get("ReplacementContent", "")
                            print(f"  -> replace_file_content in step {step_num}, content length: {len(content)}")
                        elif name == "multi_replace_file_content":
                            chunks = args.get("ReplacementChunks", [])
                            print(f"  -> multi_replace_file_content in step {step_num}, chunks: {len(chunks)}")
            except Exception as e:
                pass
                
    pos = idx + 1

print("Done searching.")
