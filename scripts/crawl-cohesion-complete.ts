import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'

async function crawlCohesion() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🕵️ EXPLORACIÓN FORENSE INTEGRAL DE COHESION4RESTAURANTS.COM')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  const outputDir = path.join(process.cwd(), 'cohesion_dump')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  try {
    console.log('1. Iniciando sesión en https://cohesion4restaurants.com/Account/SignIn ...')
    await page.goto('https://cohesion4restaurants.com/Account/SignIn', { waitUntil: 'networkidle2' })

    await page.type('#Email', 'raquel@tacosgavilan.com')
    await page.type('#Password', 'Canasta213!')

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]')
    ])

    console.log(`✓ Sesión iniciada. URL actual: ${page.url()}`)
    await page.screenshot({ path: path.join(outputDir, '01_dashboard.png'), fullPage: true })

    // 2. Extraer toda la barra de navegación (Header, Navbar, Sidebar, Menús desplegables)
    const navItems = await page.evaluate(() => {
      const links: { text: string; href: string; parentMenu?: string }[] = []
      document.querySelectorAll('a').forEach(a => {
        const text = a.innerText?.trim()
        const href = a.href
        if (text && href && !href.startsWith('javascript:void') && !href.includes('LogOff')) {
          const parent = a.closest('.dropdown, .dropdown-menu, nav, ul, .navbar')
          links.push({
            text,
            href,
            parentMenu: parent ? parent.className : undefined
          })
        }
      })
      return links
    })

    console.log(`\n2. Enlaces encontrados en la barra de navegación (${navItems.length}):`)
    console.log(JSON.stringify(navItems, null, 2))
    fs.writeFileSync(path.join(outputDir, 'nav_links.json'), JSON.stringify(navItems, null, 2))

    // 3. Extraer estructura del DOM del Dashboard / Home
    const dashboardHtml = await page.content()
    fs.writeFileSync(path.join(outputDir, '01_dashboard.html'), dashboardHtml)

    // 4. Identificar páginas clave a explorar
    // Links que típicamente existen:
    // - Daily Sales / Packets
    // - Company / Settings / Configuration
    // - Sites
    // - Accounts / Chart of Accounts
    // - Workflow / Sales Workflow
    // - Sync History / Reports

    // Extraer todos los hrefs únicos
    const uniqueHrefs = Array.from(new Set(navItems.map(n => n.href)))
      .filter(h => h.includes('cohesion4restaurants.com') && !h.includes('LogOff') && !h.includes('#'))

    console.log(`\n3. Navegando a todas las páginas únicas detectadas (${uniqueHrefs.length}):`)
    let idx = 2
    for (const href of uniqueHrefs) {
      const pageName = href.split('/').slice(3).join('_').replace(/[^a-zA-Z0-9_]/g, '_') || 'page'
      console.log(`\n→ Visitando [${idx}]: ${href} (${pageName}) ...`)
      try {
        await page.goto(href, { waitUntil: 'networkidle2', timeout: 30000 })
        const screenshotPath = path.join(outputDir, `${String(idx).padStart(2, '0')}_${pageName}.png`)
        await page.screenshot({ path: screenshotPath, fullPage: true })
        const htmlPath = path.join(outputDir, `${String(idx).padStart(2, '0')}_${pageName}.html`)
        fs.writeFileSync(htmlPath, await page.content())
        console.log(`  ✓ Guardado: ${screenshotPath}`)
      } catch (err: any) {
        console.warn(`  ⚠️ Error navegando a ${href}:`, err.message)
      }
      idx++
    }

    // 5. Visitar específicamente las URLs de configuración conocidas de Cohesion
    const knownSetupUrls = [
      'https://cohesion4restaurants.com/Company/SalesWorkflow/1866',
      'https://cohesion4restaurants.com/Company/Settings/1866',
      'https://cohesion4restaurants.com/Company/Sites/1866',
      'https://cohesion4restaurants.com/Company/Edit/1866',
      'https://cohesion4restaurants.com/Company/Accounts/1866',
      'https://cohesion4restaurants.com/DailySales',
      'https://cohesion4restaurants.com/DailySales/Summary',
      'https://cohesion4restaurants.com/Site',
      'https://cohesion4restaurants.com/Account/Manage',
      'https://cohesion4restaurants.com/Log',
    ]

    console.log('\n4. Visitando URLs directas de Configuración / Company ...')
    for (const setupUrl of knownSetupUrls) {
      if (!uniqueHrefs.includes(setupUrl)) {
        const pageName = setupUrl.split('/').slice(3).join('_').replace(/[^a-zA-Z0-9_]/g, '_')
        console.log(`→ Consultando: ${setupUrl} ...`)
        try {
          await page.goto(setupUrl, { waitUntil: 'networkidle2', timeout: 30000 })
          const screenshotPath = path.join(outputDir, `${String(idx).padStart(2, '0')}_${pageName}.png`)
          await page.screenshot({ path: screenshotPath, fullPage: true })
          const htmlPath = path.join(outputDir, `${String(idx).padStart(2, '0')}_${pageName}.html`)
          fs.writeFileSync(htmlPath, await page.content())
          console.log(`  ✓ Guardado: ${screenshotPath}`)
        } catch (err: any) {
          console.warn(`  ⚠️ Error navegando a ${setupUrl}:`, err.message)
        }
        idx++
      }
    }

    console.log('\n🎉 ¡Exploración completada! Todos los archivos guardados en cohesion_dump/')
  } catch (error: any) {
    console.error('Error general durante la exploración:', error)
  } finally {
    await browser.close()
  }
}

crawlCohesion()
