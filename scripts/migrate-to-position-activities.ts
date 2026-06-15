import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

// Helper to clean and normalize text for comparison
function normalizeText(text: string): string {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()
}

async function run() {
    console.log("🚀 Starting data migration to 'position_activities'...")

    // 1. Fetch all operating procedures
    const { data: procedures, error: procErr } = await supabaseAdmin
        .from('operating_procedures')
        .select('*')
    
    if (procErr || !procedures) {
        console.error("❌ Failed to fetch operating procedures:", procErr)
        return
    }
    console.log(`📋 Found ${procedures.length} activities in operating_procedures catalog.`)

    // 2. Fetch Slauson's station config template
    const { data: slausonConfig, error: configErr } = await supabaseAdmin
        .from('station_templates')
        .select('*')
        .eq('template_name', '__CONFIG_ACTIVITIES__')
        .eq('store_id', '9625621e-1b5e-48d7-87ae-7094fab5a4fd')
        .single()

    if (configErr || !slausonConfig) {
        console.error("❌ Failed to fetch Slauson's config template:", configErr)
        return
    }
    
    const mappings = slausonConfig.data?.station_mappings || {}
    console.log(`✅ Loaded Slauson station mappings for ${Object.keys(mappings).length} station keys.`)

    // We will collect the migration records
    const positionActivitiesToInsert: any[] = []

    // Helper to resolve role position key from raw station name
    function getPositionKeyForStation(station: string): string {
        const s = station.toLowerCase()
        if (['tacos', 'carnes', 'burritos', 'preparacion', 'preparador', 'tortas/mulitas', 'tortas/quesadillas', 'tortillas', 'tacos/burritos (dt)', 'tortas/quesadillas (dt)'].some(k => s.includes(k))) {
            return 'COOK_MALE'
        }
        if (['caja', 'salon', 'salón', 'ventana', 'uber', 'salsas', 'limpieza', 'entrega', 'cubrir descansos'].some(k => s.includes(k))) {
            return 'CASHIER'
        }
        return 'CASHIER' // Default fallback
    }

    // 3. Process Slauson's station_mappings
    for (const [rawKey, activitiesList] of Object.entries(mappings)) {
        if (!Array.isArray(activitiesList)) continue

        // Parse key: e.g. "CARNES_AM" -> station="CARNES", shift="AM"
        const suffixMatch = rawKey.match(/_([AP]M)(?:_(\d))?$/)
        const shift = suffixMatch ? suffixMatch[1] : 'AMBOS'
        const station = suffixMatch ? rawKey.replace(/_([AP]M)(?:_\d)?$/, '') : rawKey
        const dayIndex = suffixMatch ? suffixMatch[2] : undefined

        const positionKey = getPositionKeyForStation(station)
        const frequency = dayIndex ? dayIndex : 'Diario'
        
        // Check if this is a Drive-Thru specific station/activity
        const isDriveThru = station.toLowerCase().includes('(dt)') || station.toLowerCase().includes('ventana')
        const storeModel = isDriveThru ? 'DRIVE_THRU' : 'AMBOS'

        console.log(`Processing Slauson mapping: ${rawKey} -> Position: ${positionKey}, Shift: ${shift}, Freq: ${frequency}, DT: ${isDriveThru}`)

        for (const actText of activitiesList) {
            if (!actText) continue

            // Find matching activity in procedures catalogue
            const normText = normalizeText(actText)
            const matchedProc = procedures.find(p => normalizeText(p.activity) === normText || normText.includes(normalizeText(p.activity)) || normalizeText(p.activity).includes(normText))

            if (matchedProc) {
                positionActivitiesToInsert.push({
                    position_key: positionKey,
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

    // 4. Map management/leadership activities from operating_procedures directly
    console.log("💼 Mapping leadership and administrative tasks directly from procedures...")
    for (const proc of procedures) {
        // Map Asistente/SL tasks to Assistant and Shift Leaders
        if (proc.role === 'Asistente/SL') {
            const shift = proc.shift_type === 'Apertura' ? 'AM' : (proc.shift_type === 'Cierre' ? 'PM' : 'AMBOS')
            const sortOrder = proc.start_time ? parseInt(proc.start_time.split(':')[0]) * 60 + parseInt(proc.start_time.split(':')[1]) : 0

            // Add for ASSISTANT
            positionActivitiesToInsert.push({
                position_key: 'ASSISTANT',
                shift: shift,
                activity_id: proc.id,
                frequency: proc.frequency || 'Diario',
                store_model: 'AMBOS',
                sort_order: sortOrder
            })
            // Add for SHIFT_LEADER_MALE
            positionActivitiesToInsert.push({
                position_key: 'SHIFT_LEADER_MALE',
                shift: shift,
                activity_id: proc.id,
                frequency: proc.frequency || 'Diario',
                store_model: 'AMBOS',
                sort_order: sortOrder
            })
            // Add for SHIFT_LEADER_FEMALE
            positionActivitiesToInsert.push({
                position_key: 'SHIFT_LEADER_FEMALE',
                shift: shift,
                activity_id: proc.id,
                frequency: proc.frequency || 'Diario',
                store_model: 'AMBOS',
                sort_order: sortOrder
            })
        }

        // Map Manager tasks to MANAGER
        const titleLower = (proc.activity || '').toLowerCase()
        if (proc.role === 'Manager' || titleLower.includes('corte') || titleLower.includes('deposito') || titleLower.includes('orden a la bodega') || titleLower.includes('desactivar alarma') || titleLower.includes('cash drop')) {
            const shift = proc.shift_type === 'Apertura' ? 'AM' : (proc.shift_type === 'Cierre' ? 'PM' : 'AMBOS')
            const sortOrder = proc.start_time ? parseInt(proc.start_time.split(':')[0]) * 60 + parseInt(proc.start_time.split(':')[1]) : 0

            positionActivitiesToInsert.push({
                position_key: 'MANAGER',
                shift: shift,
                activity_id: proc.id,
                frequency: proc.frequency || 'Diario',
                store_model: 'AMBOS',
                sort_order: sortOrder
            })
        }
    }

    // 5. Remove duplicates from our list
    const uniqueKeys = new Set<string>()
    const finalToInsert: any[] = []
    
    for (const item of positionActivitiesToInsert) {
        const key = `${item.position_key}|${item.shift}|${item.activity_id}|${item.frequency}|${item.store_model}`
        if (!uniqueKeys.has(key)) {
            uniqueKeys.add(key)
            finalToInsert.push(item)
        }
    }

    console.log(`Inserting ${finalToInsert.length} unique position-activities mappings into database...`)

    // Let's insert in chunks of 50 to avoid any size limits
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
