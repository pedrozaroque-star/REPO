import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

function normalizeText(text: string): string {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()
}

async function run() {
    console.log("🚀 Starting data migration to station-based 'position_activities'...")

    // 1. Fetch all operating procedures
    const { data: procedures, error: procErr } = await supabaseAdmin
        .from('operating_procedures')
        .select('*')
    
    if (procErr || !procedures) {
        console.error("❌ Failed to fetch operating procedures:", procErr)
        return
    }
    console.log(`📋 Found ${procedures.length} activities in operating_procedures catalog.`)

    // 2. Fetch all CONFIG_ACTIVITIES templates from all stores
    const { data: templates, error: templatesErr } = await supabaseAdmin
        .from('station_templates')
        .select('*')
        .eq('template_name', '__CONFIG_ACTIVITIES__')

    if (templatesErr || !templates) {
        console.error("❌ Failed to fetch config templates:", templatesErr)
        return
    }
    console.log(`📋 Found ${templates.length} store configuration templates.`)

    // We will collect final mappings to insert
    const mappingsToInsert: any[] = []

    // 3. Process mappings from all templates (Slauson has highest priority)
    // Sort templates so Slauson (id 9625621e...) is processed last, overriding others if duplicates exist
    const slausonStoreId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'
    const sortedTemplates = [...templates].sort((a, b) => {
        if (a.store_id === slausonStoreId) return 1
        if (b.store_id === slausonStoreId) return -1
        return 0
    })

    const mergedMappings: Record<string, string[]> = {}

    for (const temp of sortedTemplates) {
        const mappings = temp.data?.station_mappings || {}
        for (const [rawKey, activitiesList] of Object.entries(mappings)) {
            if (Array.isArray(activitiesList)) {
                mergedMappings[rawKey] = activitiesList
            }
        }
    }

    console.log(`✅ Merged mappings for ${Object.keys(mergedMappings).length} station keys.`)

    // 4. Process merged mappings
    for (const [rawKey, activitiesList] of Object.entries(mergedMappings)) {
        if (!Array.isArray(activitiesList)) continue

        // Parse key: e.g. "TACOS_AM" -> station="TACOS", shift="AM"
        const suffixMatch = rawKey.match(/_([AP]M)(?:_(\d))?$/)
        const shift = suffixMatch ? suffixMatch[1] : 'AMBOS'
        const station = suffixMatch ? rawKey.replace(/_([AP]M)(?:_\d)?$/, '') : rawKey
        const dayIndex = suffixMatch ? suffixMatch[2] : undefined

        const frequency = dayIndex ? dayIndex : 'Diario'
        
        // Check if this is a Drive-Thru specific station/activity
        const sLower = station.toLowerCase()
        const isDriveThru = sLower.includes('(dt)') || sLower.includes('ventana')
        const storeModel = isDriveThru ? 'DRIVE_THRU' : 'AMBOS'

        console.log(`Processing station mapping: ${rawKey} -> Station: ${station}, Shift: ${shift}, Freq: ${frequency}, Model: ${storeModel}`)

        for (const actText of activitiesList) {
            if (!actText) continue

            // Find matching activity in procedures catalogue
            const normText = normalizeText(actText)
            const matchedProc = procedures.find(p => {
                const normProc = normalizeText(p.activity)
                return normProc === normText || normText.includes(normProc) || normProc.includes(normText)
            })

            if (matchedProc) {
                mappingsToInsert.push({
                    position_key: station, // Store the station name directly as position_key!
                    shift: shift,
                    activity_id: matchedProc.id,
                    frequency: frequency,
                    store_model: storeModel,
                    sort_order: matchedProc.start_time ? parseInt(matchedProc.start_time.split(':')[0]) * 60 + parseInt(matchedProc.start_time.split(':')[1]) : 0
                })
            } else {
                console.warn(`   ⚠️ Could not find exact catalog match for text: "${actText.substring(0, 40)}..."`)
            }
        }
    }

    // 5. Delete old cook and cashier roles from position_activities
    console.log("🧹 Cleaning up old COOK_MALE and CASHIER mappings...")
    const { error: deleteErr } = await supabaseAdmin
        .from('position_activities')
        .delete()
        .in('position_key', ['COOK_MALE', 'CASHIER'])

    if (deleteErr) {
        console.error("❌ Failed to delete old mappings:", deleteErr)
        return
    }
    console.log("✅ Cleared old COOK_MALE and CASHIER mappings.")

    // 6. Remove duplicates from our list
    const uniqueKeys = new Set<string>()
    const finalToInsert: any[] = []
    
    for (const item of mappingsToInsert) {
        const key = `${item.position_key}|${item.shift}|${item.activity_id}|${item.frequency}|${item.store_model}`
        if (!uniqueKeys.has(key)) {
            uniqueKeys.add(key)
            finalToInsert.push(item)
        }
    }

    console.log(`Inserting ${finalToInsert.length} unique station-activities mappings into database...`)

    // 7. Upsert in chunks
    const CHUNK_SIZE = 50
    let insertedCount = 0

    for (let i = 0; i < finalToInsert.length; i += CHUNK_SIZE) {
        const chunk = finalToInsert.slice(i, i + CHUNK_SIZE)
        const { error } = await supabaseAdmin
            .from('position_activities')
            .upsert(chunk, { onConflict: 'position_key,shift,activity_id,frequency,store_model' })

        if (error) {
            console.error(`❌ Failed to insert chunk starting at index ${i}:`, error)
        } else {
            insertedCount += chunk.length
            console.log(`   Inserted ${insertedCount}/${finalToInsert.length} mappings...`)
        }
    }

    console.log("🎉 Data migration finished successfully!")
}

run()
