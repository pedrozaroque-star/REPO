const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1200 });

    // June Tab 2
    const juneUrl = `file:///${path.resolve('pendientes.html').replace(/\\/g, '/')}`;
    await page.goto(juneUrl, { waitUntil: 'networkidle0' });
    await page.click('label[for="tab-pendientes"]');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/june_tab2_preview.png', clip: { x: 0, y: 0, width: 1300, height: 1100 } });

    // July Tab 2
    const julyUrl = `file:///${path.resolve('pendientes_julio.html').replace(/\\/g, '/')}`;
    await page.goto(julyUrl, { waitUntil: 'networkidle0' });
    await page.click('label[for="tab-pendientes"]');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/july_tab2_preview.png', clip: { x: 0, y: 0, width: 1300, height: 1100 } });

    console.log('✅ June and July Tab 2 screenshots taken!');
    await browser.close();
})();
