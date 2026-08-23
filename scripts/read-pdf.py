
import sys
try:
    import pypdf
    reader = pypdf.PdfReader(r"c:\Users\pedro\Desktop\teg-modernizado\Reporte_Julio_2026_TEG.pdf")
    print(f"Total pages: {len(reader.pages)}")
    for i, page in enumerate(reader.pages):
        print(f"--- PAGE {i+1} ---")
        print(page.extract_text()[:2000])
except Exception as e:
    print(f"Error: {e}")
