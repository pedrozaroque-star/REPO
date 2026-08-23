import sys
import pypdf

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

pdf_path = r"c:\Users\pedro\Desktop\teg-modernizado\Reporte_Julio_2026_TEG.pdf"
reader = pypdf.PdfReader(pdf_path)

print(f"================ TOTAL PAGES: {len(reader.pages)} ================")

with open("scripts/extracted_july_pdf_text.txt", "w", encoding="utf-8") as f:
    for i, page in enumerate(reader.pages):
        header = f"\n\n=================== PAGE {i+1} ===================\n"
        f.write(header)
        text = page.extract_text() or ""
        f.write(text)

print("Saved full text extraction to scripts/extracted_july_pdf_text.txt")
