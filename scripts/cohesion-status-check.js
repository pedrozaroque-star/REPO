const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const outputDir = path.join(__dirname, 'cohesion_dump', 'status_check');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200 });

  console.log('Logging in (READ-ONLY check)...');
  await page.goto('https://www.cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' });
  await page.type('#Email, input[name*="Email"], #UserName', 'raquel@tacosgavilan.com');
  await page.type('#Password, input[name*="Password"]', 'Canasta323!');
  const submitBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    submitBtn.click()
  ]);

  // === ONLY READ — NO CLICKING ANY ACTION LINKS ===

  // 1. Check Sites & Workflows page (read only)
  console.log('\n--- Checking Sites & Workflows status ---');
  await page.goto('https://www.cohesion4restaurants.com/CompanySetupCompanyManagement/ProcessCompanySetupTask?CompanyId=1866&TaskId=3', { waitUntil: 'networkidle2' });
  await delay(2000);
  await page.screenshot({ path: path.join(outputDir, 'sites_status.png'), fullPage: true });

  // Extract Enable/Disable link counts WITHOUT navigating to them
  const siteStatus = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll('a'));
    const enableLinks = allLinks.filter(a => a.href.includes('ActivateWorkflow') && !a.href.includes('Deactivate'));
    const disableLinks = allLinks.filter(a => a.href.includes('DeactivateWorkflow'));

    return {
      disabledWorkflows: enableLinks.map(a => {
        const params = new URLSearchParams(a.href.split('?')[1]);
        return { siteName: params.get('siteName') || 'unknown', siteId: params.get('siteId') };
      }),
      activeWorkflows: disableLinks.map(a => {
        const params = new URLSearchParams(a.href.split('?')[1]);
        return { siteName: params.get('siteName') || 'unknown', siteId: params.get('siteId') };
      }),
      pageText: document.body.innerText.substring(0, 3000)
    };
  });

  console.log(`\n✅ ACTIVE workflows (have "Disable" button): ${siteStatus.activeWorkflows.length}`);
  siteStatus.activeWorkflows.forEach(s => console.log(`   ✅ ${s.siteName} (siteId: ${s.siteId})`));

  console.log(`\n❌ DISABLED workflows (have "Enable" button): ${siteStatus.disabledWorkflows.length}`);
  siteStatus.disabledWorkflows.forEach(s => console.log(`   ❌ ${s.siteName} (siteId: ${s.siteId})`));

  // 2. Check Sales Workflows page (read only)
  console.log('\n--- Checking Sales Workflows page ---');
  await page.goto('https://www.cohesion4restaurants.com/MyWorkflowsSales/Main', { waitUntil: 'networkidle2' });
  await delay(2000);
  await page.screenshot({ path: path.join(outputDir, 'sales_workflows_status.png'), fullPage: true });

  const salesStatus = await page.evaluate(() => {
    const text = document.body.innerText;
    // Count stores visible
    const publishedCount = (text.match(/Published/g) || []).length;
    const unopenedCount = (text.match(/UnOpened/g) || []).length;
    const readyCount = (text.match(/Ready/g) || []).length;
    return { publishedCount, unopenedCount, readyCount, snippet: text.substring(0, 1500) };
  });

  console.log(`\nSales page packet counts: Published=${salesStatus.publishedCount}, UnOpened=${salesStatus.unopenedCount}, Ready=${salesStatus.readyCount}`);

  fs.writeFileSync(path.join(outputDir, 'status_report.json'), JSON.stringify({ siteStatus, salesStatus }, null, 2));

  await browser.close();
  console.log('\n=== STATUS CHECK COMPLETE (read-only, nothing modified) ===');
}

run().catch(console.error);
