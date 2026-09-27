const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
    await page.goto('file:///' + path.resolve('reports/lynwood-personnel-audit-2026-09-25/informe_ejecutivo.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
    
    const callout = await page.$('.executive-callout');
    if (callout) {
        await callout.screenshot({ path: 'reports/lynwood-personnel-audit-2026-09-25/preview_callout.png' });
    }
    
    const sig = await page.$('.signature-section');
    if (sig) {
        await sig.screenshot({ path: 'reports/lynwood-personnel-audit-2026-09-25/preview_signature.png' });
    }

    // Also screenshot the chronological coverages table
    const tables = await page.$$('.table-wrapper');
    if (tables.length >= 4) {
        await tables[3].screenshot({ path: 'reports/lynwood-personnel-audit-2026-09-25/preview_coverages_table.png' });
    }

    await browser.close();
    console.log('Screenshots generated successfully');
})().catch(e => {
    console.error(e);
    process.exit(1);
});
