import { Client } from 'pg'

async function testConnection() {
  const projectRef = 'ywwwdcvgfculqmcfkihq'
  const passwords = ['100Prechivas.com', '100Prechivas', '8y2dxx4tfFG+4Bkay4KuLN76hJsKq4X6ckx48Hl/wBSfWlrhcGORRQbgcHyHs4b0Cp/C9CJkwn8tA9s8k1WUdw==']
  
  for (const pwd of passwords) {
    const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(pwd)}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
    try {
      console.log(`Trying password: ${pwd.substring(0, 5)}...`)
      await client.connect()
      console.log('🎉 SUCCESS! Connected to Supabase DB!')
      await client.end()
      return pwd
    } catch (e: any) {
      console.log('Failed:', e.message)
    }
  }

  // Also try direct connection
  for (const pwd of passwords) {
    const connectionString = `postgresql://postgres:${encodeURIComponent(pwd)}@db.${projectRef}.supabase.co:5432/postgres`
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
    try {
      console.log(`Trying direct password: ${pwd.substring(0, 5)}...`)
      await client.connect()
      console.log('🎉 SUCCESS! Connected directly to Supabase DB!')
      await client.end()
      return pwd
    } catch (e: any) {
      console.log('Failed:', e.message)
    }
  }
}

testConnection()
