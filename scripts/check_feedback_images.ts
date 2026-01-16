// Script para verificar las URLs de imágenes del Feedback #692
// Ejecutar con: npx tsx scripts/check_feedback_images.ts

import { config } from 'dotenv'
import { resolve } from 'path'

// Cargar variables de entorno
config({ path: resolve(__dirname, '../.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkFeedbackImages() {
    console.log('\n🔍 Buscando Feedback ID #692...\n')

    const { data, error } = await supabase
        .from('customer_feedback')
        .select('*')
        .eq('id', 692)
        .single()

    if (error) {
        console.error('❌ Error:', error.message)
        return
    }

    if (!data) {
        console.log('⚠️ No se encontró el feedback con ID 692')
        return
    }

    console.log('✅ Feedback encontrado:\n')
    console.log('-----------------------------------')
    console.log(`📍 Tienda ID: ${data.store_id}`)
    console.log(`📅 Fecha: ${data.submission_date}`)
    console.log(`⭐ NPS Score: ${data.nps_score}`)
    console.log(`💬 Comentario: ${data.comments}`)
    console.log('-----------------------------------\n')

    // Verificar campo de fotos
    const photoFields = ['photos', 'photo_urls', 'evidence_urls', 'images', 'photo_evidence']

    console.log('📸 Campos de imágenes encontrados:\n')

    for (const field of photoFields) {
        if (data[field] !== undefined) {
            console.log(`  ${field}:`, data[field])
        }
    }

    // Mostrar todos los campos del registro
    console.log('\n📋 Todos los campos del registro:\n')
    console.log(JSON.stringify(data, null, 2))

    // Si hay URLs, verificar si son accesibles
    const urls = data.photos || data.photo_urls || data.evidence_urls || data.images || []

    if (Array.isArray(urls) && urls.length > 0) {
        console.log('\n🔗 Verificando accesibilidad de URLs:\n')
        for (const url of urls) {
            try {
                const response = await fetch(url, { method: 'HEAD' })
                const status = response.ok ? '✅ Accesible' : `❌ Error ${response.status}`
                console.log(`  ${status}: ${url.substring(0, 80)}...`)
            } catch (e: any) {
                console.log(`  ❌ No accesible: ${url.substring(0, 80)}... (${e.message})`)
            }
        }
    } else {
        console.log('\n⚠️ No se encontraron URLs de imágenes en campos estándar')
    }
}

checkFeedbackImages()
