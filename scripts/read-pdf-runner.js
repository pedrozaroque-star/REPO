const fs = require('fs');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 EXAMINANDO REPORTE_JULIO_2026_TEG.PDF');
console.log('═══════════════════════════════════════════════════════════════════════');

// Check python tools for pdf extraction
const pyScript = `
import sys
try:
    import pypdf
    reader = pypdf.PdfReader(r"c:\\Users\\pedro\\Desktop\\teg-modernizado\\Reporte_Julio_2026_TEG.pdf")
    print(f"Total pages: {len(reader.pages)}")
    for i, page in enumerate(reader.pages):
        print(f"--- PAGE {i+1} ---")
        print(page.extract_text()[:2000])
except Exception as e:
    print(f"Error: {e}")
`;

fs.writeFileSync('scripts/read-pdf.py', pyScript, 'utf-8');

try {
    const out = execSync('python scripts/read-pdf.py', { encoding: 'utf-8' });
    console.log(out);
} catch (e) {
    console.log('Python run failed, trying alternative:', e.message);
}
