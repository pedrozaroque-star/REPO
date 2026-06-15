import json
import os
import re

log_path = r"C:\Users\pedro\.gemini\antigravity\brain\7f8d96b2-5c80-4156-a707-9b12d85ca4af\.system_generated\logs\transcript.jsonl"

if not os.path.exists(log_path):
    print("Log not found")
    exit(1)

decoder = json.JSONDecoder()

print("Searching transcript.jsonl for the last write or replace for page.tsx...")
with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
    for idx, line in enumerate(f):
        if "roles/page.tsx" not in line:
            continue
            
        try:
            # Clean control characters
            clean_line = re.sub(r'[\x00-\x1f]', lambda m: '\\u{:04x}'.format(ord(m.group(0))), line)
            
            # Use raw_decode to ignore trailing characters
            obj, _ = decoder.raw_decode(clean_line)
            
            step_index = obj.get("step_index")
            tool_calls = obj.get("tool_calls", [])
            for tc in tool_calls:
                name = tc.get("name")
                args = tc.get("args") or tc.get("Arguments")
                if args and "TargetFile" in args and "roles/page.tsx" in args["TargetFile"]:
                    if name == "write_to_file":
                        content = args.get("CodeContent", "")
                        if len(content) > 100000:  # If it's a full file write (100KB+)
                            print(f"Found large write_to_file at step {step_index}, size: {len(content)}")
                            out_path = r"c:\Users\pedro\Desktop\teg-modernizado\app\roles\page.tsx"
                            with open(out_path, "w", encoding="utf-8") as f_out:
                                f_out.write(content)
                            print("Successfully restored page.tsx from step", step_index)
                            exit(0)
        except Exception as e:
            pass

print("No large write_to_file found in transcript.")
