const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const outputDir = path.join(__dirname, 'cohesion_dump');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const networkLogs = [];

  page.on('response', async (response) => {
    try {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()['content-type'] || '';
      
      if (url.includes('cohesion4restaurants.com') && (contentType.includes('json') || contentType.includes('html') || contentType.includes('javascript') || contentType.includes('text'))) {
        let body = '';
        try {
          if (contentType.includes('json')) {
            body = await response.json();
          } else if (contentType.includes('text') || contentType.includes('html')) {
            // body = await response.text();
          }
        } catch (e) {}

        networkLogs.push({
          url,
          status,
          contentType,
          body: typeof body === 'object' ? body : undefined
        });
      }
    } catch (e) {}
  });

  console.log('1. Logging in...');
  await page.goto('https://www.cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' });
  
  await page.type('#Email, input[name*="Email"], #UserName', 'raquel@tacosgavilan.com');
  await page.type('#Password, input[name*="Password"]', 'Canasta323!');
  
  const submitBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    submitBtn.click()
  ]);

  console.log('Logged in successfully. Current URL:', page.url());

  const pagesToVisit = [
    { name: 'Dashboard', url: 'https://www.cohesion4restaurants.com/Dashboard/Main' },
    { name: 'Sales_Workflows', url: 'https://www.cohesion4restaurants.com/MyWorkflowsSales/Main' },
    { name: 'Companies', url: 'https://www.cohesion4restaurants.com/CompanySetup/Main' },
    { name: 'Users', url: 'https://www.cohesion4restaurants.com/Users/Main' },
    { name: 'Subscriptions', url: 'https://www.cohesion4restaurants.com/Subscriptions/Main' },
    { name: 'Downloads', url: 'https://www.cohesion4restaurants.com/Downloads/Main' },
    { name: 'Help', url: 'https://www.cohesion4restaurants.com/Help/Main' }
  ];

  const pageData = {};

  for (const item of pagesToVisit) {
    console.log(`\nNavigating to ${item.name} (${item.url})...`);
    await page.goto(item.url, { waitUntil: 'networkidle2' });
    await delay(2000);

    const screenshotPath = path.join(outputDir, `${item.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const htmlContent = await page.content();
    fs.writeFileSync(path.join(outputDir, `${item.name}.html`), htmlContent);

    // Extract interactive elements, tables, forms, buttons, links
    const extracted = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.innerText.trim(),
        href: a.href,
        id: a.id,
        className: a.className,
        onclick: a.getAttribute('onclick')
      })).filter(l => l.text || l.href);

      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).map(b => ({
        text: b.innerText || b.value || '',
        id: b.id,
        className: b.className,
        type: b.type
      }));

      const selects = Array.from(document.querySelectorAll('select')).map(s => ({
        id: s.id,
        name: s.name,
        options: Array.from(s.options).map(o => ({ value: o.value, text: o.text, selected: o.selected }))
      }));

      const tables = Array.from(document.querySelectorAll('table')).map(t => {
        const headers = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim());
        const rows = Array.from(t.querySelectorAll('tbody tr')).map(tr => 
          Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())
        );
        return { headers, rowsCount: rows.length, sampleRows: rows.slice(0, 10) };
      });

      const bodyText = document.body.innerText;

      return { links, buttons, selects, tables, textSnippet: bodyText.slice(0, 2000) };
    });

    pageData[item.name] = extracted;
    console.log(`Extracted info for ${item.name}: ${extracted.tables.length} tables, ${extracted.selects.length} selects, ${extracted.links.length} links.`);
  }

  fs.writeFileSync(path.join(outputDir, 'page_data_summary.json'), JSON.stringify(pageData, null, 2));
  fs.writeFileSync(path.join(outputDir, 'network_logs.json'), JSON.stringify(networkLogs, null, 2));

  // Now let's explore deep subpages found in Companies, Sales, and Downloads!
  console.log('\n--- Deep Exploring Sub-links ---');
  // Look at all extracted links across pages
  const allSublinks = [];
  for (const [pName, pInfo] of Object.entries(pageData)) {
    for (const link of pInfo.links) {
      if (link.href && link.href.includes('cohesion4restaurants.com') && 
          !link.href.includes('SignOut') && 
          !link.href.includes('ChangeMyPassword') && 
          !pagesToVisit.some(p => p.url === link.href) &&
          !allSublinks.some(s => s.href === link.href)) {
        allSublinks.push({ from: pName, ...link });
      }
    }
  }

  console.log(`Found ${allSublinks.length} sublinks to explore.`);
  fs.writeFileSync(path.join(outputDir, 'sublinks_to_explore.json'), JSON.stringify(allSublinks, null, 2));

  await browser.close();
  console.log('Deep crawl completed!');
}

run().catch(console.error);
