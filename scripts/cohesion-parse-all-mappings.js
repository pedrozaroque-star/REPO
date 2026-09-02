const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const outputDir = path.join(__dirname, 'cohesion_dump', 'all_mappings');
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

  // Go to Azusa Settings and extract EVERY step in the wizard!
  // The wizard has 12 steps:
  // 1. QuickBooks
  // 2. Daily Sales Journal Entry
  // 3. Gross Receipts - Sales
  // 4. Gross Receipts - Discounts
  // 5. Gross Receipts - Taxes
  // 6. Gross Receipts - Other
  // 7. Payments - Credit Cards
  // 8. Payments - Other
  // 9. Cash Reconciliation
  // 10. Receivables
  // 11. Validation
  // 12. Finished

  console.log('Fetching Azusa settings wizard...');
  const azusaUrl = 'https://www.cohesion4restaurants.com/CompanySetupWorkflowManagementSettings/Update?CompanyId=1866&TaskId=3&siteId=2248&siteName=AZUSA&workflowId=2606';
  await page.goto(azusaUrl, { waitUntil: 'networkidle2' });
  await delay(2000);

  // Let's dump all inputs, checkboxes, radios, and selects
  const fullFormData = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea')).map(el => {
      let selectedText = '';
      if (el.tagName === 'SELECT') {
        const opt = el.options[el.selectedIndex];
        selectedText = opt ? opt.text : '';
      }
      return {
        tag: el.tagName,
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        value: el.value || '',
        checked: el.checked,
        selectedText: selectedText,
        label: el.closest('tr') ? el.closest('tr').innerText.trim().replace(/\s+/g, ' ') : ''
      };
    });

    return { inputs };
  });

  fs.writeFileSync(path.join(outputDir, 'azusa_full_form.json'), JSON.stringify(fullFormData, null, 2));
  console.log(`Extracted ${fullFormData.inputs.length} form controls from Azusa settings.`);

  // Let's check Downloads
  await page.goto('https://www.cohesion4restaurants.com/Downloads/Main', { waitUntil: 'networkidle2' });
  await delay(1000);
  const downloadsText = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(outputDir, 'downloads.txt'), downloadsText);

  // Let's check Help
  await page.goto('https://www.cohesion4restaurants.com/Help/Main', { waitUntil: 'networkidle2' });
  await delay(1000);
  const helpArticles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href*="/Help/Article/"]')).map(a => ({
      text: a.innerText.trim(),
      href: a.href
    }));
  });
  fs.writeFileSync(path.join(outputDir, 'help_articles.json'), JSON.stringify(helpArticles, null, 2));

  await browser.close();
  console.log('All mappings dump complete!');
}

run().catch(console.error);
