const { Client } = require('pg');
const dns = require('dns').promises;

async function test() {
  const projectRef = 'ywwwdcvgfculqmcfkihq';
  const password = '100Prechivas.com';
  
  // Try resolving db.projectRef.supabase.co or projectRef.supabase.co
  const hosts = [`db.${projectRef}.supabase.co`, `${projectRef}.supabase.co`];
  for (const host of hosts) {
    try {
      const lookup = await dns.lookup(host);
      console.log(`Resolved ${host} -> ${lookup.address}`);
      
      const users = [`postgres.${projectRef}`, 'postgres'];
      for (const port of [5432, 6543]) {
        for (const user of users) {
          const client = new Client({
            host: lookup.address,
            port,
            user,
            password,
            database: 'postgres',
            ssl: { rejectUnauthorized: false }
          });
          try {
            await client.connect();
            console.log(`🎉 SUCCESS! Connected to ${host} via ${lookup.address}:${port} as ${user}!`);
            const res = await client.query('SELECT version();');
            console.log('Postgres version:', res.rows[0].version.slice(0, 30));
            await client.end();
            return { host: lookup.address, port, user, password };
          } catch (e) {
            console.log(`Failed ${lookup.address}:${port} as ${user}:`, e.message);
            try { await client.end(); } catch (err) {}
          }
        }
      }
    } catch (e) {
      console.log(`Could not resolve ${host}:`, e.message);
    }
  }
}

test();
