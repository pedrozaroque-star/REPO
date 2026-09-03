import puppeteer from 'puppeteer'
import path from 'path'

async function screenshotPages() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 })
  const htmlPath = path.resolve('data/manual_raquel_accounting.html')
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' })

  const pageElements = await page.$$('.page')
  console.log('Found page elements:', pageElements.length)
  for (let i = 0; i < pageElements.length; i++) {
    const filename = `public/docs/manual_page_${i + 1}.png`
    await pageElements[i].screenshot({ path: filename })
    console.log(`Saved page ${i + 1} to ${filename}`)
  }
  await browser.close()
}

screenshotPages()
