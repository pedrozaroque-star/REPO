import re

with open('app/roles/page.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Let's find all tags.
# A tag is either an opening tag <Tag or a closing tag </Tag>
# Self-closing tags end with />

# Let's remove comments first to avoid false matches
text_no_comments = re.sub(r'{\s*/\*.*?\*/\s*}', '', text, flags=re.DOTALL)
text_no_comments = re.sub(r'//.*?\n', '\n', text_no_comments)
text_no_comments = re.sub(r'/\*.*?\*/', '', text_no_comments, flags=re.DOTALL)

# Find all XML/JSX tags.
tag_regex = re.compile(r'</?([a-zA-Z0-9_\.:\-\[\]]+)(?:\s+[^>]*?)?/?>', re.DOTALL)

open_tags = []

# Let's line-index the text so we can report line numbers.
lines = text.split('\n')
line_offsets = []
current_offset = 0
for line in lines:
    line_offsets.append(current_offset)
    current_offset += len(line) + 1 # +1 for newline

def get_line_num(offset):
    # Binary search or simple search
    for i, o in enumerate(line_offsets):
        if o > offset:
            return i
    return len(lines)

# Find matches in text_no_comments, but we need character offsets from original text.
# To keep it simple, let's just find matches in the original text (comments removed might shift offsets, but let's do it on original text since comments are rare).
# Actually, tag_regex matches tags. Let's find them.

for match in re.finditer(r'<(/?[a-zA-Z0-9_\.:\-]+)(\s+[^>]*?)?(/?)>', text):
    tag_name = match.group(1)
    is_closing = tag_name.startswith('/')
    is_self_closing = match.group(3) == '/' or tag_name.lower() in ['input', 'br', 'img', 'hr']
    
    clean_name = tag_name[1:] if is_closing else tag_name
    
    # Skip TypeScript type parameters
    if clean_name in ['string', 'Date', 'any', 'number', 'boolean', 'NodeJS.Timeout', 'string[]', 'Record', 'any[]']:
        continue
    # Skip standard TypeScript generic functions / state definitions
    if re.search(r'useState|useRef|useMemo', text[max(0, match.start()-30):match.start()]):
        continue
        
    line_num = get_line_num(match.start())
    full_match = match.group(0)
    
    if is_closing:
        clean_name = tag_name[1:]
        if open_tags:
            top_tag, top_line, top_match = open_tags[-1]
            if top_tag == clean_name:
                open_tags.pop()
            else:
                # We found a mismatch! Let's report it.
                print(f"Mismatch at line {line_num}: closing </{clean_name}> doesn't match <{top_tag}> from line {top_line}")
                print(f"  Snippet of mismatch: {full_match}")
                print(f"  Snippet of opening: {top_match}")
                print(f"  Open tags stack: {[(t, l) for t, l, _ in open_tags]}")
                # Don't pop to preserve stack
        else:
            print(f"Extra closing tag </{clean_name}> at line {line_num}")
    elif is_self_closing:
        # Ignore self-closing tags
        pass
    else:
        # Opening tag
        open_tags.append((tag_name, line_num, full_match))

print("\n--- Remaining Open Tags at End of File ---")
for tag, line, _ in open_tags:
    print(f"<{tag}> at line {line}")
