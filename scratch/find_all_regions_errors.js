const { Client } = require('pg')

const regions = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ca-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-central-1', 'eu-central-2', 'ap-northeast-1', 'ap-northeast-2',
  'ap-northeast-3', 'ap-southeast-1', 'ap-southeast-2', 'ap-south-1',
  'sa-east-1'
]
const projectRef = 'ywwwdcvgfculqmcfkihq'

async function run() {
  console.log('Starting DB region verification with all errors...')
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`
    const connectionString = `postgresql://postgres.${projectRef}:wrong_password@${host}:5432/postgres`
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 2000
    })
    try {
      await client.connect()
      console.log(`Connected to ${region}`)
      await client.end()
    } catch (e) {
      console.log(`${region}: ${e.message.replace(/\r?\n|\r/g, ' ')}`)
      client.end().catch(() => {})
    }
  }
  console.log('Finished testing all regions.')
}

run()
