import re
import sys

def trace_jsx(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # We want to trace JSX tags starting from line 1661 (1-indexed, so index 1660)
    start_line = 1661
    stack = []
    
    # Simple regex to find tags
    # Let's search for tags: <tag, </tag>, or self-closing <tag ... />
    # We also need to be careful with JavaScript expressions inside JSX (braces { ... })
    # and strings.
    
    # A simplified tag scanner
    tag_pattern = re.compile(r'</?([a-zA-Z0-9\.]+)(?:\s+[^>]*?)?/?>')
    
    print("Starting trace from line 1661...")
    
    brace_level = 0
    for idx in range(start_line - 1, len(lines)):
        line_num = idx + 1
        line = lines[idx]
        
        # Track braces to know if we are inside JS expressions
        # (though this is extremely simplified, we can count '{' and '}')
        for char in line:
            if char == '{':
                brace_level += 1
            elif char == '}':
                brace_level -= 1
        
        # Let's find tags on this line
        # We find matches of the pattern
        matches = list(re.finditer(r'<(/?[a-zA-Z0-9\:\-\.]+)(?:\s+[^>]*?)?(/?)>', line))
        for match in matches:
            tag_name = match.group(1)
            is_closing = tag_name.startswith('/')
            is_self_closing = match.group(2) == '/' or tag_name in ['input', 'img', 'br', 'hr']
            
            if is_closing:
                clean_name = tag_name[1:]
                if not stack:
                    print(f"[{line_num}]: Error: Closing tag </{clean_name}> with empty stack! Line: {line.strip()}")
                else:
                    top_name, top_line = stack.pop()
                    if top_name != clean_name:
                        print(f"[{line_num}]: Warning: Closing tag </{clean_name}> does not match opening tag <{top_name}> opened at line {top_line}. Line: {line.strip()}")
            elif is_self_closing:
                # Self closing tag, do nothing
                pass
            else:
                # Opening tag
                stack.append((tag_name, line_num))
                
        # Optional: print stack state at some lines if debug needed
        if line_num in [1662, 3055, 3212, 3252, 3253, 3254, 3255]:
            print(f"Line {line_num} stack: {[t[0] for t in stack]}")

    print("\nFinal stack:")
    for tag_name, line_num in stack:
        print(f"<{tag_name}> opened at line {line_num} never closed")

if __name__ == '__main__':
    trace_jsx('app/roles/page.tsx')
