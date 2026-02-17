import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fixYolanda() {
    console.log('Fixing Yolanda Shift...')

    const shiftId = '50da0f1e-0fde-4887-a52e-9a6679d304aa'

    // Correct Times: Thursday Feb 19, 6:00 PM PST
    // PST is UTC-8
    // Feb 19 18:00 PST = Feb 20 02:00 UTC
    // End: 11:00 PM PST = Feb 19 23:00 PST = Feb 20 07:00 UTC

    const correctStart = '2026-02-20T02:00:00+00:00'
    const correctEnd = '2026-02-20T07:00:00+00:00'

    const { data, error } = await supabase
        .from('shifts')
        .update({
            start_time: correctStart,
            end_time: correctEnd
        })
        .eq('id', shiftId)
        .select()

    if (error) {
        console.error('Error updating:', error)
    } else {
        console.log('Fixed Shift:', data)
    }
}

fixYolanda()
