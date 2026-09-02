const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const outputDir = path.join(__dirname, 'cohesion_dump', 'site_mappings');
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

  // Check Workflow Rules
  console.log('\nChecking Workflow Rules...');
  await page.goto('https://www.cohesion4restaurants.com/CompanySetupSiteManagementWorkflowRules/List?CompanyId=1866&TaskId=3', { waitUntil: 'networkidle2' });
  await delay(1500);
  await page.screenshot({ path: path.join(outputDir, 'workflow_rules.png'), fullPage: true });
  fs.writeFileSync(path.join(outputDir, 'workflow_rules.html'), await page.content());

  // Check Azusa Settings
  console.log('\nChecking AZUSA Workflow Settings...');
  const azusaSettingsUrl = 'https://www.cohesion4restaurants.com/CompanySetupWorkflowManagementSettings/Update?CompanyId=1866&TaskId=3&siteId=2248&siteName=AZUSA&workflowId=2606';
  await page.goto(azusaSettingsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(2000);

  await page.screenshot({ path: path.join(outputDir, 'azusa_settings.png'), fullPage: true });
  fs.writeFileSync(path.join(outputDir, 'azusa_settings.html'), await page.content());

  // Extract all forms, tabs, inputs, selects, mapping tables from this page
  const azusaMapping = await page.evaluate(() => {
    const text = document.body.innerText;
    const tabs = Array.from(document.querySelectorAll('.nav-tabs li a, .nav li a')).map(a => ({
      text: a.innerText.trim(),
      href: a.getAttribute('href')
    }));

    const tables = Array.from(document.querySelectorAll('table')).map(t => {
      const headers = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim());
      const rows = Array.from(t.querySelectorAll('tr')).map(tr => 
        Array.from(tr.querySelectorAll('td, th')).map(td => {
          const select = td.querySelector('select');
          if (select) {
            const selectedOpt = select.options[select.selectedIndex];
            return `${td.innerText.trim()} [SELECT: ${selectedOpt ? selectedOpt.text : ''} (val: ${select.value})]`;
          }
          return td.innerText.trim();
        })
      );
      return { headers, rows };
    });

    const selects = Array.from(document.querySelectorAll('select')).map(s => {
      const selectedOpt = s.options[s.selectedIndex];
      return {
        id: s.id,
        name: s.name,
        selectedValue: s.value,
        selectedText: selectedOpt ? selectedOpt.text : '',
        allOptions: Array.from(s.options).map(o => ({ value: o.value, text: o.text }))
      };
    });

    return { text, tabs, tables, selects };
  });

  fs.writeFileSync(path.join(outputDir, 'azusa_mapping.json'), JSON.stringify(azusaMapping, null, 2));

  // Check Users
  console.log('\nChecking Users...');
  await page.goto('https://www.cohesion4restaurants.com/Users/Main', { waitUntil: 'networkidle2' });
  await delay(1500);
  await page.screenshot({ path: path.join(outputDir, 'users.png'), fullPage: true });
  fs.writeFileSync(path.join(outputDir, 'users.html'), await page.content());

  // Check Subscriptions Details
  console.log('\nChecking Subscriptions Details...');
  await page.goto('https://www.cohesion4restaurants.com/Subscriptions/Main', { waitUntil: 'networkidle2' });
  await delay(1500);
  const subsData = await page.evaluate(() => {
    return {
      text: document.body.innerText,
      tables: Array.from(document.querySelectorAll('table')).map(t => ({
        headers: Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim()),
        rows: Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))
      }))
    };
  });
  fs.writeFileSync(path.join(outputDir, 'subscriptions.json'), JSON.stringify(subsData, null, 2));

  await browser.close();
  console.log('Site mappings & settings exploration complete!');
}

run().catch(console.error);
