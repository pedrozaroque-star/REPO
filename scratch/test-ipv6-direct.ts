import { Client } from 'pg';

const passwords = ['100Prechivas.com', '100Prechivas'];
const host = '2600:1f1c:f9:4d03:61df:a5c9:94e0:9fbe';

async function test() {
  console.log('Testing direct connection via raw IPv6 address...');
  for (const pwd of passwords) {
    console.log(`Testing password: ${pwd}`);
    const client = new Client({
      host,
      port: 5432,
      user: 'postgres',
      password: pwd,
      database: 'postgres',
      ssl: { rejectUnauthorized: false }
    });
    try {
      await client.connect();
      console.log(`\n🎉 SUCCESS! Connected directly via raw IPv6 with password: ${pwd}`);
      const res = await client.query('SELECT 1 as val;');
      console.log('Query result:', res.rows);
      await client.end();
      return;
    } catch (e: any) {
      console.log(`Failed for ${pwd}:`, e.message);
      await client.end().catch(() => {});
    }
  }
  console.log('Finished testing direct raw IPv6.');
}

test().catch(console.error);
