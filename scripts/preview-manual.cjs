const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function render() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  // Set viewport to standard letter aspect ratio at high DPI
  await page.setViewport({ width: 850, height: 1100, deviceScaleFactor: 2 });
  
  // Read html
  const scriptContent = fs.readFileSync(path.resolve('scripts/generate-viele-manual-pdf.cjs'), 'utf8');
  const startTag = 'const htmlContent = `';
  const endTag = '`;';
  const start = scriptContent.indexOf(startTag) + startTag.length;
  const end = scriptContent.indexOf(endTag, start);
  const html = scriptContent.substring(start, end);

  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  const artifactDir = 'C:/Users/pedro/.gemini/antigravity/brain/0881a7ea-77a4-4092-b892-5d2cd5971184';
  const p1Path = path.join(artifactDir, 'manual_pagina1.png');
  const p2Path = path.join(artifactDir, 'manual_pagina2.png');
  
  // We can evaluate and hide page 2 for page 1 shot, and vice-versa
  await page.evaluate(() => {
    const p1Elements = [];
    const p2Elements = [];
    let passedBreak = false;
    for (const child of document.body.children) {
      if (child.classList && child.classList.contains('page-break')) {
        passedBreak = true;
        continue;
      }
      if (!passedBreak) p1Elements.push(child);
      else p2Elements.push(child);
    }
    window.__p1 = p1Elements;
    window.__p2 = p2Elements;
  });

  // Hide p2
  await page.evaluate(() => {
    window.__p2.forEach(el => el.style.display = 'none');
    window.__p1.forEach(el => el.style.display = '');
  });
  await page.screenshot({ path: p1Path, fullPage: true });

  // Hide p1, show p2
  await page.evaluate(() => {
    window.__p1.forEach(el => el.style.display = 'none');
    window.__p2.forEach(el => el.style.display = '');
  });
  await page.screenshot({ path: p2Path, fullPage: true });

  await browser.close();
  console.log('Screenshots creados en:');
  console.log('P1:', p1Path);
  console.log('P2:', p2Path);
}

render().catch(err => {
  console.error(err);
  process.exit(1);
});
