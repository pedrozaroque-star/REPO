/**
 * @module api/tv-update/route
 * @description Endpoint público de consulta de imagen activa para pantallas TV de menú en comedor de Tacos Gavilan.
 * @businessRules
 * - Resuelve la imagen asignada a un par `(screen, store)` priorizando variación específica de sucursal sobre la imagen universal.
 * - Datos 100% públicos (sin sesión ni estado de usuario), idénticos para cualquier pantalla que consulte los mismos parámetros `screen` y `store`.
 * @dataFlow
 * - Pantalla TV (`/tv`) -> GET `/api/tv-update?screen=1&store=LYNWOOD` -> Vercel Edge CDN (`s-maxage=300`, `stale-while-revalidate=600`) -> Supabase (`tv_images`) -> `{ url }`.
 * @notes
 * - [2026-11-19] Agregado `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` en respuestas 200, validación segura de `screen` contra `NaN` y proyección explícita de columnas (`storage_path, is_universal, store_assignments`).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const parsedScreen = parseInt(searchParams.get('screen') || '1', 10)
        const screenParam = Number.isFinite(parsedScreen) && parsedScreen > 0 ? parsedScreen : 1
        let storeParam = searchParams.get('store') || 'ALL'
        storeParam = storeParam.toUpperCase()

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const supabase = createClient(supabaseUrl, supabaseKey)

        const { data: imgs, error } = await supabase
            .from('tv_images')
            .select('storage_path, is_universal, store_assignments')
            .eq('screen_number', screenParam)
            .order('sort_order', { ascending: true })

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (!imgs || imgs.length === 0) return NextResponse.json({ error: 'No images' }, { status: 404 })

        const variationImages = imgs.filter(img =>
            img.is_universal === false &&
            Array.isArray(img.store_assignments) &&
            img.store_assignments.includes(storeParam)
        )
        const universalImages = imgs.filter(img => img.is_universal === true)

        let activeImage = null
        if (variationImages.length > 0) {
            activeImage = variationImages[0]
        } else if (universalImages.length > 0) {
            activeImage = universalImages[0]
        }

        if (activeImage) {
            return NextResponse.json(
                { url: activeImage.storage_path },
                {
                    headers: {
                        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
                    }
                }
            )
        } else {
            return NextResponse.json({ error: 'No menu assigned' }, { status: 404 })
        }
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
