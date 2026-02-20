
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function checkStoreHours() {
    console.log('Fetching store hours...')
    const { data: stores, error } = await supabase
        .from('stores')
        .select('name, external_id, opening_time, closing_time, weekly_hours')
        .order('name')

    if (error) {
        console.error('Error:', error)
        return
    }

    const today = new Date('2026-02-19T12:00:00') // Thursday
    const dayOfWeek = today.getDay() // 4 (Thursday)
    console.log(`Checking for Day: ${dayOfWeek} (Thursday)`)

    stores.forEach(s => {
        let open = s.opening_time
        let close = s.closing_time
        let source = 'Default'

        if (s.weekly_hours && Array.isArray(s.weekly_hours)) {
            const dayConfig = s.weekly_hours.find((c: any) => c.day === dayOfWeek)
            if (dayConfig) {
                if (dayConfig.open) open = dayConfig.open
                if (dayConfig.close) close = dayConfig.close
                source = 'WeeklyOverride'
            }
        }

        console.log(`Store: ${s.name.padEnd(25)} | Open: ${open} | Close: ${close} | Source: ${source}`)
    })
}

checkStoreHours()
