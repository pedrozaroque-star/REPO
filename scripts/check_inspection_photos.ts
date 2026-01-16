// Script para verificar las fotos de las inspecciones
// Ejecutar con: npx tsx scripts/check_inspection_photos.ts

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkPhotos() {
    console.log('\n🔍 Verificando fotos de inspecciones recientes...\n')

    // Get latest 5 inspections
    const { data, error } = await supabase
        .from('supervisor_inspections')
        .select('id, store_id, inspection_date, photos, answers')
        .order('created_at', { ascending: false })
        .limit(5)

    if (error) {
        console.error('❌ Error:', error.message)
        return
    }

    for (const inspection of data || []) {
        console.log('-----------------------------------')
        console.log(`📋 Inspección ID: ${inspection.id}`)
        console.log(`📅 Fecha: ${inspection.inspection_date}`)

        // Check photos field
        const photos = inspection.photos
        console.log(`📸 Tipo de "photos": ${typeof photos}`)

        if (Array.isArray(photos)) {
            console.log(`   • Es un array con ${photos.length} elementos`)
            if (photos.length > 0) {
                console.log(`   • Primer elemento: ${JSON.stringify(photos[0]).substring(0, 100)}...`)
            }
        } else if (typeof photos === 'string') {
            console.log(`   • Es un string de ${photos.length} caracteres`)
            console.log(`   • Contenido: ${photos.substring(0, 200)}...`)
        } else if (typeof photos === 'object' && photos !== null) {
            console.log(`   • Es un objeto con keys: ${Object.keys(photos).join(', ')}`)
        } else {
            console.log(`   • Valor: ${photos}`)
        }

        // Check __question_photos in answers
        const answers = inspection.answers
        if (answers && answers['__question_photos']) {
            const qPhotos = answers['__question_photos']
            const allUrls: string[] = []

            for (const [key, val] of Object.entries(qPhotos)) {
                if (Array.isArray(val)) {
                    allUrls.push(...val as string[])
                }
            }

            console.log(`📷 Fotos en answers.__question_photos: ${allUrls.length}`)
        }

        console.log('')
    }
}

checkPhotos()
