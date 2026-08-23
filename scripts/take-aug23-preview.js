const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1600 });

    const augUrl = `file:///${path.resolve('pendientes_agosto.html').replace(/\\/g, '/')}`;
    await page.goto(augUrl, { waitUntil: 'networkidle0' });

    // Scroll to see August 21, 22, 23
    await page.screenshot({
        path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/august_23_fixed_preview.png',
        clip: { x: 0, y: 1500, width: 1300, height: 750 }
    });

    console.log('Captured august_23_fixed_preview.png');
    await browser.close();
})();
