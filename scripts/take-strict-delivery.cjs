const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  try {
    page.on('requestfailed', request => {
      console.log(`REQUEST FAILED: ${request.url()} - ${request.failure()?.errorText}`);
    });
    page.on('response', res => {
      console.log(`RESPONSE: ${res.status()} ${res.url()}`);
    });
    await page.goto('http://localhost:3000/admin/blindaje-delivery/empaque', { waitUntil: 'load', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));

    // Type 4571 (Veronica Osorio)
    const clickDigit = async (d) => {
      const buttons = await page.$$('button');
      for (const b of buttons) {
        const text = await (await b.getProperty('textContent')).jsonValue();
        if (text.trim() === d) {
          await b.click();
          break;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    };

    await clickDigit('4');
    await clickDigit('5');
    await clickDigit('7');
    await clickDigit('1');

    const buttons = await page.$$('button');
    for (const b of buttons) {
      const text = await (await b.getProperty('textContent')).jsonValue();
      if (text.includes('Confirmar PIN')) {
        await b.click();
        break;
      }
    }

    await new Promise(r => setTimeout(r, 3500));
    await page.screenshot({ path: 'C:/Users/pedro/Desktop/blindaje_delivery_strict_delivery.png', fullPage: false });
    console.log('STRICT_DELIVERY_SAVED');
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await browser.close();
  }
})();
