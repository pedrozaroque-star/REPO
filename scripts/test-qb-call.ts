/**
 * Test getQuickBooksClient with detailed error logging
 * Run via: npx tsx scripts/test-qb-call.ts
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testQBCall() {
  const { getQuickBooksClient } = await import('../lib/quickbooks')
  console.log('Testing getQuickBooksClient...')
  try {
    const qbo = await getQuickBooksClient()
    console.log('✅ QuickBooks client obtained! Testing findAccounts...')

    const res: any = await new Promise((resolve, reject) => {
      qbo.findAccounts({ limit: 5 }, (err: any, data: any) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    console.log('🎉 SUCCESS! Response from QuickBooks:', JSON.stringify(res?.QueryResponse?.Account?.map((a: any) => ({ id: a.Id, name: a.Name, num: a.AcctNum })), null, 2))
  } catch (err: any) {
    console.error('❌ ERROR Details:', {
      message: err.message,
      name: err.name,
      status: err.status,
      code: err.code,
      fault: err.Fault,
      originalMessage: err.originalMessage,
      authResponse: err.authResponse ? err.authResponse.text() : undefined,
      body: err.body,
      stack: err.stack
    })
  }
}

testQBCall()
