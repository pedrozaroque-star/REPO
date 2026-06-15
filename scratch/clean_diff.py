import os

diff_path = r"c:\Users\pedro\Desktop\teg-modernizado\scratch\git_diff_roles_utf8.diff"
out_path = r"c:\Users\pedro\Desktop\teg-modernizado\scratch\git_diff_roles_clean.diff"

if not os.path.exists(diff_path):
    print("Diff file not found")
    exit(1)

content = open(diff_path, 'r', encoding='utf-8').read()

# Character replacements to fix decoding corruptions
replacements = {
    "≡ƒöº": "⚡",
    "≡ƒöö": "🔔",
    "// ⚡": "// 🔧",
    "r├ípidos": "rápidos",
    "est├í": "está",
    "├í": "á",
    "├│": "ó",
    "├║": "ú",
    "├¡": "í",
    "├▒": "ñ",
    "├⌐": "é",
    "ΓåÆ": "→",
    "Γåö": "↔",
    "┬í": "¡",
    "┬┐": "¿",
    "MiΓö£ΓîÉrcoles": "Miércoles",
    "SΓö£├¡bado": "Sábado",
    "SalΓö£Γöén": "Salón",
    "Sal├│n": "Salón",
    "Saln": "Salón",
    "ma├▒ana": "mañana",
    "ΓÇö": "—",
    "SAL├ôN": "SALÓN",
    "ΓÿÇ∩╕Å": "☀️",
    "≡ƒîÖ": "🌙",
    "ΓÜí": "⚡",
    "≡ƒîà": "🌄",
    "ΓÜÖ∩╕Å": "⚙️",
    "CategorΓö£¡a": "Categoría",
    "CategorΓö£Γò£a": "Categoría",
    "librerΓö£¡a": "librería",
    "LibrerΓö£¡a": "Librería",
    "Catalog_activities": "catalog_activities",
    "no_catalog_activities": "no_catalog_activities",
    "ΓùÅ": "📍"
}

for corrupted, corrected in replacements.items():
    content = content.replace(corrupted, corrected)

open(out_path, 'w', encoding='utf-8').write(content)
print("Saved cleaned diff to", out_path)
