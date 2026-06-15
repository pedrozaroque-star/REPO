import sys

def check_braces(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    stack = []
    lines = content.split('\n')
    
    for i, char in enumerate(content):
        # Determine line number and col
        # Let's count newlines up to i
        line_num = content[:i].count('\n') + 1
        
        if char in '({[':
            stack.append((char, line_num))
        elif char in ')}]':
            if not stack:
                print(f"Extra closing char '{char}' at line {line_num}")
                continue
            top, top_line = stack.pop()
            if (char == ')' and top != '(') or (char == '}' and top != '{') or (char == ']' and top != '['):
                print(f"Mismatched char '{char}' at line {line_num} (matches '{top}' from line {top_line})")

    if stack:
        print(f"Unmatched opening chars at end:")
        for char, line_num in stack:
            print(f"  '{char}' from line {line_num}")

if __name__ == '__main__':
    check_braces(r'c:\Users\pedro\Desktop\teg-modernizado\app\roles\page.tsx')
