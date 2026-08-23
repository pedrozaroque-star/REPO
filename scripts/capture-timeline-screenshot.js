const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 950 });
    const htmlPath = path.resolve('c:/Users/pedro/Desktop/teg-modernizado/reporte_linea_de_tiempo_carlos.html');
    await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    
    const screenshotPath = 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/timeline_chart_preview.png';
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await browser.close();
    console.log('✅ Screenshot guardado en:', screenshotPath);
})();
