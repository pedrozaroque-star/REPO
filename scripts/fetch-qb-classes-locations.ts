/**
 * Consultar las Clases y Ubicaciones (Departments) en vivo desde QuickBooks Online
 * Run via: npx tsx scripts/fetch-qb-classes-locations.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function fetchClassesAndDepartments() {
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  const realmId = integ.realm_id
  const token = integ.access_token
  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`

  const qbFetch = async (endpoint: string) => {
    const url = `${baseUrl}/${endpoint}${endpoint.includes('?') ? '&' : '?'}minorversion=75`
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    })
    if (!res.ok) {
      throw new Error(`QB API Error ${res.status}: ${await res.text()}`)
    }
    return await res.json()
  }

  // 1. Consultar Clases (Class)
  console.log('📡 Consultando Clases (Classes) en QuickBooks Online...')
  const classSql = encodeURIComponent("SELECT * FROM Class WHERE Active = true MAXRESULTS 100")
  const classData = await qbFetch(`query?query=${classSql}`)
  const classes = classData.QueryResponse?.Class || []
  console.log(`✓ Total de Clases activas en QB: ${classes.length}`)
  console.log(classes.map((c: any) => ({ Id: c.Id, Name: c.Name })))

  // 2. Consultar Ubicaciones / Departamentos (Department)
  console.log('\n📡 Consultando Ubicaciones (Departments / Locations) en QuickBooks Online...')
  const deptSql = encodeURIComponent("SELECT * FROM Department WHERE Active = true MAXRESULTS 100")
  const deptData = await qbFetch(`query?query=${deptSql}`)
  const departments = deptData.QueryResponse?.Department || []
  console.log(`✓ Total de Departamentos/Ubicaciones activas en QB: ${departments.length}`)
  console.log(departments.map((d: any) => ({ Id: d.Id, Name: d.Name })))
}

fetchClassesAndDepartments().catch(console.error)
