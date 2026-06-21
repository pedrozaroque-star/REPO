import { Client } from 'pg';

const regions = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'ca-central-1', 'sa-east-1', 'sa-east-2'
];
const projectRef = 'ywwwdcvgfculqmcfkihq';
const password = '100Prechivas.com';

async function test() {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    // Connect to POOLER port 6543
    const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:6543/postgres`;
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
    try {
      await client.connect();
      console.log(`🎉 SUCCESS! Connected to pooler in ${region} (host: ${host})`);
      const res = await client.query('SELECT 1 as val;');
      console.log('Result:', res.rows);
      await client.end();
      return;
    } catch (e: any) {
      console.log(`Region ${region} failed: ${e.message}`);
      client.end().catch(() => {});
    }
  }
}
test();
