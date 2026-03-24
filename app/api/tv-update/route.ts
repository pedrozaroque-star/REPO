import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const screenParam = parseInt(searchParams.get('screen') || '1', 10)
        let storeParam = searchParams.get('store') || 'ALL'
        storeParam = storeParam.toUpperCase()

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const supabase = createClient(supabaseUrl, supabaseKey)

        const { data: imgs, error } = await supabase
            .from('tv_images')
            .select('*')
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
            return NextResponse.json({ url: activeImage.storage_path })
        } else {
            return NextResponse.json({ error: 'No menu assigned' }, { status: 404 })
        }
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
