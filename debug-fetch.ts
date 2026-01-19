
import { fetchToastData } from './lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testFetch() {
    console.log("🚀 TESTING FETCH TOAST DATA (QUARTER SIMULATION)")
    const today = new Date()
    const quarterAgo = new Date()
    quarterAgo.setDate(today.getDate() - 90)

    const startDate = quarterAgo.toISOString().split('T')[0]
    const endDate = today.toISOString().split('T')[0]

    console.log(`📅 Rango: ${startDate} -> ${endDate}`)

    const startT = Date.now()
    const { rows } = await fetchToastData({
        storeIds: 'all',
        startDate,
        endDate,
        groupBy: 'week'
    })
    const duration = ((Date.now() - startT) / 1000).toFixed(2)

    console.log(`\n✅ RESULTADO:`)
    console.log(`⏱️ Duración: ${duration}s`)
    console.log(`📊 Filas devueltas: ${rows.length}`)
}

testFetch()
