const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('🚀 RECOMPILANDO REPORTES EJECUTIVOS Y PDFS DE AGOSTO 2026');
    console.log('═══════════════════════════════════════════════════════════════════════');

    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1800 });

    const htmlPath = path.resolve('pendientes_agosto.html');
    const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
    console.log('Cargando HTML:', fileUrl);

    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    // 1. Compile Reporte_Agosto_2026_TEG.pdf
    const pdfMainPath = 'c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf';
    await page.pdf({
        path: pdfMainPath,
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });
    console.log('✅ PDF Principal generado:', pdfMainPath);

    // 2. Screenshot of Tab 1 (Reporte Mensual)
    const screenshotTab1 = 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/tab1_actualizado_preview.png';
    await page.screenshot({ path: screenshotTab1, fullPage: false });
    console.log('📸 Screenshot Tab 1 guardado en:', screenshotTab1);

    // 3. Click Tab 2 and screenshot
    const tab2Label = await page.$('label[for="tab-pendientes"]');
    if (tab2Label) {
        await tab2Label.click();
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 600)));
        const screenshotTab2 = 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/tab2_actualizado_preview.png';
        await page.screenshot({ path: screenshotTab2, fullPage: false });
        console.log('📸 Screenshot Tab 2 guardado en:', screenshotTab2);
    }

    await browser.close();
    console.log('🎉 Recompilación completada con éxito.');
})();
