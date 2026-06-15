const { Client } = require('pg')

const regions = [
  'us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1'
]
const projectRef = 'ywwwdcvgfculqmcfkihq'

async function run() {
  console.log('Starting DB region verification...')
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`
    console.log(`Testing host: ${host}`)
    const connectionString = `postgresql://postgres.${projectRef}:wrong_password@${host}:5432/postgres`
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    })
    try {
      await client.connect()
      console.log(`Connected to ${region}`)
      await client.end()
    } catch (e) {
      console.log(`Region ${region} failed with error: ${e.message}`)
    }
  }
  console.log('Finished testing.')
}

run()
