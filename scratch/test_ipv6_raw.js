const { Client } = require('pg')

async function run() {
  console.log('Connecting using raw IPv6 address...')
  
  const client = new Client({
    host: '2600:1f1c:f9:4d03:61df:a5c9:94e0:9fbe',
    port: 5432,
    user: 'postgres',
    password: '100Prechivas.com',
    database: 'postgres',
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
