
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

const TARGET_START = new Date('2026-01-19T00:00:00') // Lunes
const TARGET_END = new Date('2026-01-25T23:59:59')   // Domingo

// Helper: Formato HH:mm
function formatTime(dateIso: string) {
    const d = new Date(dateIso)
    // Get string in LA time
    const timeStr = d.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles',
        hour12: false
    })

    let [h, m] = timeStr.split(':').map(Number)

    // Round to nearest 30 mins
    // 0-14 -> 00
    // 15-44 -> 30
    // 45-59 -> next hour 00
    if (m < 15) {
        m = 0
    } else if (m < 45) {
        m = 30
    } else {
        m = 0
        h = (h + 1) % 24
    }

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Helper: Día de la semana (0=Domingo, 1=Lunes...)
// Pero ojo: BusinessDate define el día.
function getDayOfWeek(dateStr: string) {
    // dateStr suele ser YYYYMMDD o YYYY-MM-DD
    const d = new Date(dateStr)
    return d.getUTCDay() // Usar UTC al parsear businessDate YYYY-MM-DD
}

async function generateSchedules() {
    console.log("🧠 Generando Horarios Inteligentes (19 Ene - 25 Ene)...")

    // 1. Obtener Empleados Activos y sus Jobs para tener referencia de tienda
    // (Necesitamos saber la tienda para insertar el shift en la tienda correcta)
    // El problema: `toast_employees` puede no estar actualizado con la tienda actual si se movió.
    // Usaremos la información de los PUNCHES recientes para determinar su "Tienda Principal".

    // Obtener últimos 90 días de punches
    // Obtener últimos 90 días de punches (con paginación para evitar límites)
    let allPunches: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
        const { data, error } = await supabase
            .from('punches')
            .select('*')
            .gte('business_date', '2025-07-20')
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            console.error("Error leyendo punches:", error)
            return
        }

        if (data) {
            allPunches = allPunches.concat(data)
            if (data.length < pageSize) hasMore = false
        } else {
            hasMore = false
        }
        page++
        // console.log(`   ...cargado página ${page} (${allPunches.length} total)`)
    }

    const punches = allPunches

    console.log(`📊 Analizando ${punches.length} registros históricos...`)

    // 1.5 Obtener Perfil Actual de Empleados (Fuente de Verdad para Puestos y Tiendas)
    const { data: employeesProfile, error: profileErr } = await supabase
        .from('toast_employees')
        .select('toast_guid, job_references, store_ids')
        .eq('deleted', false)

    if (profileErr) {
        console.error("Error leyendo perfiles de empleados:", profileErr)
        return
    }

    const empProfileMap: Record<string, { jobGuid: string, storeId: string }> = {}
    employeesProfile?.forEach(e => {
        const profileData = {
            jobGuid: e.job_references?.[0]?.guid || '',
            storeId: e.store_ids?.[0] || ''
        }
        if (e.toast_guid) empProfileMap[e.toast_guid] = profileData
        if (e.v2_toast_guid) empProfileMap[e.v2_toast_guid] = profileData
    })

    // Agrupar por Empleado
    const employeeHistory: Record<string, any[]> = {}
    const employeeStore: Record<string, string> = {} // Store ID más reciente

    punches.forEach(p => {
        if (!p.employee_toast_guid) return
        const eid = p.employee_toast_guid
        if (!employeeHistory[eid]) employeeHistory[eid] = []
        employeeHistory[eid].push(p)

        // Guardar tienda (la última vista)
        employeeStore[eid] = p.store_id
    })

    const employeeIds = Object.keys(employeeHistory)
    console.log(`👥 Encontrados ${employeeIds.length} empleados activos en historial.`)

    const newShifts = []

    // 2. Iterar por empleado primero (Para manejar regla de descansos)
    for (const eid of employeeIds) {
        const history = employeeHistory[eid]
        const profile = empProfileMap[eid]
        const currentJobId = profile?.jobGuid || history[history.length - 1].job_toast_guid
        const currentStoreId = profile?.storeId || employeeStore[eid]

        // Check inactivity (20 days)
        const sortedHistory = [...history].sort((a, b) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime())
        const lastPunch = sortedHistory[0]
        const daysSinceLastWork = (new Date().getTime() - new Date(lastPunch.business_date).getTime()) / (1000 * 3600 * 24)
        if (daysSinceLastWork > 20) continue

        const empWeeklyShifts = []

        // Calcular frecuencias por día de la semana (0-6)
        const counts = [0, 0, 0, 0, 0, 0, 0]
        history.forEach(p => {
            const day = new Date(p.business_date).getUTCDay()
            counts[day]++
        })
        const maxFrequency = Math.max(...counts)

        // Iterar días de la semana objetivo (Del 19 al 25)
        for (let d = 0; d < 7; d++) {
            const targetDate = new Date(2026, 0, 19 + d)
            const dateStr = targetDate.toISOString().split('T')[0]
            const dayOfWeek = targetDate.getDay() // 0-6 (Dom-Sab)

            const thisDayFrequency = counts[dayOfWeek]

            // --- DETECCION INTELIGENTE DE DESCANSOS ---
            if (thisDayFrequency === 0 || (maxFrequency > 4 && thisDayFrequency / maxFrequency < 0.2)) {
                continue
            }

            // Filtrar punches de este día
            const historyOnThisDay = history.filter(p => new Date(p.business_date).getUTCDay() === dayOfWeek)

            // Calcular patrones de horario (Moda) - Reciente 45 días
            const recentHistory = historyOnThisDay.filter(p => {
                const diff = (new Date().getTime() - new Date(p.business_date).getTime()) / (1000 * 3600 * 24)
                return diff <= 45
            })
            const analysisSet = recentHistory.length > 0 ? recentHistory : historyOnThisDay

            const timePatterns: Record<string, number> = {}
            analysisSet.forEach(p => {
                if (!p.clock_in || !p.clock_out) return
                const start = formatTime(p.clock_in)
                const end = formatTime(p.clock_out)
                const key = `${start}|${end}`
                timePatterns[key] = (timePatterns[key] || 0) + 1
            })

            let bestPattern = ''
            let maxCount = 0
            for (const key in timePatterns) {
                if (timePatterns[key] > maxCount) {
                    maxCount = timePatterns[key]
                    bestPattern = key
                }
            }

            if (bestPattern) {
                const [start, end] = bestPattern.split('|')
                empWeeklyShifts.push({
                    employee_id: eid,
                    store_id: currentStoreId,
                    shift_date: dateStr,
                    start_time: start,
                    end_time: end,
                    toast_job_guid: currentJobId,
                    frequency: thisDayFrequency
                })
            }
        }

        // --- REGLA DE DESCANSO OBLIGATORIO ---
        // Si el empleado tiene turnos los 7 días, quitar el del día más débil
        if (empWeeklyShifts.length >= 7) {
            let weakestIdx = 0
            let minFreq = 999999
            empWeeklyShifts.forEach((s, idx) => {
                if (s.frequency < minFreq) {
                    minFreq = s.frequency
                    weakestIdx = idx
                }
            })
            empWeeklyShifts.splice(weakestIdx, 1)
        }

        // Agregar al global
        empWeeklyShifts.forEach(({ frequency, ...s }) => newShifts.push(s))
    }

    // RESOLVER IDs (Guid -> UUID)
    console.log("🔄 Resolviendo referencias de IDs...")

    // Traer todos los empleados (mapa ToastGUID -> UUID)
    // Buscamos coincidir con punches.employee_toast_guid
    const { data: dbEmps } = await supabase.from('toast_employees').select('id, toast_guid, v2_toast_guid')
    const empMap: Record<string, string> = {}
    dbEmps?.forEach(e => {
        if (e.toast_guid) empMap[e.toast_guid] = e.id
        if (e.v2_toast_guid) empMap[e.v2_toast_guid] = e.id
    })

    // Traer todos los jobs
    // Buscamos coincidir con punches.job_toast_guid
    const { data: dbJobs } = await supabase.from('toast_jobs').select('id, guid')
    const jobMap: Record<string, string> = {}
    dbJobs?.forEach(j => {
        if (j.guid) jobMap[j.guid] = j.id
    })

    const finalInserts = []


    for (const s of newShifts) {
        const uuid = empMap[s.employee_id]
        const jobId = jobMap[s.toast_job_guid]

        if (uuid && jobId) {
            // Manejo de offset fijo para CA (-08:00)
            const OFFSET = '-08:00'
            const startFull = `${s.shift_date}T${s.start_time}:00${OFFSET}`

            // Manejo de turno nocturno (si entras a las 17:00 y sales 02:00, sales al día siguiente)
            let endDate = s.shift_date
            if (s.end_time < s.start_time) {
                // Asumimos next day
                const d = new Date(s.shift_date)
                d.setDate(d.getDate() + 1)
                endDate = d.toISOString().split('T')[0]
            }
            const endFull = `${endDate}T${s.end_time}:00${OFFSET}`

            finalInserts.push({
                employee_id: uuid,
                store_id: s.store_id,
                shift_date: s.shift_date,
                start_time: startFull,
                end_time: endFull,
                job_id: jobId,
            })
        }
    }

    console.log(`📝 Insertando ${finalInserts.length} turnos generados...`)

    // 3. Limpiar semana objetivo antes de insertar (Idempotencia)
    await supabase.from('shifts')
        .delete()
        .gte('shift_date', '2026-01-19')
        .lte('shift_date', '2026-01-25')

    // Insertar en chunks
    const CHUNK_SIZE = 30
    for (let i = 0; i < finalInserts.length; i += CHUNK_SIZE) {
        const chunk = finalInserts.slice(i, i + CHUNK_SIZE)
        const { error } = await supabase.from('shifts').insert(chunk)
        if (error) console.error("Error insertando chunk:", error.message)
    }

    console.log("✅ Generación Completada.")
}

generateSchedules().catch(console.error)
