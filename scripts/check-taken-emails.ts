import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkSpecificEmails() {
    const emails = [
        'isidromondragon16@gmail.com',
        'ortizgustavo1220@gmail.com'
    ]

    console.log('Checking if these emails exist ANYWHERE in the database (active or deleted)...')

    for (const email of emails) {
        console.log(`\n--- Checking: ${email} ---`)
        const { data: emps, error } = await supabase
            .from('toast_employees')
            .select('*')
            .eq('email', email) // Exact match search

        if (error) {
            console.error('Error:', error.message)
            continue
        }

        if (emps && emps.length > 0) {
            console.log(`FOUND! This email is already TAKEN by:`)
            emps.forEach(e => {
                console.log(`  Name: ${e.first_name} ${e.last_name}`)
                console.log(`  Store ID: ${e.restaurant_id || e.store_ids}`) // store_ids is usually the array
                console.log(`  Toast GUID: ${e.toast_guid}`)
                console.log(`  Deleted: ${e.deleted}`)
                console.log(`  Created At: ${e.created_at}`)
            })
            console.log(`Conclusion: You cannot use this email for a new Santa Ana profile because it belongs to the above record using it.`)
        } else {
            console.log('NOT FOUND in this database.')
            console.log('Possibility 1: It exists in Toast in a store NOT synced to this DB.')
            console.log('Possibility 2: It exists in Toast as "Archived" and was deleted before we started syncing.')
        }
    }
}

checkSpecificEmails()
