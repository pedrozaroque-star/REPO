
import { getAuthToken, fetchToastData } from '@/lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

// Known Stores List (We could fetch this, but hardcoding is faster for now)
const STORES = [
    'acf15327-54c8-4da4-8d0d-3ac0544dc422', 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8',
    '42ed15a6-106b-466a-9076-1e8f72451f6b', 'b7f63b01-f089-4ad7-a346-afdb1803dc1a',
    '475bc112-187d-4b9c-884d-1f6a041698ce', 'a83901db-2431-4283-834e-9502a2ba4b3b',
    '5fbb58f5-283c-4ea4-9415-04100ee6978b', '47256ade-2cd4-4073-9632-84567ad9e2c8',
    '8685e942-3f07-403a-afb6-faec697cd2cb', '3a803939-eb13-4def-a1a4-462df8e90623',
    '80a1ec95-bc73-402e-8884-e5abbe9343e6', '3c2d8251-c43c-43b8-8306-387e0a4ed7c2',
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd', '95866cfc-eeb8-4af9-9586-f78931e1ea04',
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'
]

async function mapRoles() {
    console.log(`🗺️  MAPPING ROLES FOR ${STORES.length} STORES...`)

    const token = await getAuthToken()
    if (!token) return

    const MASTER_MAP: Record<string, string> = {} // GUID -> 'CASHIER' | 'KITCHEN' | 'DRIVER' | 'MANAGER'
    let count = 0

    for (const storeId of STORES) {
        try {
            const url = `${TOAST_API_HOST}/labor/v1/jobs`
            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })

            if (!res.ok) {
                console.warn(`⚠️ Failed to fetch jobs for ${storeId}`)
                continue
            }

            const jobs = await res.json()
            if (Array.isArray(jobs)) {
                jobs.forEach((j: any) => {
                    const title = (j.title || j.name || '').toLowerCase()
                    const guid = j.guid

                    if (!guid) return

                    let role = 'OTHER'

                    // HEURISTICS
                    if (title.includes('cashier') || title.includes('front') || title.includes('counter')) {
                        role = 'CASHIER'
                    } else if (title.includes('prep') || title.includes('cook') || title.includes('kitchen') || title.includes('back')) {
                        role = 'KITCHEN'
                    } else if (title.includes('driver') || title.includes('delivery')) {
                        role = 'DRIVER'
                    } else if (title.includes('manager') || title.includes('shift') || title.includes('super') || title.includes('lead')) {
                        role = 'MANAGER'
                    }

                    if (role !== 'OTHER') {
                        MASTER_MAP[guid] = role
                        count++
                    }
                })
            }
        } catch (e) {
            console.error(e)
        }
        // polite delay
        await new Promise(r => setTimeout(r, 200))
    }

    console.log(`✅ Mapped ${count} roles across 15 stores.`)
    console.log(`   Cashiers found: ${Object.values(MASTER_MAP).filter(r => r === 'CASHIER').length}`)
    console.log(`   Kitchen found: ${Object.values(MASTER_MAP).filter(r => r === 'KITCHEN').length}`)

    const outFile = path.join(process.cwd(), 'scripts', 'mining', 'role-map.json')
    fs.writeFileSync(outFile, JSON.stringify(MASTER_MAP, null, 2))
    console.log(`💾 Map saved to ${outFile}`)
}

mapRoles()
