import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'

async function deepCrawlCompany() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🕵️ EXPLORACIÓN PROFUNDA DE CONFIGURACIÓN DE COMPAÑÍA EN COHESION')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  const outputDir = path.join(process.cwd(), 'cohesion_dump', 'company_setup')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  try {
    // 1. Sign in
    await page.goto('https://cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' })
    await page.type('#Email', 'raquel@tacosgavilan.com')
    await page.type('#Password', 'Canasta213!')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]')
    ])

    // 2. Go to Company Management
    const companyUrl = 'https://cohesion4restaurants.com/CompanySetupCompanyManagement/CompanyManagement/1866?IsTheOnlyCompany=True&IsSetupComplete=True&Name=Tacos%20El%20Gavilan%20Inc'
    console.log(`Visitando: ${companyUrl} ...`)
    await page.goto(companyUrl, { waitUntil: 'networkidle2' })

    await page.screenshot({ path: path.join(outputDir, '01_company_management.png'), fullPage: true })
    fs.writeFileSync(path.join(outputDir, '01_company_management.html'), await page.content())

    // 3. Extract all links / tabs / buttons inside Company Management
    const linksAndTabs = await page.evaluate(() => {
      const items: any[] = []
      document.querySelectorAll('a, button, .tab, .nav-tabs li a').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim()
        const href = (el as HTMLAnchorElement).href
        const onclick = el.getAttribute('onclick')
        if (text) {
          items.push({ text, href, onclick, tag: el.tagName, className: el.className })
        }
      })
      return items
    })

    console.log(`Elementos interactivos encontrados en Company Management (${linksAndTabs.length}):`)
    fs.writeFileSync(path.join(outputDir, 'company_links.json'), JSON.stringify(linksAndTabs, null, 2))

    // 4. Visit each relevant sub-link inside Company Management
    const subHrefs = Array.from(new Set(linksAndTabs.map(i => i.href)))
      .filter(h => h && h.startsWith('http') && !h.includes('SignOut') && !h.includes('#'))

    for (let i = 0; i < subHrefs.length; i++) {
      const href = subHrefs[i]
      console.log(`→ Visitando sub-sección [${i + 1}/${subHrefs.length}]: ${href} ...`)
      try {
        await page.goto(href, { waitUntil: 'networkidle2', timeout: 30000 })
        const safeName = href.replace(/https?:\/\/cohesion4restaurants\.com\//, '').replace(/[^a-zA-Z0-9_]/g, '_')
        await page.screenshot({ path: path.join(outputDir, `sub_${i + 1}_${safeName}.png`), fullPage: true })
        fs.writeFileSync(path.join(outputDir, `sub_${i + 1}_${safeName}.html`), await page.content())
      } catch (err: any) {
        console.warn(`Error en ${href}:`, err.message)
      }
    }

    console.log('✓ Exploración profunda de Company Management completada!')
  } catch (err: any) {
    console.error('Error general:', err)
  } finally {
    await browser.close()
  }
}

deepCrawlCompany()
