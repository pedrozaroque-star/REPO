import puppeteer from 'puppeteer'
import fs from 'fs'

async function inspectPacket() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  await page.goto('https://cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' })
  await page.type('#Email', 'raquel@tacosgavilan.com')
  await page.type('#Password', 'Canasta213!')
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type="submit"]')
  ])

  // Go to Sales Main
  const url = 'https://cohesion4restaurants.com/MyWorkflowsSales/Main'
  console.log(`Visitando: ${url} ...`)
  await page.goto(url, { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, 2000))

  // Find packet button for Downey 08/31/2026: #btnPacket_2367414
  console.log('Esperando botón #btnPacket_2367414 ...')
  await page.waitForSelector('#btnPacket_2367414', { timeout: 10000 })
  await page.click('#btnPacket_2367414')
  console.log('Clickeado #btnPacket_2367414! Esperando contenido...')
  await new Promise(r => setTimeout(r, 4000))

  await page.screenshot({ path: 'cohesion_dump/downey_packet_review.png', fullPage: true })
  const html = await page.content()
  fs.writeFileSync('cohesion_dump/downey_packet_review.html', html)
  console.log('Guardado HTML y screenshot de Downey en cohesion_dump!')

  await browser.close()
}

inspectPacket()
