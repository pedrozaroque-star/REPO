import { Client } from 'pg';

const region = 'us-west-1';
const passwords = ['100Prechivas.com', '100Prechivas'];
const projectRef = 'ywwwdcvgfculqmcfkihq';
const hosts = [`aws-0-${region}.pooler.supabase.com`];
const ports = [5432, 6543];
const users = [`postgres.${projectRef}`, 'postgres'];

async function test() {
  console.log('Testing pooler connections with different ports and users...');
  for (const host of hosts) {
    for (const port of ports) {
      for (const user of users) {
        for (const pwd of passwords) {
          console.log(`Testing host=${host} port=${port} user=${user} pwd=${pwd}`);
          const client = new Client({
            host,
            port,
            user,
            password: pwd,
            database: 'postgres',
            ssl: { rejectUnauthorized: false }
          });
          try {
            await client.connect();
            console.log(`\n🎉 SUCCESS! Connected to pooler: host=${host} port=${port} user=${user} pwd=${pwd}`);
            const res = await client.query('SELECT 1 as val;');
            console.log('Query result:', res.rows);
            await client.end();
            return;
          } catch (e: any) {
            console.log(`Failed: ${e.message}`);
            await client.end().catch(() => {});
          }
        }
      }
    }
  }
  console.log('Finished testing.');
}

test().catch(console.error);
