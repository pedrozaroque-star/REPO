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
    sidebarContent.includes('openInNewTab: true') && sidebarContent.includes('badgeIcon'),
    'App Clientes configurado con openInNewTab: true y badgeIcon en AppSidebar.tsx'
  )
  assert(
    sidebarContent.includes("t('items.customer_app')"),
    'Nombre bilingüe usando t(items.customer_app) en AppSidebar.tsx'
  )
  assert(
    sidebarContent.includes("'asistente', 'manager', 'supervisor', 'admin'"),
    'Roles completos autorizados (admin, manager, supervisor, asistente)'
  )

  // 2. Validar ClientLayout.tsx y middleware.ts
  console.log('\n2️⃣  Validando components/ClientLayout.tsx y middleware.ts:')
  const layoutPath = path.join(rootDir, 'components', 'ClientLayout.tsx')
  const layoutContent = fs.readFileSync(layoutPath, 'utf8')
  const middlewareContent = fs.readFileSync(path.join(rootDir, 'middleware.ts'), 'utf8')

  assert(
    layoutContent.includes("'/app/privacy'") &&
      layoutContent.includes("'/app/terms'") &&
      layoutContent.includes("'/app/support'") &&
      layoutContent.includes("'/app/delete-account'") &&
      layoutContent.includes("currentPath === '/app/v1'") &&
      layoutContent.includes("currentPath === '/app/v2'") &&
      layoutContent.includes('<ProtectedRoute>'),
    'Rutas legales públicas separadas de /app, /app/v1 y /app/v2 protegidos con <ProtectedRoute>'
  )
  assert(
    middlewareContent.includes("pathname === '/app'") && middlewareContent.includes("'/login'"),
    'middleware.ts protege /app, /app/v1, /app/v2 y /ordenar redirigiendo a /login sin sesión TEG'
  )

  // 3. Validar app/app/page.tsx
  console.log('\n3️⃣  Validando app/app/page.tsx:')
  const appPagePath = path.join(rootDir, 'app', 'app', 'page.tsx')
  const appPageContent = fs.readFileSync(appPagePath, 'utf8')

  assert(
    appPageContent.includes('exitTestFullscreen'),
    'Función exitTestFullscreen implementada para salir de Test Fullscreen'
  )
  assert(
    appPageContent.includes("event.key === 'Escape'") && appPageContent.includes("addEventListener('keydown'"),
    'Atajo de teclado [Escape] activo para salir del modo fullscreen'
  )
  assert(
    appPageContent.includes('src="/app/index.html?nosplash=1"'),
    'Iframe V1 enlazado al bundle compilado /app/index.html?nosplash=1'
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

  // 6. Prueba HTTP real en vivo contra servidor Next.js (middleware TEG + rutas públicas)
  console.log('\n6️⃣  Prueba HTTP en vivo en servidor local (http://localhost:3000):')
  const httpCheck = (route: string) =>
    new Promise<{ status: number; location: string; body: string }>((resolve) => {
      http
        .get(`http://localhost:3000${route}`, (res) => {
          let body = ''
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              location: String(res.headers.location || ''),
              body,
            })
          })
        })
        .on('error', () => {
          resolve({ status: 0, location: '', body: '' })
        })
    })

  for (const protectedRoute of ['/app', '/app/v1', '/app/v2', '/ordenar']) {
    const res = await httpCheck(protectedRoute)
    assert(
      res.status === 307 && res.location.includes('/login'),
      `HTTP GET ${protectedRoute} sin sesión responde 307 -> /login (Recibido: ${res.status} -> ${res.location})`
    )
  }

  for (const publicRoute of ['/app/index.html', '/app/privacy']) {
    const res = await httpCheck(publicRoute)
    assert(
      res.status === 200 && res.body.length > 0,
      `HTTP GET ${publicRoute} responde 200 OK público (Recibido: ${res.status})`
    )
  }

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
