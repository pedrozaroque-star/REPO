/**
 * @module scripts/test-app-sidebar-and-fullscreen-flow
 * @description Suite de pruebas automatizadas y simulación de tiempo de ejecución
 * para la integración de la App Móvil de Clientes en la barra lateral (AppSidebar)
 * y la experiencia Fullscreen con botón de salida temporal en TEG System.
 */

import fs from 'fs'
import path from 'path'
import http from 'http'

async function runTests() {
  console.log('🚀 Iniciando Simulación y Auditoría de Integración Sidebar + Fullscreen...\n')

  let passed = 0
  let failed = 0

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`)
      passed++
    } else {
      console.error(`  ❌ [FAIL] ${testName}`)
      if (detail) console.error(`     -> Detalle: ${detail}`)
      failed++
    }
  }

  const rootDir = process.cwd()

  // 1. Validar AppSidebar.tsx
  console.log('1️⃣  Validando componentes/AppSidebar.tsx:')
  const sidebarPath = path.join(rootDir, 'components', 'AppSidebar.tsx')
  const sidebarContent = fs.readFileSync(sidebarPath, 'utf8')

  assert(
    sidebarContent.includes("import {") && sidebarContent.includes("Smartphone"),
    'Smartphone icon importado en AppSidebar.tsx'
  )
  assert(
    sidebarContent.includes("path: '/app'") || sidebarContent.includes('path: "/app"'),
    'Ruta /app registrada en los items de navegación'
  )
  assert(
    sidebarContent.includes("hasNewBadge = item.path === '/basecamp' || item.path === '/admin/compras/viele' || item.path === '/app'"),
    'Badge NEW activo para /app en hasNewBadge'
  )
  assert(
    sidebarContent.includes("name: t('items.customer_app')"),
    'Nombre bilingüe usando t(items.customer_app) en AppSidebar.tsx'
  )
  assert(
    sidebarContent.includes("'asistente', 'manager', 'supervisor', 'admin'"),
    'Roles completos autorizados (admin, manager, supervisor, asistente)'
  )

  // 2. Validar ClientLayout.tsx
  console.log('\n2️⃣  Validando components/ClientLayout.tsx:')
  const layoutPath = path.join(rootDir, 'components', 'ClientLayout.tsx')
  const layoutContent = fs.readFileSync(layoutPath, 'utf8')

  assert(
    layoutContent.includes("'/app'"),
    "Ruta '/app' en publicRoutes (suprime sidebar, topbar y tabs para experiencia fullscreen)"
  )

  // 3. Validar app/app/page.tsx
  console.log('\n3️⃣  Validando app/app/page.tsx:')
  const appPagePath = path.join(rootDir, 'app', 'app', 'page.tsx')
  const appPageContent = fs.readFileSync(appPagePath, 'utf8')

  assert(
    appPageContent.includes("handleExit") && (appPageContent.includes("router.push('/dashboard')") || appPageContent.includes('router.back()')),
    'Función handleExit implementada con retorno a /dashboard'
  )
  assert(
    appPageContent.includes("isTegHost") && appPageContent.includes("vercel.app") && appPageContent.includes("localhost"),
    'Detección de entorno local y Vercel (isTegHost) para botón temporal de salida'
  )
  assert(
    appPageContent.includes("Escape") && appPageContent.includes("addEventListener('keydown'"),
    'Atajo de teclado [Escape] activo para salir hacia el panel'
  )
  assert(
    appPageContent.includes('src="/app/index.html'),
    'Iframe enlazado al bundle compilado /app/index.html'
  )

  // 4. Validar lib/i18n.tsx
  console.log('\n4️⃣  Validando lib/i18n.tsx:')
  const i18nPath = path.join(rootDir, 'lib', 'i18n.tsx')
  const i18nContent = fs.readFileSync(i18nPath, 'utf8')

  assert(
    i18nContent.includes("customer_app: 'App Clientes'") && i18nContent.includes("exit_to_teg: 'Salir al Sistema TEG'"),
    'Claves en español: customer_app y exit_to_teg presentes'
  )
  assert(
    i18nContent.includes("customer_app: 'Customer App'") && i18nContent.includes("exit_to_teg: 'Exit to TEG System'"),
    'Claves en inglés: customer_app y exit_to_teg presentes'
  )

  // 5. Validar public/app/index.html
  console.log('\n5️⃣  Validando public/app/index.html:')
  const indexPath = path.join(rootDir, 'public', 'app', 'index.html')
  const indexContent = fs.readFileSync(indexPath, 'utf8')

  assert(
    indexContent.includes('viewport-fit=cover') && indexContent.includes('mobile-web-app-capable'),
    'Meta tags PWA y viewport-fit=cover configurados para pantalla completa móvil'
  )

  // 6. Prueba HTTP real en vivo contra servidor Next.js
  console.log('\n6️⃣  Prueba HTTP en vivo en servidor local (http://localhost:3000/app):')
  await new Promise<void>((resolve) => {
    http.get('http://localhost:3000/app', (res) => {
      assert(
        res.statusCode === 200,
        `HTTP GET /app responde con código 200 OK (Recibido: ${res.statusCode})`
      )
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        assert(
          body.includes('Tacos Gavilan') || body.includes('iframe') || body.includes('/app/index.html'),
          'Cuerpo de respuesta HTTP contiene referencias al visor de la aplicación'
        )
        resolve()
      })
    }).on('error', (err) => {
      assert(false, 'Conexión HTTP al servidor local falló', err.message)
      resolve()
    })
  })

  console.log(`\n==========================================`)
  console.log(`Resultados de Auditoría: ${passed} Pasadas, ${failed} Fallidas`)
  console.log(`==========================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Error fatal en pruebas:', err)
  process.exit(1)
})
