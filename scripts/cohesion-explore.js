const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to Cohesion login...');
  await page.goto('https://www.cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' });

  // Take screenshot of login page
  await page.screenshot({ path: path.join(outputDir, '01_login_page.png') });
  fs.writeFileSync(path.join(outputDir, '01_login_page.html'), await page.content());

  console.log('Filling credentials...');
  // Find email / username and password inputs
  const emailInput = await page.$('input[type="email"], input[type="text"], input[name*="Email"], input[name*="User"], #Email, #Username, #UserName');
  const passwordInput = await page.$('input[type="password"], input[name*="Password"], #Password');
  
  if (emailInput && passwordInput) {
    await emailInput.type('raquel@tacosgavilan.com');
    await passwordInput.type('Canasta323!');
    
    // Find submit button
    const submitBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary, button.btn');
    if (submitBtn) {
      console.log('Submitting login...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.log('Navigation wait error:', e.message)),
        submitBtn.click()
      ]);
    } else {
      console.log('Submit button not found, pressing Enter...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.log('Navigation wait error:', e.message)),
        passwordInput.press('Enter')
      ]);
    }
  } else {
    console.log('Input fields not found! Inspecting page inputs...');
    const inputs = await page.$$eval('input', els => els.map(e => ({ name: e.name, id: e.id, type: e.type, placeholder: e.placeholder })));
    console.log('Inputs found:', inputs);
  }

  console.log('Current URL after login attempt:', page.url());
  await page.screenshot({ path: path.join(outputDir, '02_after_login.png') });
  fs.writeFileSync(path.join(outputDir, '02_after_login.html'), await page.content());

  // Extract all links and navigation items
  const navLinks = await page.$$eval('a', els => els.map(e => ({
    text: e.innerText.trim(),
    href: e.href,
    title: e.title || ''
  })).filter(l => l.href && !l.href.startsWith('javascript:')));

  fs.writeFileSync(path.join(outputDir, 'nav_links.json'), JSON.stringify(navLinks, null, 2));
  console.log(`Extracted ${navLinks.length} navigation links.`);

  await browser.close();
  console.log('Initial exploration done.');
}

run().catch(console.error);
