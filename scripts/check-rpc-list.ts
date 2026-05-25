import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function run() {
    const res = await fetch(`${url}/rest/v1/?apikey=${key}`)
    const json = await res.json()
    const rpcs = Object.keys(json.paths).filter(p => p.startsWith('/rpc/'))
    console.log(rpcs.join('\n'))
}
run()
