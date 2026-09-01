const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📄 GENERANDO LOS 3 PDFS EJECUTIVOS EN EL ESCRITORIO DE CARLOS');
console.log('═══════════════════════════════════════════════════════════════════════');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1200 });

    // 1. JUNIO
    console.log('Generando Reporte_Junio_2026_TEG.pdf...');
    const juneUrl = `file:///${path.resolve('pendientes.html').replace(/\\/g, '/')}`;
    await page.goto(juneUrl, { waitUntil: 'networkidle0' });
    await page.pdf({
        path: 'c:/Users/pedro/Desktop/Reporte_Junio_2026_TEG.pdf',
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    // 2. JULIO
    console.log('Generando Reporte_Julio_2026_TEG.pdf...');
    const julyUrl = `file:///${path.resolve('pendientes_julio.html').replace(/\\/g, '/')}`;
    await page.goto(julyUrl, { waitUntil: 'networkidle0' });
    await page.pdf({
        path: 'c:/Users/pedro/Desktop/Reporte_Julio_2026_TEG.pdf',
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    // 3. AGOSTO
    console.log('Generando Reporte_Agosto_2026_TEG.pdf...');
    const augUrl = `file:///${path.resolve('pendientes_agosto.html').replace(/\\/g, '/')}`;
    await page.goto(augUrl, { waitUntil: 'networkidle0' });
    await page.pdf({
        path: 'c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf',
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    // 4. SEPTIEMBRE
    console.log('Generando Reporte_Septiembre_2026_TEG.pdf...');
    const sepUrl = `file:///${path.resolve('pendientes_septiembre.html').replace(/\\/g, '/')}`;
    await page.goto(sepUrl, { waitUntil: 'networkidle0' });
    await page.pdf({
        path: 'c:/Users/pedro/Desktop/Reporte_Septiembre_2026_TEG.pdf',
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    console.log('🎉 Los 4 PDFs ejecutivos fueron generados exitosamente en el Escritorio!');
    await browser.close();
})();
