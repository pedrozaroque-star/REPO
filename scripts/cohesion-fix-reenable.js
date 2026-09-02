const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200 });

  console.log('Logging in to re-enable all workflows...');
  await page.goto('https://www.cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' });
  await page.type('#Email, input[name*="Email"], #UserName', 'raquel@tacosgavilan.com');
  await page.type('#Password, input[name*="Password"]', 'Canasta323!');
  const submitBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    submitBtn.click()
  ]);

  // Go to Sites & Workflows page
  console.log('Navigating to Sites & Workflows...');
  await page.goto('https://www.cohesion4restaurants.com/CompanySetupCompanyManagement/ProcessCompanySetupTask?CompanyId=1866&TaskId=3', { waitUntil: 'networkidle2' });
  await delay(2000);

  // Take screenshot to see current state
  const outputDir = path.join(__dirname, 'cohesion_dump', 'fix');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  await page.screenshot({ path: path.join(outputDir, '01_current_state.png'), fullPage: true });
  fs.writeFileSync(path.join(outputDir, '01_current_state.html'), await page.content());

  // Extract current state - look for Enable buttons (which means they are currently disabled)
  const currentState = await page.evaluate(() => {
    const text = document.body.innerText;
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.innerText.trim(),
      href: a.href,
      id: a.id,
      class: a.className
    }));
    
    // Find Enable and Disable links
    const enableLinks = links.filter(l => l.href.includes('ActivateWorkflow') && !l.href.includes('Deactivate'));
    const disableLinks = links.filter(l => l.href.includes('DeactivateWorkflow'));
    
    return { text: text.substring(0, 3000), enableLinks, disableLinks };
  });

  console.log('\n--- CURRENT STATE ---');
  console.log(`Enable links found (workflows currently DISABLED): ${currentState.enableLinks.length}`);
  currentState.enableLinks.forEach(l => console.log(`  DISABLED: ${l.text} -> ${l.href}`));
  console.log(`Disable links found (workflows currently ACTIVE): ${currentState.disableLinks.length}`);
  currentState.disableLinks.forEach(l => console.log(`  ACTIVE: ${l.text} -> ${l.href}`));

  // RE-ENABLE all disabled workflows
  if (currentState.enableLinks.length > 0) {
    console.log(`\n=== RE-ENABLING ${currentState.enableLinks.length} DISABLED WORKFLOWS ===`);
    for (const link of currentState.enableLinks) {
      console.log(`Re-enabling: ${link.href}`);
      try {
        await page.goto(link.href, { waitUntil: 'networkidle2', timeout: 15000 });
        await delay(1500);
        console.log('  ✅ Done.');
      } catch (e) {
        console.log(`  ❌ Error: ${e.message}`);
      }
      
      // Go back to the sites page to continue
      await page.goto('https://www.cohesion4restaurants.com/CompanySetupCompanyManagement/ProcessCompanySetupTask?CompanyId=1866&TaskId=3', { waitUntil: 'networkidle2' });
      await delay(1000);
    }
  } else {
    console.log('\nNo disabled workflows found - all may already be active, or the page structure is different.');
  }

  // Take final screenshot
  await page.goto('https://www.cohesion4restaurants.com/CompanySetupCompanyManagement/ProcessCompanySetupTask?CompanyId=1866&TaskId=3', { waitUntil: 'networkidle2' });
  await delay(2000);
  await page.screenshot({ path: path.join(outputDir, '02_after_fix.png'), fullPage: true });
  fs.writeFileSync(path.join(outputDir, '02_after_fix.html'), await page.content());

  // Final state check
  const finalState = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.innerText.trim(),
      href: a.href
    }));
    const enableLinks = links.filter(l => l.href.includes('ActivateWorkflow') && !l.href.includes('Deactivate'));
    const disableLinks = links.filter(l => l.href.includes('DeactivateWorkflow'));
    return { enableLinks: enableLinks.length, disableLinks: disableLinks.length };
  });

  console.log('\n--- FINAL STATE ---');
  console.log(`Still disabled (Enable links): ${finalState.enableLinks}`);
  console.log(`Active (Disable links): ${finalState.disableLinks}`);

  // Also check Sales Workflows to verify packets are showing
  console.log('\nChecking Sales Workflows page...');
  await page.goto('https://www.cohesion4restaurants.com/MyWorkflowsSales/Main', { waitUntil: 'networkidle2' });
  await delay(2000);
  await page.screenshot({ path: path.join(outputDir, '03_sales_workflows.png'), fullPage: true });
  
  const salesState = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.substring(0, 2000);
  });
  console.log('Sales Workflows page content:', salesState.substring(0, 500));

  await browser.close();
  console.log('\n=== FIX SCRIPT COMPLETED ===');
}

run().catch(console.error);
