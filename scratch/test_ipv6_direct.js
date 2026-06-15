const { Client } = require('pg')

async function run() {
  const connectionString = 'postgresql://postgres:100Prechivas.com@db.ywwwdcvgfculqmcfkihq.supabase.co:5432/postgres'
  console.log('Connecting via IPv6 to:', connectionString.replace('100Prechivas.com', '***'))
  
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  })
  
  try {
    await client.connect()
    console.log('✅ Connection successful!')
    const res = await client.query('SELECT current_database(), current_user')
    console.log('Result:', res.rows)
  } catch (err) {
    console.error('❌ Connection failed:', err.message)
  } finally {
    await client.end()
  }
}

run()
