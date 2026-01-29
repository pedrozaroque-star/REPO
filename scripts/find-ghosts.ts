
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_WEEK = '2026-01-26'
const TARGET_END = '2026-02-01'

// LISTA DE "PERMITIDOS" (TU PANTALLA)
// Normalizo a minusculas para comparar facil
const ALLOWED_NAMES = [
    "carlos velazquez", "enrique navarrete", "heidy rodarte", "victor muñoz", "carmen zavala",
    "eliuth alvarez", "jennifer ortiz", "maria tapia", "maritza avilez", "martha lemus",
    "alberto benitez", "alexander villarreal", "jose leyva", "librado mondragon", "cruz victorino castillo",
    "carlos arteaga", "cristian ajeataz", "hismirna chanchavac", "sugey reyes", "blanca zarat",
    "brenda flores", "maria t alejandre", "valentina valladares", "elias morales", "jonathan velasco",
    "jose martinez", "jose andres morales", "miguel perez"
]

const calcDuration = (s: any) => {
    const start = new Date(s.start_time)
    const end = new Date(s.end_time)
    let rawDuration = (end.getTime() - start.getTime()) / 36e5
    if (rawDuration < 0) rawDuration += 24
    return (rawDuration > 5) ? rawDuration - 0.5 : Math.max(0, rawDuration)
}

async function findGhosts() {
    console.log("👻 BÚSQUEDA DE FANTASMAS (Empleados en BD pero NO en Pantalla)\n")

    // 1. Fetch Shifts
    const { data: shifts } = await supabase.from('shifts')
        .select('*').eq('store_id', LYNWOOD_GUID).gte('shift_date', TARGET_WEEK).lte('shift_date', TARGET_END)

    if (!shifts) return

    // 2. Fetch Employees
    const empIds = [...new Set(shifts.map(s => s.employee_id))]
    const { data: emps } = await supabase.from('toast_employees').select('*').in('id', empIds)

    let ghostHours = 0
    let ghostCount = 0

    emps?.forEach(emp => {
        const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase().trim()

        // Check fuzzy match (apellidos compuestos a veces fallan, usamos includes)
        // Ojo: "victor munoz" vs "victor muñoz". Logica simple:
        const matched = ALLOWED_NAMES.find(allowed => {
            // Check similarity? simple includes for now
            // Remove accents for comparison
            const a = allowed.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            const b = fullName.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            return a === b || b.includes(a) || a.includes(b)
        })

        if (!matched) {
            // ES UN FANTASMA
            // Calc hours
            const empShifts = shifts.filter(s => s.employee_id === emp.id)
            let h = 0
            empShifts.forEach(s => h += calcDuration(s))

            console.log(`🚨 FANTASMA ENCONTRADO: [${emp.first_name} ${emp.last_name}] - ${h.toFixed(1)} hrs`)
            console.log(`   (ID: ${emp.id})`)
            ghostHours += h
            ghostCount++
        }
    })

    console.log("---------------------------------------------------")
    console.log(`TOTAL HORAS FANTASMA: ${ghostHours.toFixed(1)} hrs`)

    // Check Miguel Perez specifically
    const miguel = emps?.find(e => e.first_name.toLowerCase().includes('miguel') && e.last_name.toLowerCase().includes('perez'))
    if (miguel) {
        console.log(`\nNota: Miguel Perez sí existe en BD (${miguel.id}).`)
    } else {
        console.log(`\nNota: Miguel Perez NO tiene ID en BD (posiblemente un 'No ID' en Toast).`)
        // Si no existe en BD, yo no lo estoy sumando. Pero tú sí (43h).
        // Si yo sumo 1250h SIN Miguel.... y tú sumas 1200h CON Miguel...
        // Entonces mi exceso es MASIVO (43 + 43 = 86 horas extra!).
        // O tal vez "Miguel Perez" en mi BD es otra persona con otro nombre?
    }
}

findGhosts()
