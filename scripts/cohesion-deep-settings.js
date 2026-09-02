const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const outputDir = path.join(__dirname, 'cohesion_dump', 'company_deep');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200 });

  console.log('Logging in...');
  await page.goto('https://www.cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' });
  await page.type('#Email, input[name*="Email"], #UserName', 'raquel@tacosgavilan.com');
  await page.type('#Password, input[name*="Password"]', 'Canasta323!');
  const submitBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    submitBtn.click()
  ]);

  const tasks = [
    { name: 'Task1_FinancialSystems', url: 'https://www.cohesion4restaurants.com/CompanySetupCompanyManagement/ProcessCompanySetupTask?CompanyId=1866&TaskId=1' },
    { name: 'Task2_FinancialSettings', url: 'https://www.cohesion4restaurants.com/CompanySetupCompanyManagement/ProcessCompanySetupTask?CompanyId=1866&TaskId=2' },
    { name: 'Task3_SitesAndWorkflows', url: 'https://www.cohesion4restaurants.com/CompanySetupCompanyManagement/ProcessCompanySetupTask?CompanyId=1866&TaskId=3' }
  ];

  for (const task of tasks) {
    console.log(`\nNavigating to ${task.name}...`);
    await page.goto(task.url, { waitUntil: 'networkidle2' });
    await delay(2000);

    const screenshotPath = path.join(outputDir, `${task.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    fs.writeFileSync(path.join(outputDir, `${task.name}.html`), await page.content());

    const pageLinks = await page.$$eval('a', els => els.map(e => ({ text: e.innerText.trim(), href: e.href, id: e.id, class: e.className })));
    fs.writeFileSync(path.join(outputDir, `${task.name}_links.json`), JSON.stringify(pageLinks, null, 2));

    const pageData = await page.evaluate(() => {
      const text = document.body.innerText;
      const tables = Array.from(document.querySelectorAll('table')).map(t => ({
        headers: Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim()),
        rows: Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td, th')).map(td => td.innerText.trim()))
      }));
      const selects = Array.from(document.querySelectorAll('select')).map(s => ({
        id: s.id,
        name: s.name,
        options: Array.from(s.options).map(o => ({ value: o.value, text: o.text, selected: o.selected }))
      }));
      return { text, tables, selects };
    });
    fs.writeFileSync(path.join(outputDir, `${task.name}_data.json`), JSON.stringify(pageData, null, 2));

    // Explore sublinks from this page
    for (const link of pageLinks) {
      if (link.href && link.href.includes('CompanySetup') && !link.href.includes('#') && !link.href.includes('SignOut') && !link.href.includes('ProcessCompanySetupTask')) {
        console.log(`  Visiting sublink: ${link.text} -> ${link.href}`);
        try {
          await page.goto(link.href, { waitUntil: 'networkidle2', timeout: 15000 });
          await delay(1500);
          const safeName = `${task.name}_${(link.text || 'link').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;
          await page.screenshot({ path: path.join(outputDir, `${safeName}.png`), fullPage: true });
          fs.writeFileSync(path.join(outputDir, `${safeName}.html`), await page.content());

          const subData = await page.evaluate(() => ({
            text: document.body.innerText,
            tables: Array.from(document.querySelectorAll('table')).map(t => ({
              headers: Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim()),
              rows: Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td, th')).map(td => td.innerText.trim()))
            })),
            selects: Array.from(document.querySelectorAll('select')).map(s => ({
              id: s.id,
              name: s.name,
              options: Array.from(s.options).map(o => ({ value: o.value, text: o.text, selected: o.selected }))
            }))
          }));
          fs.writeFileSync(path.join(outputDir, `${safeName}.json`), JSON.stringify(subData, null, 2));
        } catch (e) {
          console.log(`  Error on ${link.href}:`, e.message);
        }
      }
    }
  }

  await browser.close();
  console.log('Deep settings crawl completed!');
}

run().catch(console.error);
