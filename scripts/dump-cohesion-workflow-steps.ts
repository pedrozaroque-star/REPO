import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'

async function dumpWorkflowSteps() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🕵️ EXTRACCIÓN COMPLETA DE LOS 12 PASOS DE CONFIGURACIÓN EN COHESION')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  const outputDir = path.join(process.cwd(), 'cohesion_dump', 'workflow_steps')
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

    // 2. Go to Azusa Workflow Settings
    const wizardUrl = 'https://cohesion4restaurants.com/CompanySetupWorkflowManagementSettings/Update?CompanyId=1866&TaskId=3&siteId=2248&siteName=AZUSA&workflowId=2606'
    console.log(`Navegando al Wizard de Azusa: ${wizardUrl} ...`)
    await page.goto(wizardUrl, { waitUntil: 'networkidle2' })

    // 3. Extract the Wizard Steps
    const stepsData = await page.evaluate(() => {
      const steps: any[] = []
      const stepTabs = document.querySelectorAll('.steps li, ul[role="tablist"] li')
      stepTabs.forEach((li, index) => {
        steps.push({
          stepIndex: index + 1,
          title: (li as HTMLElement).innerText?.trim().replace(/\n+/g, ' ')
        })
      })
      return steps
    })

    console.log(`Pasos detectados en el Wizard (${stepsData.length}):`)
    console.log(JSON.stringify(stepsData, null, 2))

    // 4. Click through each step 1 to 12 and dump the form content, options, inputs
    for (let step = 0; step < 12; step++) {
      console.log(`\n--- Extrayendo Paso ${step + 1} ---`)
      
      // Click on step tab if clickable or Next button
      await page.evaluate((s) => {
        const tabs = document.querySelectorAll('.steps li a, ul[role="tablist"] li a')
        if (tabs[s]) {
          (tabs[s] as HTMLElement).click()
        }
      }, step)

      await new Promise(r => setTimeout(r, 1200))

      // Take screenshot of this step
      const stepImg = path.join(outputDir, `step_${String(step + 1).padStart(2, '0')}.png`)
      await page.screenshot({ path: stepImg, fullPage: true })

      // Extract all form inputs, labels, selects, checkboxes, values in this step
      const stepDetails = await page.evaluate((s) => {
        const container = document.querySelector(`#form-p-${s}`) || document.querySelector('.content') || document.body
        const inputs: any[] = []
        container.querySelectorAll('input, select, textarea').forEach(el => {
          const inp = el as HTMLInputElement | HTMLSelectElement
          const label = inp.closest('.form-group, tr, div')?.querySelector('label, td:first-child')?.textContent?.trim() || ''
          let val = inp.value
          let selectedText = ''
          if (inp.tagName === 'SELECT') {
            const sel = inp as HTMLSelectElement
            selectedText = sel.options[sel.selectedIndex]?.text || ''
          }
          inputs.push({
            id: inp.id,
            name: inp.name,
            type: (inp as HTMLInputElement).type || inp.tagName.toLowerCase(),
            label: label.replace(/\s+/g, ' ').trim(),
            value: val,
            selectedText,
            checked: (inp as HTMLInputElement).checked
          })
        })
        return {
          html: container.innerHTML,
          inputs
        }
      }, step)

      fs.writeFileSync(path.join(outputDir, `step_${String(step + 1).padStart(2, '0')}_inputs.json`), JSON.stringify(stepDetails.inputs, null, 2))
      fs.writeFileSync(path.join(outputDir, `step_${String(step + 1).padStart(2, '0')}.html`), stepDetails.html)
      console.log(`✓ Paso ${step + 1} guardado (${stepDetails.inputs.length} campos detectados).`)
    }

    console.log('\n🎉 ¡Extracción de los 12 pasos completada con éxito!')
  } catch (err: any) {
    console.error('Error durante extracción del wizard:', err)
  } finally {
    await browser.close()
  }
}

dumpWorkflowSteps()
