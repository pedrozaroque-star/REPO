/**
 * @module scripts/sync-web
 * @description Script de sincronización segura para el espejo estático del sitio web de Tacos Gavilan.
 * Copia únicamente los recursos estáticos públicos desde `C:\Users\pedro\Desktop\tacosgavilan-web`
 * hacia `public/tacosgavilan-web` en TEG System para el visor ejecutivo `/nueva-web`, excluyendo y
 * purgando activamente código de backend (`api/`), configuraciones de plataforma (`vercel.json`),
 * artefactos de auditoría y directorios heredados de WordPress (`wp-content/`, `wp-includes/`).
 *
 * @businessRules
 * - **Aislamiento Estricto de Backend**: `public/tacosgavilan-web/` es servido públicamente por Next.js / Vercel Static CDN;
 *   JAMÁS debe contener funciones serverless (`api/`), `vercel.json`, reportes internos de auditoría ni archivos `.env*`.
 * - **Purga Activa**: En cada ejecución elimina de `public/tacosgavilan-web/` cualquier ruta prohibida preexistente.
 *
 * @dataFlow
 * - `C:\Users\pedro\Desktop\tacosgavilan-web` (HTML, CSS, JS, imágenes, PDF, manifiestos) -> `public/tacosgavilan-web/`.
 *
 * @notes
 * - Endurecido en pase de seguridad 2026-11 (`FORBIDDEN_PUBLIC_ENTRIES` + limpieza automática con `fs.rmSync`).
 */

import path from 'path'
import fs from 'fs'

const SOURCE_DIR = 'C:\\Users\\pedro\\Desktop\\tacosgavilan-web'
const TARGET_DIR = path.join(process.cwd(), 'public', 'tacosgavilan-web')

const FORBIDDEN_PUBLIC_ENTRIES = new Set([
    'api',
    'vercel.json',
    'axe-audit-results.json',
    'e2e-compliance-verification.json',
    'wp-content',
    'wp-includes',
    'scripts',
    'tests',
    'screenshots',
    'assets_source_backup',
    '.git',
    '.vercel',
    '.vercelignore',
    '.gitignore',
    '.env',
    '.env.local'
])

const PATHS_TO_PURGE_FROM_PUBLIC = [
    'api',
    'vercel.json',
    'axe-audit-results.json',
    'e2e-compliance-verification.json',
    'wp-content',
    'wp-includes'
]

const DIRS_TO_COPY = [
    'accessibility',
    'blog',
    'contact',
    'css',
    'data',
    'fiesta-platter',
    'img',
    'js',
    'locations',
    'menu',
    'privacy',
    'privacy-choices',
    'terms'
]

const FILES_TO_COPY = [
    'index.html',
    '404.html',
    'accessibility.html',
    'privacy.html',
    'privacy-choices.html',
    'terms.html',
    'Gavilan-Party-Tray-Brochure-WEB.pdf',
    'manifest.webmanifest',
    'robots.txt',
    'sitemap.xml'
]

function isForbiddenEntry(name: string): boolean {
    const clean = name.trim()
    if (!clean || clean.startsWith('.')) return true
    return FORBIDDEN_PUBLIC_ENTRIES.has(clean) || FORBIDDEN_PUBLIC_ENTRIES.has(clean.toLowerCase())
}

export function purgeForbiddenPublicPaths(targetRoot: string = TARGET_DIR): string[] {
    const removed: string[] = []
    if (!fs.existsSync(targetRoot)) return removed

    for (const rel of PATHS_TO_PURGE_FROM_PUBLIC) {
        const fullTarget = path.join(targetRoot, rel)
        if (fs.existsSync(fullTarget)) {
            fs.rmSync(fullTarget, { recursive: true, force: true })
            removed.push(rel)
        }
    }
    return removed
}

export function copyDirectoryRecursive(src: string, dest: string): number {
    if (!fs.existsSync(src)) return 0
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true })
    }

    let count = 0
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
        if (isForbiddenEntry(entry.name)) continue

        const srcPath = path.join(src, entry.name)
        const destPath = path.join(dest, entry.name)

        if (entry.isDirectory()) {
            count += copyDirectoryRecursive(srcPath, destPath)
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath)
            count++
        }
    }
    return count
}

export function syncTacosGavilanWeb(): { ok: boolean; copiedFiles: number; purgedPaths: string[]; message: string } {
    if (!fs.existsSync(SOURCE_DIR)) {
        const purgedPaths = purgeForbiddenPublicPaths(TARGET_DIR)
        return {
            ok: false,
            copiedFiles: 0,
            purgedPaths,
            message: `Origen no encontrado (${purgedPaths.length} rutas prohibidas purgadas)`
        }
    }

    if (!fs.existsSync(TARGET_DIR)) {
        fs.mkdirSync(TARGET_DIR, { recursive: true })
    }

    // Purgar primero cualquier archivo/directorio prohibido existente en public/tacosgavilan-web
    const purgedPaths = purgeForbiddenPublicPaths(TARGET_DIR)

    let totalFiles = 0

    // Copiar archivos raíz permitidos
    for (const file of FILES_TO_COPY) {
        if (isForbiddenEntry(file)) continue
        const srcFile = path.join(SOURCE_DIR, file)
        const destFile = path.join(TARGET_DIR, file)
        if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, destFile)
            totalFiles++
        }
    }

    // Copiar directorios estáticos esenciales
    for (const dir of DIRS_TO_COPY) {
        if (isForbiddenEntry(dir)) continue
        const srcDir = path.join(SOURCE_DIR, dir)
        const destDir = path.join(TARGET_DIR, dir)
        if (fs.existsSync(srcDir)) {
            totalFiles += copyDirectoryRecursive(srcDir, destDir)
        }
    }

    // Verificación post-copia: garantizar cero fugas en public/tacosgavilan-web
    purgeForbiddenPublicPaths(TARGET_DIR)

    const purgeNote = purgedPaths.length > 0 ? ` (${purgedPaths.length} rutas prohibidas eliminadas: ${purgedPaths.join(', ')})` : ''
    return {
        ok: true,
        copiedFiles: totalFiles,
        purgedPaths,
        message: `Sincronización exitosa: ${totalFiles} archivos copiados a public/tacosgavilan-web${purgeNote}`
    }
}

// Ejecución directa por CLI
if (require.main === module) {
    console.log('🔄 Sincronizando tacosgavilan-web -> public/tacosgavilan-web...')
    const result = syncTacosGavilanWeb()
    if (result.ok) {
        console.log(`✅ ${result.message}`)
    } else {
        console.error(`❌ ${result.message}`)
        process.exit(1)
    }
}
