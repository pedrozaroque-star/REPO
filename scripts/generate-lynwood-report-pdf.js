/**
 * @module generate-lynwood-report-pdf
 * @description Compila el informe operativo de gestión de personal y coberturas de Lynwood
 * desde Markdown a un documento PDF ejecutivo de alta calidad utilizando Puppeteer.
 * @businessRules
 * - Cumple con el formato corporativo oficial de Tacos Gavilan.
 * - Sin números de tienda ni referencias a auditorías.
 * - Incluye las 4 bajas del 24 de septiembre y el benchmark de 15 sucursales.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { micromark } = require('micromark');
const { gfm, gfmHtml } = require('micromark-extension-gfm');

async function generatePDF() {
    const mdPath = path.resolve('reports/lynwood-personnel-audit-2026-09-25/informe-operativo-gestion-lynwood.md');
    const outPdfPath = path.resolve('reports/lynwood-personnel-audit-2026-09-25/Informe_Operativo_Gestion_Lynwood_2026.pdf');
    const desktopPdfPath = path.resolve('C:/Users/pedro/Desktop/Informe_Operativo_Gestion_Lynwood_2026.pdf');
    const htmlPath = path.resolve('reports/lynwood-personnel-audit-2026-09-25/informe_ejecutivo.html');

    if (!fs.existsSync(mdPath)) {
        console.error('❌ Archivo markdown no encontrado en:', mdPath);
        process.exit(1);
    }

    const mdContent = fs.readFileSync(mdPath, 'utf8');

    // Split at the metadata horizontal rule to handle header specially
    const parts = mdContent.split(/\n---\s*\n/);
    const rawHeader = parts[0];
    const rawBody = parts.slice(1).join('\n---\n');

    // Convert body markdown to clean HTML
    let bodyHtml = micromark(rawBody, {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()]
    });

    // 1. Highlight Lynwood row in tables
    bodyHtml = bodyHtml.replace(
        /<tr>\s*<td align="center"><strong>🥈 2<\/strong><\/td>\s*<td align="left"><strong>Lynwood<\/strong><\/td>/g,
        '<tr class="row-highlight-lynwood"><td align="center"><strong>🥈 2</strong></td><td align="left"><strong>Lynwood (Sucursal)</strong></td>'
    );

    // 2. Wrap tables in responsive containers
    bodyHtml = bodyHtml.replace(/<table>/g, '<div class="table-wrapper"><table>');
    bodyHtml = bodyHtml.replace(/<\/table>/g, '</table></div>');

    // 3. Style blockquotes as executive callouts
    bodyHtml = bodyHtml.replace(/<blockquote>/g, '<div class="executive-callout">');
    bodyHtml = bodyHtml.replace(/<\/blockquote>/g, '</div>');

    // 4. Unescape <br> tags inside tables and text
    bodyHtml = bodyHtml.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

    // 5. Remove the trailing signature markdown text since we have a dedicated signature block
    bodyHtml = bodyHtml.replace(/<p><strong>Carlos Velázquez<\/strong><br \/>\s*Gerente General.*<\/p>/s, '');

    // Full HTML document with executive print styling
    const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Informe Operativo - Tacos Gavilan Sucursal Lynwood</title>
    <style>
        @page {
            size: letter;
            margin: 20mm 14mm 20mm 14mm;
        }

        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 9.5pt;
            line-height: 1.5;
            color: #1e293b;
            background-color: #ffffff;
            margin: 0;
            padding: 0;
        }

        /* ═══ CORPORATE BRAND HEADER ═══ */
        .brand-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 3.5px solid #8b0000;
            padding-bottom: 12px;
            margin-bottom: 16px;
        }

        .brand-title-wrap {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .brand-logo-text {
            font-size: 26pt;
            font-weight: 900;
            letter-spacing: -0.5px;
            color: #8b0000;
            text-transform: uppercase;
            line-height: 1;
        }

        .brand-sublogo {
            font-size: 8.5pt;
            font-weight: 700;
            letter-spacing: 2px;
            color: #475569;
            text-transform: uppercase;
            margin-top: 4px;
        }

        .document-tag {
            background-color: #f8fafc;
            border: 1px solid #cbd5e1;
            border-left: 4px solid #8b0000;
            padding: 8px 14px;
            border-radius: 4px;
            text-align: right;
        }

        .document-tag-title {
            font-size: 8.5pt;
            font-weight: 800;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .document-tag-sub {
            font-size: 7.5pt;
            color: #64748b;
        }

        /* ═══ DOCUMENT TITLE & METADATA GRID ═══ */
        .main-report-title {
            font-size: 15pt;
            font-weight: 900;
            color: #0f172a;
            line-height: 1.3;
            margin: 0 0 14px 0;
            text-transform: uppercase;
            letter-spacing: -0.3px;
        }

        .metadata-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 12px 14px;
            margin-bottom: 16px;
            page-break-inside: avoid;
        }

        .metadata-item {
            display: flex;
            flex-direction: column;
        }

        .metadata-lbl {
            font-size: 7pt;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #64748b;
            margin-bottom: 2px;
        }

        .metadata-val {
            font-size: 8.5pt;
            color: #1e293b;
            font-weight: 500;
        }

        .metadata-val strong {
            color: #0f172a;
        }

        /* ═══ EXECUTIVE KPI SUMMARY CARDS ═══ */
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-bottom: 20px;
            page-break-inside: avoid;
        }

        .kpi-card {
            background-color: #ffffff;
            border: 1.5px solid #e2e8f0;
            border-radius: 6px;
            padding: 10px 12px;
            text-align: center;
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
        }

        .kpi-card.highlight {
            background-color: #fef2f2;
            border-color: #fca5a5;
        }

        .kpi-value {
            font-size: 16pt;
            font-weight: 900;
            color: #8b0000;
            line-height: 1.1;
            margin-bottom: 4px;
        }

        .kpi-label {
            font-size: 7.5pt;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #334155;
        }

        .kpi-note {
            font-size: 7pt;
            color: #64748b;
            margin-top: 2px;
        }

        /* ═══ TYPOGRAPHY ═══ */
        h2 {
            font-size: 12pt;
            font-weight: 800;
            color: #8b0000;
            margin: 20px 0 10px 0;
            padding-bottom: 4px;
            border-bottom: 1.5px solid #fecaca;
            page-break-after: avoid;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        h3 {
            font-size: 10pt;
            font-weight: 700;
            color: #0f172a;
            margin: 14px 0 6px 0;
            page-break-after: avoid;
        }

        p {
            margin: 0 0 10px 0;
            color: #334155;
            text-align: justify;
        }

        ul, ol {
            margin: 0 0 12px 0;
            padding-left: 20px;
            color: #334155;
        }

        li {
            margin-bottom: 4px;
        }

        strong {
            color: #0f172a;
            font-weight: 700;
        }

        em {
            color: #475569;
            font-style: italic;
        }

        hr {
            border: none;
            border-top: 1px solid #e2e8f0;
            margin: 18px 0;
        }

        /* ═══ TABLES ═══ */
        .table-wrapper {
            margin: 12px 0 16px 0;
            width: 100%;
            page-break-inside: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8pt;
            page-break-inside: auto;
        }

        thead {
            display: table-header-group;
        }

        tr {
            page-break-inside: avoid;
            page-break-after: auto;
        }

        th {
            background-color: #1e293b;
            color: #ffffff;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 7.5pt;
            letter-spacing: 0.5px;
            padding: 6px 5px;
            border: 1px solid #0f172a;
            text-align: center;
        }

        th[align="left"], td[align="left"] {
            text-align: left;
        }

        th[align="right"], td[align="right"] {
            text-align: right;
            white-space: nowrap;
        }

        td {
            padding: 5.5px 5px;
            border: 1px solid #cbd5e1;
            color: #334155;
            line-height: 1.35;
        }

        tbody tr:nth-child(even) {
            background-color: #f8fafc;
        }

        /* Highlight Lynwood Row */
        tr.row-highlight-lynwood {
            background-color: #fef2f2 !important;
            border: 2px solid #8b0000;
            font-weight: 700;
        }

        tr.row-highlight-lynwood td {
            color: #8b0000;
            font-weight: 700;
            background-color: #fef2f2;
        }

        /* ═══ EXECUTIVE CALLOUT ═══ */
        .executive-callout {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-left: 4px solid #8b0000;
            border-radius: 4px;
            padding: 10px 14px;
            margin: 14px 0;
            font-size: 8.5pt;
            color: #334155;
            page-break-inside: avoid;
        }

        .executive-callout p {
            margin: 0;
            line-height: 1.45;
        }

        /* ═══ SIGNATURE BLOCK ═══ */
        .signature-section {
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1.5px solid #cbd5e1;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            page-break-inside: avoid;
        }

        .signature-box {
            width: 320px;
        }

        .signature-line {
            border-bottom: 1.5px solid #0f172a;
            height: 40px;
            margin-bottom: 6px;
        }

        .signee-name {
            font-size: 11pt;
            font-weight: 800;
            color: #0f172a;
        }

        .signee-title {
            font-size: 9pt;
            color: #475569;
            font-weight: 600;
        }

        .signee-dept {
            font-size: 8pt;
            color: #64748b;
        }

        .seal-box {
            border: 1.5px dashed #94a3b8;
            border-radius: 6px;
            padding: 10px 16px;
            text-align: center;
            width: 220px;
            background-color: #f8fafc;
        }

        .seal-title {
            font-size: 8pt;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #64748b;
        }

        .seal-badge {
            font-size: 9.5pt;
            font-weight: 800;
            color: #8b0000;
            margin-top: 4px;
        }

        .seal-date {
            font-size: 7.5pt;
            color: #94a3b8;
            margin-top: 2px;
        }
    </style>
</head>
<body>

    <!-- BRAND HEADER -->
    <div class="brand-header">
        <div>
            <div class="brand-logo-text">Tacos Gavilan</div>
            <div class="brand-sublogo">Sucursal Lynwood &bull; Operaciones Corporativas</div>
        </div>
        <div class="document-tag">
            <div class="document-tag-title">Informe Ejecutivo Operativo</div>
            <div class="document-tag-sub">Período Enero – Septiembre 2026</div>
        </div>
    </div>

    <!-- DOCUMENT TITLE -->
    <div class="main-report-title">
        Informe Operativo: Gestión de Personal, Coberturas Mutuas y Productividad en Ventas Pico (<em>Peak Sales</em>)
    </div>

    <!-- EXECUTIVE METADATA GRID -->
    <div class="metadata-grid">
        <div class="metadata-item">
            <div class="metadata-lbl">Período de Análisis</div>
            <div class="metadata-val">01 Ene – 24 Sep 2026 <em>(Comp. 2023–2025)</em></div>
        </div>
        <div class="metadata-item">
            <div class="metadata-lbl">Titular Responsable</div>
            <div class="metadata-val"><strong>Carlos Velázquez</strong>, Gerente General (<em>GM</em>)</div>
        </div>
        <div class="metadata-item">
            <div class="metadata-lbl">Destinatarios</div>
            <div class="metadata-val">Dirección Ejecutiva, Operaciones y RRHH</div>
        </div>
        <div class="metadata-item">
            <div class="metadata-lbl">Fecha de Emisión</div>
            <div class="metadata-val"><strong>25 de Septiembre de 2026</strong></div>
        </div>
        <div class="metadata-item">
            <div class="metadata-lbl">Fuentes de Datos</div>
            <div class="metadata-val">Toast POS, Supabase DB, RONOS & Simplify HR</div>
        </div>
        <div class="metadata-item">
            <div class="metadata-lbl">Sede Operativa</div>
            <div class="metadata-val"><strong>Tacos Gavilan — Sucursal Lynwood</strong></div>
        </div>
    </div>

    <!-- KPI HIGHLIGHTS BAR -->
    <div class="kpi-grid">
        <div class="kpi-card highlight">
            <div class="kpi-value">$4,102,321</div>
            <div class="kpi-label">Ventas Ene–Ago</div>
            <div class="kpi-note">🥈 2° Lugar en Toda la Cadena</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value">19.5%</div>
            <div class="kpi-label">Costo Laboral (Labor %)</div>
            <div class="kpi-note">Supera Promedio Cadena (20.1%)</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value">$100.1 / hr</div>
            <div class="kpi-label">Productividad (SPLH)</div>
            <div class="kpi-note">Venta Neta por Hora Labor</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value">100%</div>
            <div class="kpi-label">Continuidad Operativa</div>
            <div class="kpi-note">Cero Interrupciones de Servicio</div>
        </div>
    </div>

    <!-- MAIN REPORT CONTENT -->
    <div class="report-content">
        ${bodyHtml}
    </div>

    <!-- FORMAL SIGNATURE SECTION -->
    <div class="signature-section">
        <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signee-name">Carlos Velázquez</div>
            <div class="signee-title">Gerente General (<em>General Manager</em>)</div>
            <div class="signee-dept">Tacos Gavilan — Sucursal Lynwood</div>
        </div>
        <div class="seal-box">
            <div class="seal-title">Dictamen Operativo</div>
            <div class="seal-badge">OFICIAL Y CONCLUIDO</div>
            <div class="seal-date">Emisión: 25 de Septiembre de 2026</div>
        </div>
    </div>

</body>
</html>`;

    // Save full HTML file
    fs.writeFileSync(htmlPath, fullHtml, 'utf8');
    console.log('📄 Archivo HTML completo guardado en:', htmlPath);

    console.log('🚀 Iniciando Puppeteer...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });

    console.log('📄 Renderizando contenido HTML...');
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

    // Wait for fonts to be ready
    await page.evaluate(() => document.fonts.ready);

    console.log('🖨️ Generando PDF con encabezado y pie de página corporativos...');
    const pdfBuffer = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: {
            top: '20mm',
            bottom: '20mm',
            left: '12mm',
            right: '12mm'
        },
        displayHeaderFooter: true,
        headerTemplate: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 7.5pt; color: #64748b; width: 100%; display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin: 0 12mm;">
                <span style="font-weight: 800; color: #8b0000; letter-spacing: 0.5px;">TACOS GAVILAN &bull; SUCURSAL LYNWOOD</span>
                <span>INFORME OPERATIVO: GESTIÓN DE PERSONAL Y COBERTURAS 2026</span>
            </div>
        `,
        footerTemplate: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 7.5pt; color: #64748b; width: 100%; display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 4px; margin: 0 12mm;">
                <span style="font-weight: 600;">CONFIDENCIAL &bull; DIRECCIÓN EJECUTIVA & RECURSOS HUMANOS</span>
                <span>Carlos Velázquez &bull; General Manager</span>
                <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
            </div>
        `
    });

    fs.writeFileSync(outPdfPath, pdfBuffer);
    console.log('✅ PDF generado con éxito en:', outPdfPath);

    // Also copy to desktop for instant user access
    try {
        fs.writeFileSync(desktopPdfPath, pdfBuffer);
        console.log('📋 Copia adicional guardada en Escritorio:', desktopPdfPath);
    } catch (e) {
        console.warn('⚠️ No se pudo copiar al Escritorio:', e.message);
    }

    // Capture preview screenshot of first page for quality verification
    const previewPngPath = path.resolve('reports/lynwood-personnel-audit-2026-09-25/preview_page1.png');
    await page.screenshot({ path: previewPngPath, fullPage: false });
    console.log('🖼️ Captura de vista previa guardada en:', previewPngPath);

    await browser.close();
    console.log('🎉 Proceso de generación concluido satisfactoriamente.');
}

generatePDF().catch(err => {
    console.error('❌ Error generando PDF:', err);
    process.exit(1);
});
