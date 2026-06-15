const dns = require('dns')

function resolve(host, type) {
  return new Promise((r) => {
    dns.resolve(host, type, (err, addresses) => {
      if (err) {
        console.log(`❌ ${host} (${type}) -> failed: ${err.message}`)
      } else {
        console.log(`✅ ${host} (${type}) -> ${addresses.join(', ')}`)
      }
      r(null)
    })
  })
}

async function run() {
  console.log('Resolving AAAA records...')
  await resolve('db.ywwwdcvgfculqmcfkihq.supabase.co', 'AAAA')
  await resolve('db.ywwwdcvgfculqmcfkihq.supabase.co', 'A')
}

run()
