import { Client } from 'pg';

const regions = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'ap-south-1', 'ca-central-1', 'sa-east-1'
];
const passwords = ['100Prechivas.com', '100Prechivas'];
const projectRef = 'ywwwdcvgfculqmcfkihq';
const ports = [5432, 6543];

async function run() {
  console.log('Starting comprehensive pooler region & port scan...');
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    for (const port of ports) {
      for (const pwd of passwords) {
        const username = `postgres.${projectRef}`;
        const connectionString = `postgresql://${username}:${encodeURIComponent(pwd)}@${host}:${port}/postgres`;
        const client = new Client({
          connectionString,
          connectionTimeoutMillis: 3000,
          ssl: { rejectUnauthorized: false }
        });
        try {
          await client.connect();
          console.log(`\n🎉 SUCCESS! Connected to region=${region} port=${port} pwd=${pwd}`);
          const res = await client.query('SELECT 1 as val;');
          console.log('Query result:', res.rows);
          await client.end();
          return; // Exit script once connected
        } catch (e: any) {
          if (e.message.includes('password authentication failed')) {
            console.log(`🎯 TARGET FOUND: Region ${region} matches this tenant! Password failed: ${pwd}`);
          } else if (e.message.includes('Tenant or user not found') || e.message.includes('not found')) {
            // Region is incorrect for this projectRef
          } else {
            console.log(`Region ${region} Port ${port} Error: ${e.message}`);
          }
          await client.end().catch(() => {});
        }
      }
    }
  }
  console.log('Finished comprehensive scan.');
}

run().catch(console.error);
