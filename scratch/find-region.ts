import { Client } from 'pg';

const regions = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'ca-central-1', 'sa-east-1', 'sa-east-2'
];
const projectRef = 'ywwwdcvgfculqmcfkihq';

async function test() {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const connectionString = `postgresql://postgres.${projectRef}:wrong_password_test@${host}:5432/postgres`;
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
    try {
      await client.connect();
      console.log(`🎉 Found tenant in ${region}! Connection successful (unexpected!)`);
      await client.end();
    } catch (e: any) {
      if (e.message.includes('password authentication failed')) {
        console.log(`🎯 TARGET REGION FOUND: ${region}! Got password authentication failure.`);
        client.end().catch(() => {});
      } else {
        // e.g. tenant not found or connection timeout
        // console.log(`Region ${region} failed: ${e.message}`);
      }
    }
  }
}
test();
