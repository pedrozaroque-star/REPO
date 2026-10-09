/**
 * @module app/api/web-preview/[[...slug]]/route
 * @description Servidor de archivos estáticos y puente de previsualización en vivo para el nuevo diseño web de Tacos Gavilan.
 * Permite renderizar y probar en tiempo real el sitio web estático desarrollado localmente en
 * file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html dentro de un iframe o en pestaña independiente,
 * evitando las restricciones de seguridad del navegador para esquemas file:///.
 * 
 * @businessRules
 * - **Fuente Oficial en Desarrollo**: Lee en tiempo real directamente de C:\Users\pedro\Desktop\tacosgavilan-web
 *   sin requerir re-compilaciones ni copias manuales.
 * - **Fallback de Producción**: Si el directorio local no existe, busca en public/tacosgavilan-web.
 * - **Seguridad y Aislamiento**: Bloquea ataques de Directory Traversal (../) validando que la ruta resuelta
 *   inicie estrictamente con el directorio raíz base autorizado.
 * - **Lanzador Local Nativo**: El endpoint POST /api/web-preview/launch o GET con ?action=launch permite
 *   abrir file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html directamente en el navegador del sistema operativo
 *   sin restricciones de sandbox web.
 * - **Cero Caché en Desarrollo**: Encabezados Cache-Control 'no-cache, no-store, must-revalidate' para reflejar
 *   cualquier cambio de código al instante.
 * 
 * @dataFlow
 * - Cliente (Iframe o Nueva Pestaña) -> GET /api/web-preview/[...slug] -> Node fs.readFile -> Response (Stream / Buffer con Content-Type).
 * - Cliente (Lanzador) -> POST /api/web-preview/launch -> child_process.exec -> Windows shell (cmd /c start ...).
 * 
 * @notes
 * - La extensión [[...slug]] de Next.js App Router captura tanto la raíz (/api/web-preview) como cualquier
 *   recurso anidado (/api/web-preview/css/style.css, /api/web-preview/img/hero-bg.webp, etc.).
 */

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { exec } from 'child_process'

const LOCAL_WEB_DIR = 'C:\\Users\\pedro\\Desktop\\tacosgavilan-web'
const FALLBACK_WEB_DIR = path.join(process.cwd(), 'public', 'tacosgavilan-web')

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
}

function resolveBaseDir(): string | null {
    if (fs.existsSync(LOCAL_WEB_DIR)) {
        return LOCAL_WEB_DIR
    }
    if (fs.existsSync(FALLBACK_WEB_DIR)) {
        return FALLBACK_WEB_DIR
    }
    return null
}

export async function GET(
    request: Request,
    context: { params: Promise<{ slug?: string[] }> }
) {
    const { slug } = await context.params
    const url = new URL(request.url)
    const action = url.searchParams.get('action')

    // Acción para consultar estado de disponibilidad del archivo local
    if (action === 'status' || (slug?.length === 1 && slug[0] === 'status')) {
        const localExists = fs.existsSync(LOCAL_WEB_DIR)
        const indexPath = path.join(LOCAL_WEB_DIR, 'index.html')
        const indexExists = fs.existsSync(indexPath)
        let lastModified: string | null = null
        if (indexExists) {
            const stats = fs.statSync(indexPath)
            lastModified = stats.mtime.toISOString()
        }
        return Response.json({
            ok: true,
            localDir: LOCAL_WEB_DIR,
            exists: indexExists,
            lastModified,
            fileUrl: 'file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html'
        })
    }

    // Acción para abrir directamente en el navegador del sistema operativo
    if (action === 'launch' || (slug?.length === 1 && slug[0] === 'launch')) {
        return handleLaunch()
    }

    const baseDir = resolveBaseDir()
    if (!baseDir) {
        return new Response('Directory tacosgavilan-web not found', { status: 404 })
    }

    // Determinar la ruta relativa del archivo solicitado
    const slugParts = slug || []
    let relativePath = slugParts.join('/')

    if (!relativePath || relativePath === '') {
        relativePath = 'index.html'
    }

    const targetPath = path.resolve(baseDir, relativePath)

    // Seguridad: Prevenir Directory Traversal
    if (!targetPath.startsWith(path.resolve(baseDir))) {
        return new Response('Forbidden: Invalid path traversal', { status: 403 })
    }

    // Si es un directorio, buscar index.html dentro de él
    let finalPath = targetPath
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).isDirectory()) {
        finalPath = path.join(finalPath, 'index.html')
    }

    if (!fs.existsSync(finalPath)) {
        return new Response(`File not found: ${relativePath}`, { status: 404 })
    }

    try {
        const ext = path.extname(finalPath).toLowerCase()
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
        const fileBuffer = await fs.promises.readFile(finalPath)

        return new Response(fileBuffer, {
            headers: {
                'Content-Type': mimeType,
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        })
    } catch (error: any) {
        return new Response(`Error reading file: ${error?.message}`, { status: 500 })
    }
}

export async function POST(
    request: Request,
    context: { params: Promise<{ slug?: string[] }> }
) {
    const { slug } = await context.params
    if (slug?.length === 1 && slug[0] === 'launch') {
        return handleLaunch()
    }
    return Response.json({ error: 'Endpoint not found' }, { status: 404 })
}

function handleLaunch() {
    const indexPath = path.join(LOCAL_WEB_DIR, 'index.html')
    if (!fs.existsSync(indexPath)) {
        return Response.json({
            ok: false,
            error: 'El archivo index.html no existe en ' + LOCAL_WEB_DIR
        }, { status: 404 })
    }

    try {
        // En Windows, cmd /c start "" "C:\..." lanza el navegador predeterminado con el archivo local
        exec(`cmd.exe /c start "" "${indexPath}"`)
        return Response.json({
            ok: true,
            message: 'Abriendo en navegador predeterminado...',
            fileUrl: 'file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html'
        })
    } catch (err: any) {
        return Response.json({
            ok: false,
            error: err?.message || 'Error al ejecutar comando start en el sistema operativo'
        }, { status: 500 })
    }
}
