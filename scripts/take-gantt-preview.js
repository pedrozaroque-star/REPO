const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1600 });

    const augUrl = `file:///${path.resolve('pendientes_agosto.html').replace(/\\/g, '/')}`;
    await page.goto(augUrl, { waitUntil: 'networkidle0' });

    // Scroll to see days 1, 2, 3, 4, 5, 6, 7
    await page.screenshot({
        path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/august_gantt_exact_shifts_preview.png',
        clip: { x: 0, y: 350, width: 1300, height: 1200 }
    });

    console.log('Captured august_gantt_exact_shifts_preview.png');
    await browser.close();
})();
