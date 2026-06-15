import dns from 'dns';

const hosts = [
  'ywwwdcvgfculqmcfkihq.supabase.co',
  'db.ywwwdcvgfculqmcfkihq.supabase.co',
  'db.ywwwdcvgfculqmcfkihq.supabase.com',
  'aws-0-us-west-1.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com',
  'aws-0-us-east-2.pooler.supabase.com',
  'aws-0-us-west-2.pooler.supabase.com'
];

function resolve(host: string) {
  return new Promise((r) => {
    dns.resolve(host, (err, addresses) => {
      if (err) {
        console.log(`❌ ${host} -> failed: ${err.message}`);
      } else {
        console.log(`✅ ${host} -> ${addresses.join(', ')}`);
      }
      r(null);
    });
  });
}

async function run() {
  for (const h of hosts) {
    await resolve(h);
  }
}
run();
