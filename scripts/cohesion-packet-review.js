const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const outputDir = path.join(__dirname, 'cohesion_dump', 'details');
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

  console.log('Navigating to Sales Workflows...');
  await page.goto('https://www.cohesion4restaurants.com/MyWorkflowsSales/Main', { waitUntil: 'networkidle2' });
  await delay(2000);

  // Let's click or navigate to a published PacketReview
  // E.g., packet 2364967
  console.log('Navigating to PacketReview 2364967 (Published packet)...');
  const packetUrl = 'https://www.cohesion4restaurants.com/MyWorkflows/PacketReview?ViewIndexType=SevenPackets&PageOffset=0&PacketOffset=0&IncludeCurrentPackets=False&GroupCount=1&IsActiveTab=True&PacketGroupViewTypeTitle=Multi-Period%20View&IsLoading=False&SiteId=2248&PacketId=2364967&PacketType=SalesOnly&PacketStatus=Published';
  await page.goto(packetUrl, { waitUntil: 'networkidle2' });
  await delay(3000);

  await page.screenshot({ path: path.join(outputDir, 'packet_2364967_published.png'), fullPage: true });
  fs.writeFileSync(path.join(outputDir, 'packet_2364967_published.html'), await page.content());

  // Extract packet review details
  const packetData = await page.evaluate(() => {
    const text = document.body.innerText;
    const tables = Array.from(document.querySelectorAll('table')).map(t => {
      const headers = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim());
      const rows = Array.from(t.querySelectorAll('tr')).map(tr => 
        Array.from(tr.querySelectorAll('td, th')).map(td => td.innerText.trim())
      );
      return { headers, rows };
    });
    const inputs = Array.from(document.querySelectorAll('input, select')).map(i => ({
      name: i.name,
      id: i.id,
      value: i.value,
      type: i.type
    }));
    return { text, tables, inputs };
  });
  fs.writeFileSync(path.join(outputDir, 'packet_2364967_published.json'), JSON.stringify(packetData, null, 2));

  // Now let's explore CompanySetup and its sub-tabs/sub-pages
  console.log('\nNavigating to CompanySetup...');
  await page.goto('https://www.cohesion4restaurants.com/CompanySetup/Main', { waitUntil: 'networkidle2' });
  await delay(2000);

  const companyLinks = await page.$$eval('a', els => els.map(e => ({ text: e.innerText.trim(), href: e.href })));
  fs.writeFileSync(path.join(outputDir, 'company_links.json'), JSON.stringify(companyLinks, null, 2));

  // Visit every company sublink found
  for (const cl of companyLinks) {
    if (cl.href && cl.href.includes('cohesion4restaurants.com') && !cl.href.includes('#') && !cl.href.includes('SignOut')) {
      console.log(`Visiting Company Setup link: ${cl.text} -> ${cl.href}`);
      try {
        await page.goto(cl.href, { waitUntil: 'networkidle2', timeout: 15000 });
        await delay(1500);
        const safeName = (cl.text || 'page').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
        await page.screenshot({ path: path.join(outputDir, `company_${safeName}.png`), fullPage: true });
        fs.writeFileSync(path.join(outputDir, `company_${safeName}.html`), await page.content());

        const data = await page.evaluate(() => {
          return {
            text: document.body.innerText,
            tables: Array.from(document.querySelectorAll('table')).map(t => ({
              headers: Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim()),
              rows: Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))
            })),
            selects: Array.from(document.querySelectorAll('select')).map(s => ({
              id: s.id,
              name: s.name,
              options: Array.from(s.options).map(o => ({ value: o.value, text: o.text, selected: o.selected }))
            }))
          };
        });
        fs.writeFileSync(path.join(outputDir, `company_${safeName}.json`), JSON.stringify(data, null, 2));
      } catch (err) {
        console.log(`Error visiting ${cl.href}:`, err.message);
      }
    }
  }

  // Now let's explore Downloads
  console.log('\nNavigating to Downloads...');
  await page.goto('https://www.cohesion4restaurants.com/Downloads/Main', { waitUntil: 'networkidle2' });
  await delay(2000);
  const downloadLinks = await page.$$eval('a', els => els.map(e => ({ text: e.innerText.trim(), href: e.href })));
  fs.writeFileSync(path.join(outputDir, 'downloads_links.json'), JSON.stringify(downloadLinks, null, 2));

  // Let's also check Subscriptions
  console.log('\nNavigating to Subscriptions...');
  await page.goto('https://www.cohesion4restaurants.com/Subscriptions/Main', { waitUntil: 'networkidle2' });
  await delay(2000);
  await page.screenshot({ path: path.join(outputDir, 'subscriptions.png'), fullPage: true });
  fs.writeFileSync(path.join(outputDir, 'subscriptions.html'), await page.content());

  await browser.close();
  console.log('Detailed packet & company setup exploration finished!');
}

run().catch(console.error);
