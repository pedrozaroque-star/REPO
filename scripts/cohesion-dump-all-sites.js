const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const outputDir = path.join(__dirname, 'cohesion_dump', 'all_sites');
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

  // Go to Sites & Workflows Task 3
  console.log('Fetching Sites list...');
  await page.goto('https://www.cohesion4restaurants.com/CompanySetupCompanyManagement/ProcessCompanySetupTask?CompanyId=1866&TaskId=3', { waitUntil: 'networkidle2' });
  await delay(2000);

  // Extract all sites and their settings links
  const sites = await page.evaluate(() => {
    const results = [];
    const siteBlocks = document.querySelectorAll('.ibox, tr, div');
    const settingsLinks = Array.from(document.querySelectorAll('a[href*="CompanySetupWorkflowManagementSettings/Update"]'));
    
    settingsLinks.forEach(a => {
      const href = a.href;
      const urlParams = new URLSearchParams(href.split('?')[1]);
      results.push({
        siteId: urlParams.get('siteId'),
        siteName: urlParams.get('siteName'),
        workflowId: urlParams.get('workflowId'),
        href: href
      });
    });
    return results;
  });

  console.log(`Found ${sites.length} sites configured in Cohesion:`, sites.map(s => `${s.siteName} (siteId: ${s.siteId}, wfId: ${s.workflowId})`));
  fs.writeFileSync(path.join(outputDir, 'sites_list.json'), JSON.stringify(sites, null, 2));

  // Also extract subscription billing details
  await page.goto('https://www.cohesion4restaurants.com/Subscriptions/Main', { waitUntil: 'networkidle2' });
  await delay(1500);
  const subInfo = await page.evaluate(() => {
    return document.body.innerText;
  });
  fs.writeFileSync(path.join(outputDir, 'subscription_summary.txt'), subInfo);

  // Also check User details and permissions
  await page.goto('https://www.cohesion4restaurants.com/Users/Main', { waitUntil: 'networkidle2' });
  await delay(1500);
  const usersInfo = await page.evaluate(() => {
    return {
      text: document.body.innerText,
      tables: Array.from(document.querySelectorAll('table')).map(t => ({
        headers: Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim()),
        rows: Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))
      }))
    };
  });
  fs.writeFileSync(path.join(outputDir, 'users_summary.json'), JSON.stringify(usersInfo, null, 2));

  await browser.close();
  console.log('All sites dump complete!');
}

run().catch(console.error);
