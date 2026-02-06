/**
 * Diagnostic Script: Analyze Leadership Day-Off Patterns
 * 
 * Uses punch history joined with toast_jobs to identify leaders and their schedules.
 * 
 * Run with: npx ts-node scripts/analyze-leadership-schedules.ts
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

// Load environment variables
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

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Faltan variables de entorno Supabase")
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
})

// Leadership role keywords
const LEADERSHIP_KEYWORDS = ['SHIFT LEADER', 'MANAGER', 'ASST', 'JEFE', 'ENCARGADO', 'SUPERVISOR']
const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

async function analyzeLeadershipSchedules() {
    console.log('\n📊 ANÁLISIS DE PATRONES DE DESCANSO DE LÍDERES')
    console.log('='.repeat(60))

    // 1. Get store info
    const { data: store } = await supabase
        .from('stores')
        .select('external_id, name')
        .ilike('name', `%Lynwood%`)
        .single()

    if (!store) {
        console.error('❌ Store not found')
        return
    }

    console.log(`\n🏪 Tienda: ${store.name}`)
    console.log(`   ID: ${store.external_id}`)

    // 2. First, get all job titles from toast_jobs to see what exists
    const { data: jobs } = await supabase
        .from('toast_jobs')
        .select('id, guid, title')

    if (!jobs || jobs.length === 0) {
        console.error('❌ No jobs found in toast_jobs')
        return
    }

    console.log(`\n🔍 Encontrados ${jobs.length} puestos de trabajo:`)
    jobs.forEach(j => console.log(`   - ${j.title} (${j.guid?.slice(0, 8)}...)`))

    // Create job GUID to title map
    const jobMap: Record<string, string> = {}
    jobs.forEach(j => {
        if (j.guid) jobMap[j.guid] = j.title
    })

    // Find leadership job GUIDs
    const leadershipJobGuids = jobs
        .filter(j => LEADERSHIP_KEYWORDS.some(k => j.title?.toUpperCase().includes(k)))
        .map(j => j.guid)
        .filter(Boolean)

    console.log(`\n👔 Puestos de liderazgo:`)
    leadershipJobGuids.forEach(guid => console.log(`   - ${jobMap[guid!]} (${guid?.slice(0, 8)}...)`))

    if (leadershipJobGuids.length === 0) {
        console.error('❌ No leadership jobs found matching keywords')
        return
    }

    // 3. Get punch history for this store with leadership jobs (last 90 days)
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 90)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    let allPunches: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
        const { data, error } = await supabase
            .from('punches')
            .select('employee_toast_guid, business_date, job_toast_guid, clock_in')
            .eq('store_id', store.external_id)
            .in('job_toast_guid', leadershipJobGuids)
            .gte('business_date', cutoffStr)
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            console.error('Punch query error:', error)
            break
        }
        if (data) {
            allPunches = allPunches.concat(data)
            if (data.length < pageSize) hasMore = false
        } else {
            hasMore = false
        }
        page++
    }

    console.log(`\n📅 Encontradas ${allPunches.length} ponchadas de líderes (últimos 90 días)`)

    // 4. Get employee names
    const employeeGuids = [...new Set(allPunches.map(p => p.employee_toast_guid).filter(Boolean))]

    const { data: employees } = await supabase
        .from('toast_employees')
        .select('toast_guid, v2_toast_guid, first_name, last_name')
        .eq('deleted', false)

    const empMap: Record<string, string> = {}
    employees?.forEach(e => {
        const name = `${e.first_name} ${e.last_name}`
        if (e.toast_guid) empMap[e.toast_guid] = name
        if (e.v2_toast_guid) empMap[e.v2_toast_guid] = name
    })

    // 5. Analyze each leader
    console.log('\n' + '═'.repeat(60))
    console.log('PATRONES DE TRABAJO POR LÍDER')
    console.log('═'.repeat(60))

    const summaryByDay: {
        amKitchen: number[], amFoh: number[],
        pmKitchen: number[], pmFoh: number[]
    } = {
        amKitchen: [0, 0, 0, 0, 0, 0, 0],
        amFoh: [0, 0, 0, 0, 0, 0, 0],
        pmKitchen: [0, 0, 0, 0, 0, 0, 0],
        pmFoh: [0, 0, 0, 0, 0, 0, 0]
    }

    for (const guid of employeeGuids) {
        const empPunches = allPunches.filter(p => p.employee_toast_guid === guid)
        const empName = empMap[guid] || `Unknown (${guid.slice(0, 8)})`

        // Get the most common job for this employee
        const jobCounts: Record<string, number> = {}
        empPunches.forEach(p => {
            const jg = p.job_toast_guid
            jobCounts[jg] = (jobCounts[jg] || 0) + 1
        })
        const mainJobGuid = Object.entries(jobCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
        const role = jobMap[mainJobGuid] || 'Unknown'

        // Determine AM vs PM based on most common clock_in hour
        // AM = clock_in before 5pm (17:00), PM = clock_in at/after 5pm
        let amCount = 0
        let pmCount = 0
        empPunches.forEach(p => {
            if (!p.clock_in) return
            const clockInDate = new Date(p.clock_in)
            // Get hour in LA timezone
            const hourStr = clockInDate.toLocaleString('en-US', {
                hour: 'numeric',
                hour12: false,
                timeZone: 'America/Los_Angeles'
            })
            const hour = parseInt(hourStr)
            // AM shift = clock_in before 2pm (14:00), PM = 2pm or later
            if (hour < 14) {
                amCount++
            } else {
                pmCount++
            }
        })
        const shiftType = amCount >= pmCount ? 'AM' : 'PM'

        // Count frequency per day
        const counts = [0, 0, 0, 0, 0, 0, 0]
        empPunches.forEach(p => {
            const date = new Date(p.business_date)
            counts[date.getUTCDay()]++
        })

        const maxFreq = Math.max(...counts)
        const isFoh = role.toUpperCase().includes('CASHIER') ||
            role.toUpperCase().includes('CAJA') ||
            role.toUpperCase().includes('FOH')

        // Determine work/off days
        const workDays: string[] = []
        const offDays: string[] = []

        for (let d = 0; d < 7; d++) {
            const isOff = counts[d] === 0 || (maxFreq > 4 && counts[d] / maxFreq < 0.2)
            if (isOff) {
                offDays.push(DAY_NAMES[d])
            } else {
                workDays.push(DAY_NAMES[d])
                // Add to appropriate AM/PM bucket
                if (shiftType === 'AM') {
                    if (isFoh) summaryByDay.amFoh[d]++
                    else summaryByDay.amKitchen[d]++
                } else {
                    if (isFoh) summaryByDay.pmFoh[d]++
                    else summaryByDay.pmKitchen[d]++
                }
            }
        }

        console.log(`\n👤 ${empName}`)
        console.log(`   Rol: ${role}`)
        console.log(`   Turno: ${shiftType === 'AM' ? '🌅 AM (Mañana)' : '🌙 PM (Tarde/Noche)'} - ${amCount} entradas AM, ${pmCount} PM`)
        console.log(`   Posición: ${isFoh ? '💵 Cajero/FOH' : '🍳 Cocina'}`)
        console.log(`   Frecuencia: ${DAY_NAMES.map((d, i) => `${d}:${counts[i]}`).join(' | ')}`)
        console.log(`   ✅ Trabaja: ${workDays.join(', ') || 'Ninguno'}`)
        console.log(`   🛋️  Descansa: ${offDays.join(', ') || 'Nunca (trabaja 7 días)'}`)
    }

    // 6. Summary by day - Separated by AM and PM
    console.log('\n' + '═'.repeat(60))
    console.log('RESUMEN: LÍDERES DISPONIBLES POR DÍA Y TURNO')
    console.log('═'.repeat(60))
    console.log('\n🌅 TURNO AM (Mañana)')
    console.log('       Dom  Lun  Mar  Mié  Jue  Vie  Sáb')
    console.log(`🍳 COC: ${summaryByDay.amKitchen.map((n: number) => String(n).padStart(3)).join('  ')}`)
    console.log(`💵 FOH: ${summaryByDay.amFoh.map((n: number) => String(n).padStart(3)).join('  ')}`)

    console.log('\n🌙 TURNO PM (Tarde/Noche)')
    console.log('       Dom  Lun  Mar  Mié  Jue  Vie  Sáb')
    console.log(`🍳 COC: ${summaryByDay.pmKitchen.map((n: number) => String(n).padStart(3)).join('  ')}`)
    console.log(`💵 FOH: ${summaryByDay.pmFoh.map((n: number) => String(n).padStart(3)).join('  ')}`)

    console.log('\n✅ Análisis completado.')
}

analyzeLeadershipSchedules().catch(console.error)
