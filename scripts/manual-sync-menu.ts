import { syncMenuFromToast } from '../lib/inventory/toast-sync'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function run() {
    console.log('--- MANUAL MENU SYNC ---')
    try {
        const result = await syncMenuFromToast()
        console.log('Result:', result)
    } catch (e) {
        console.error('Error:', e)
    }
}

run()
