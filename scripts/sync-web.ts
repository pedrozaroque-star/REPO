/**
 * @module scripts/sync-web
 * @description Script de sincronización automática para el sitio web de Tacos Gavilan.
 * Copia los archivos estáticos de desarrollo desde C:\Users\pedro\Desktop\tacosgavilan-web
 * hacia public/tacosgavilan-web en el proyecto TEG System, excluyendo carpetas pesadas
 * de desarrollo (screenshots, scripts de auditoría) para mantener el repositorio ligero (~24MB)
 * y permitir que el sitio web se visualice en tiempo real desde teléfonos móviles y Vercel.
 */

import path from 'path'
import fs from 'fs'

const SOURCE_DIR = 'C:\\Users\\pedro\\Desktop\\tacosgavilan-web'
const TARGET_DIR = path.join(process.cwd(), 'public', 'tacosgavilan-web')

const DIRS_TO_COPY = ['api', 'css', 'data', 'img', 'js', 'locations']
const FILES_TO_COPY = [
    'index.html',
    '404.html',
    'manifest.webmanifest',
    'robots.txt',
    'sitemap.xml',
    'vercel.json'
]

export function copyDirectoryRecursive(src: string, dest: string): number {
    if (!fs.existsSync(src)) return 0
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true })
    }

    let count = 0
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
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

export function syncTacosGavilanWeb(): { ok: boolean; copiedFiles: number; message: string } {
    if (!fs.existsSync(SOURCE_DIR)) {
        return {
            ok: false,
            copiedFiles: 0,
            message: `Origen no encontrado: ${SOURCE_DIR}`
        }
    }

    if (!fs.existsSync(TARGET_DIR)) {
        fs.mkdirSync(TARGET_DIR, { recursive: true })
    }

    let totalFiles = 0

    // Copiar archivos raíz
    for (const file of FILES_TO_COPY) {
        const srcFile = path.join(SOURCE_DIR, file)
        const destFile = path.join(TARGET_DIR, file)
        if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, destFile)
            totalFiles++
        }
    }

    // Copiar directorios esenciales
    for (const dir of DIRS_TO_COPY) {
        const srcDir = path.join(SOURCE_DIR, dir)
        const destDir = path.join(TARGET_DIR, dir)
        if (fs.existsSync(srcDir)) {
            totalFiles += copyDirectoryRecursive(srcDir, destDir)
        }
    }

    return {
        ok: true,
        copiedFiles: totalFiles,
        message: `Sincronización exitosa: ${totalFiles} archivos copiados a public/tacosgavilan-web`
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
