const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({
            headless: 'new',
            defaultViewport: { width: 1440, height: 900 }
        });
        const page = await browser.newPage();
        await page.goto('http://localhost:3000/admin/reporte-actividades', { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Find and click user dropdown avatar button
        const userBtn = await page.$('button[aria-label="User menu"]') || await page.$('button.rounded-full') || await page.$('#user-menu-button');
        if (userBtn) {
            await userBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        }

        await page.screenshot({ path: 'scripts/version_badge_preview.png', fullPage: false });
        console.log('✅ Screenshot captured at scripts/version_badge_preview.png');
        await browser.close();
    } catch (e) {
        console.error('Screenshot error:', e.message);
    }
})();
