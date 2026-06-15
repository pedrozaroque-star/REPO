import { Client } from 'pg';

const regions = ['us-west-1', 'us-west-2', 'us-east-1', 'us-east-2'];
const passwords = ['100Prechivas.com', '100Prechivas'];
const projectRef = 'ywwwdcvgfculqmcfkihq';

async function test() {
  for (const region of regions) {
    for (const pwd of passwords) {
      const host = `aws-0-${region}.pooler.supabase.com`;
      const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(pwd)}@${host}:5432/postgres`;
      console.log(`Testing ${region} with password: ${pwd}`);
      
      const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
      });
      try {
        await client.connect();
        console.log(`\n🎉 SUCCESS! Connected to region ${region} with password: ${pwd}`);
        const res = await client.query('SELECT 1 as val;');
        console.log('Query result:', res.rows);
        await client.end();
        return;
      } catch (e: any) {
        console.log(`Failed for ${region}:`, e.message);
      }
    }
  }
}
test();
