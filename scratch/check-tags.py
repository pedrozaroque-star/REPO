import re

with open('app/roles/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Let's inspect lines 2130 to end of file (0-indexed)
start_line = 2129
end_line = len(lines)

print("Lines to inspect:")
for idx in range(start_line, min(end_line, len(lines))):
    print(f"{idx+1}: {lines[idx].strip()}")

print("\n--- Tag and Bracket Analysis ---")
open_tags = []
open_brackets = [] # stores (char, line_num)

for idx in range(start_line, min(end_line, len(lines))):
    line_num = idx + 1
    line = lines[idx]
    
    # Simple scanner for tags and braces
    i = 0
    while i < len(line):
        char = line[i]
        
        # Track braces and parens
        if char in ['{', '(', '[']:
            open_brackets.append((char, line_num))
        elif char in ['}', ')', ']']:
            if open_brackets:
                matching = {'}': '{', ')': '(', ']': '['}[char]
                top_char, top_line = open_brackets[-1]
                if top_char == matching:
                    open_brackets.pop()
                else:
                    print(f"Mismatched bracket/paren: {char} at line {line_num} doesn't match {top_char} from line {top_line}")
            else:
                print(f"Extra closing bracket/paren: {char} at line {line_num}")
        
        # Track JSX tags
        if char == '<' and i + 1 < len(line):
            # Check if closing tag
            if line[i+1] == '/':
                # find end of tag
                end_idx = line.find('>', i)
                if end_idx != -1:
                    tag_name = line[i+2:end_idx].strip()
                    if open_tags:
                        top_tag, top_line = open_tags[-1]
                        if top_tag == tag_name:
                            open_tags.pop()
                        else:
                            print(f"Mismatched closing tag: </{tag_name}> at line {line_num} doesn't match <{top_tag}> from line {top_line}")
                            print(f"  Current open tags stack: {open_tags}")
                    else:
                        print(f"Extra closing tag: </{tag_name}> at line {line_num}")
                    i = end_idx
            # Check if comment
            elif line[i+1] == '!':
                end_idx = line.find('-->', i)
                if end_idx != -1:
                    i = end_idx + 2
            # Opening tag
            else:
                end_idx = line.find('>', i)
                if end_idx != -1:
                    # check if self-closing
                    if line[end_idx-1] == '/':
                        tag_content = line[i+1:end_idx-1].strip()
                    else:
                        tag_content = line[i+1:end_idx].strip()
                        tag_name = tag_content.split()[0] if tag_content else ""
                        if tag_name and not tag_name.startswith('input') and not tag_name.startswith('br') and not tag_name.startswith('img'):
                            open_tags.append((tag_name, line_num))
                    i = end_idx
        i += 1

print("\nRemaining open brackets/braces:")
for b, l in open_brackets:
    print(f"  {b} from line {l}")

print("\nRemaining open tags:")
for t, l in open_tags:
    print(f"  <{t}> from line {l}")
