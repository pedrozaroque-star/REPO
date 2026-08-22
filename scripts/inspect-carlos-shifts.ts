import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

try {
    const envPath = path.resolve(process.cwd(), '.env.local')
    const envConfig = dotenv.parse(fs.readFileSync(envPath))
    for (const k in envConfig) {
        process.env[k] = envConfig[k]
    }
} catch (e) {
    console.warn("⚠️ No se pudo leer .env.local")
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false }
})

async function checkShifts() {
    console.log('\n📅 BUSCANDO TURNOS DE CARLOS VELAZQUEZ EN EL PLANIFICADOR (TABLA SHIFTS)')
    console.log('='.repeat(70))

    // 1. Get Carlos employee records
    const { data: carlosEmps } = await supabase
        .from('toast_employees')
        .select('*')
        .eq('email', 'carlos@tacosgavilan.com')

    console.log(`Empleados activos de Carlos Velazquez (${carlosEmps?.length || 0}):`)
    const carlosIds = carlosEmps?.map(e => e.id) || []
    const carlosGuids = carlosEmps?.map(e => e.toast_guid) || []
    const allCarlosIds = [...new Set([...carlosIds, ...carlosGuids])]

    carlosEmps?.forEach(e => {
        console.log(`- ID: ${e.id} | Toast GUID: ${e.toast_guid} | Name: ${e.first_name} ${e.last_name} | Deleted: ${e.deleted} | Stores: ${JSON.stringify(e.store_ids)}`)
    })

    // 2. Query shifts table for Carlos in August 2026
    const { data: shifts, error: shiftErr } = await supabase
        .from('shifts')
        .select('*')
        .gte('shift_date', '2026-08-01')
        .lte('shift_date', '2026-08-31')
        .in('employee_id', allCarlosIds)
        .order('shift_date', { ascending: true })

    console.log(`\nTurnos encontrados para Carlos en shifts (${shifts?.length || 0}):`, shiftErr)
    if (shifts && shifts.length > 0) {
        shifts.forEach(s => {
            const start = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })
            const end = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })
            const diffHours = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / (1000 * 60 * 60)
            console.log(`  ${s.shift_date}: ${start} - ${end} (${diffHours.toFixed(1)} hrs) | Store: ${s.store_id} | Status: ${s.status}`)
        })
    }

    // 3. Also check all shifts in Lynwood store for August 2026
    const { data: lynwoodStore } = await supabase
        .from('stores')
        .select('*')
        .ilike('name', '%lynwood%')
        .single()

    if (lynwoodStore) {
        console.log(`\nConsultando todos los turnos de Lynwood (${lynwoodStore.name} - ID: ${lynwoodStore.id})...`)
        const { data: lynwoodShifts } = await supabase
            .from('shifts')
            .select('*')
            .eq('store_id', lynwoodStore.id)
            .gte('shift_date', '2026-08-01')
            .lte('shift_date', '2026-08-31')
            .order('shift_date', { ascending: true })

        console.log(`Total turnos en Lynwood en Agosto: ${lynwoodShifts?.length || 0}`)
        
        // Find Carlos shifts in Lynwood
        const carlosLynwood = lynwoodShifts?.filter(s => allCarlosIds.includes(s.employee_id))
        console.log(`Turnos de Carlos en Lynwood (${carlosLynwood?.length || 0}):`)
        carlosLynwood?.forEach(s => {
            const start = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })
            const end = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })
            const diffHours = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / (1000 * 60 * 60)
            console.log(`  ${s.shift_date}: ${start} - ${end} (${diffHours.toFixed(1)}h) | Status: ${s.status}`)
        })
    }

    // 4. Also check punches for Carlos by toast_guid or employee_id
    console.log('\nConsultando punches de Carlos por toast_guid...')
    const { data: punches } = await supabase
        .from('punches')
        .select('*')
        .gte('business_date', '2026-08-01')
        .lte('business_date', '2026-08-31')
        .in('employee_guid', allCarlosIds)
        .order('business_date', { ascending: true })

    console.log(`Punches encontrados por employee_guid (${punches?.length || 0}):`, punches)
}

checkShifts()
