import dns from 'dns'

const hosts = [
  'db.ywwwdcvgfculqmcfkihq.supabase.co',
  'aws-0-us-west-1.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com',
  'aws-0-us-east-2.pooler.supabase.com',
  'aws-0-sa-east-1.pooler.supabase.com',
  'ywwwdcvgfculqmcfkihq.supabase.co'
]

for (const host of hosts) {
  dns.lookup(host, (err, address) => {
    if (err) {
      console.log(`❌ ${host}: ${err.message}`)
    } else {
      console.log(`✅ ${host}: ${address}`)
    }
  })
}
