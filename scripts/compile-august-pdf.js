const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    console.log('🚀 Compilando Reporte Completo de Agosto 2026 en PDF...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1800 });

    const htmlPath = path.resolve('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html');
    const pdfPath = path.resolve('c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf');

    await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    await page.addStyleTag({
        content: `
            .tab-content-pendientes, .tab-content-reporte { display: block !important; }
            .tabs-nav, .print-section { display: none !important; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        `
    });

    await page.pdf({
        path: pdfPath,
        format: 'Letter',
        printBackground: true,
        scale: 0.85,
        margin: {
            top: '0.35in',
            right: '0.35in',
            bottom: '0.35in',
            left: '0.35in'
        }
    });

    await browser.close();
    console.log('🎉 Reporte Completo de Agosto compilado en Desktop: ' + pdfPath);
})();
