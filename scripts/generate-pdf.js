/**
 * @module generate-pdf
 * @description Convierte pendientes_julio.html a PDF con Puppeteer.
 * Ajusta viewport, escala y CSS para que todo el contenido quepa
 * perfectamente en papel Letter sin cortes ni desbordes.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
    const htmlPath = path.resolve('c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html');
    const pdfPath = path.resolve('c:/Users/pedro/Desktop/teg-modernizado/Reporte_Julio_2026_TEG.pdf');
    const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;

    console.log('🚀 Iniciando Puppeteer...');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Viewport of ~800px matches Letter paper width better
    await page.setViewport({ width: 800, height: 1100 });

    console.log('📄 Cargando HTML...');
    await page.goto(fileUrl, { 
        waitUntil: 'networkidle0',
        timeout: 30000
    });

    // Wait for Google Fonts to fully load
    await page.evaluate(() => document.fonts.ready);
    console.log('✅ Fuentes cargadas');

    // Inject comprehensive print CSS overrides
    await page.addStyleTag({
        content: `
            /* ═══ FORCE BOTH SECTIONS VISIBLE ═══ */
            .tab-content-pendientes,
            .tab-content-reporte {
                display: block !important;
            }

            /* Hide navigation controls */
            .tabs-nav,
            .print-section {
                display: none !important;
            }

            /* ═══ FORCE ALL COLORS TO PRINT ═══ */
            * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }

            /* ═══ PAGE LAYOUT ═══ */
            body {
                padding: 0 !important;
                margin: 0 !important;
            }

            .tasks-container {
                padding: 16px !important;
                max-width: 100% !important;
            }

            /* ═══ VISUAL SEPARATOR BETWEEN SECTIONS ═══ */
            .tab-content-reporte {
                margin-top: 30px;
                padding-top: 30px;
                border-top: 4px solid #e05638;
            }

            /* ═══ STATS GRID: 5 cols that fit ═══ */
            .stats-grid {
                grid-template-columns: repeat(5, 1fr) !important;
                gap: 8px !important;
            }

            .stat-card {
                padding: 10px !important;
            }

            .stat-number {
                font-size: 20px !important;
            }

            .stat-label {
                font-size: 9px !important;
            }

            /* ═══ CARDS GRID: 2 columns ═══ */
            .cards-grid {
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 10px !important;
            }

            /* Prevent cards from splitting across pages */
            .task-card {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
                margin-bottom: 10px !important;
                padding: 12px !important;
                font-size: 12px !important;
            }

            .card-title {
                font-size: 13px !important;
            }

            .card-desc {
                font-size: 11px !important;
            }

            /* Section headers stay with content */
            .section-header {
                break-after: avoid !important;
                page-break-after: avoid !important;
            }

            /* ═══ TABLE: FORCE FIT WITHIN PAGE ═══ */
            .report-table-wrapper {
                max-width: 100% !important;
                overflow: hidden !important;
            }

            .report-table {
                width: 100% !important;
                table-layout: fixed !important;
                font-size: 10px !important;
            }

            /* Column widths that work for Letter paper */
            .report-table th:nth-child(1),
            .report-table td:nth-child(1) {
                width: 12% !important;  /* Fecha */
            }

            .report-table th:nth-child(2),
            .report-table td:nth-child(2) {
                width: 15% !important;  /* Horario */
            }

            .report-table th:nth-child(3),
            .report-table td:nth-child(3) {
                width: 6% !important;   /* Horas */
                text-align: center !important;
            }

            .report-table th:nth-child(4),
            .report-table td:nth-child(4) {
                width: 15% !important;  /* Módulo */
            }

            .report-table th:nth-child(5),
            .report-table td:nth-child(5) {
                width: 52% !important;  /* Descripción */
                word-wrap: break-word !important;
                overflow-wrap: break-word !important;
                white-space: normal !important;
            }

            /* Prevent table rows from splitting */
            .report-table tr {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
            }

            .report-table td {
                padding: 6px 4px !important;
                vertical-align: top !important;
                word-wrap: break-word !important;
                overflow-wrap: break-word !important;
            }

            .report-table th {
                padding: 8px 4px !important;
                font-size: 10px !important;
            }

            /* Module badges inside table */
            .module-badge {
                font-size: 8px !important;
                padding: 2px 4px !important;
                margin: 1px !important;
            }

            /* Hours badge */
            .hours-badge-large {
                font-size: 14px !important;
            }
        `
    });

    console.log('🎨 Estilos PDF inyectados');

    // Let CSS re-render
    await new Promise(resolve => setTimeout(resolve, 800));

    console.log('📝 Generando PDF...');
    await page.pdf({
        path: pdfPath,
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: {
            top: '0.35in',
            right: '0.35in',
            bottom: '0.35in',
            left: '0.35in'
        },
        displayHeaderFooter: false,
        preferCSSPageSize: false
    });

    await browser.close();

    const stats = fs.statSync(pdfPath);
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('✅ ¡PDF generado exitosamente!');
    console.log('📄 Archivo: ' + pdfPath);
    console.log('📏 Tamaño: ' + (stats.size / 1024).toFixed(1) + ' KB');
    console.log('═══════════════════════════════════════════');
})();
