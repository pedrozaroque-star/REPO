const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1350, height: 1200 });

    await page.goto('http://localhost:3000/admin/reporte-actividades', { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));

    await page.screenshot({
        path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/admin_reporte_actividades_fixed.png',
        fullPage: false
    });

    console.log('📸 Captured admin_reporte_actividades_fixed.png');
    await browser.close();
})();
