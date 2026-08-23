const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    console.log('📸 Tomando capturas de pantalla de los 3 reportes...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1200 });

    // 1. June preview
    const juneUrl = `file:///${path.resolve('pendientes.html').replace(/\\/g, '/')}`;
    await page.goto(juneUrl, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/june_unified_preview.png', clip: { x: 0, y: 0, width: 1300, height: 1100 } });

    // 2. July preview
    const julyUrl = `file:///${path.resolve('pendientes_julio.html').replace(/\\/g, '/')}`;
    await page.goto(julyUrl, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/july_unified_preview.png', clip: { x: 0, y: 0, width: 1300, height: 1100 } });

    // 3. August preview
    const augustUrl = `file:///${path.resolve('pendientes_agosto.html').replace(/\\/g, '/')}`;
    await page.goto(augustUrl, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/august_unified_preview.png', clip: { x: 0, y: 0, width: 1300, height: 1100 } });

    console.log('✅ Capturas tomadas exitosamente!');
    await browser.close();
})();
