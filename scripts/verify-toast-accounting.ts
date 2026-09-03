import dotenv from 'dotenv'
import path from 'path'
import { fetchToastAccountingData } from '../lib/toast-accounting'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function verify() {
  const azusaExtId = 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8'
  const data = await fetchToastAccountingData(azusaExtId, '20260901')
  console.log('Toast Accounting Granular Data for Azusa:\n', JSON.stringify(data, null, 2))
}

verify().catch(console.error)
