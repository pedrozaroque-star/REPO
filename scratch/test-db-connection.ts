import { Client } from 'pg';

const passwords = ['100Prechivas.com', '100Prechivas', '8y2dxx4tfFG+4Bkay4KuLN76hJsKq4X6ckx48Hl/wBSfWlrhcGORRQbgcHyHs4b0Cp/C9CJkwn8tA9s8k1WUdw=='];

async function test() {
  for (const pwd of passwords) {
    const connectionString = `postgresql://postgres:${encodeURIComponent(pwd)}@db.ywwwdcvgfculqmcfkihq.supabase.co:5432/postgres`;
    console.log('Testing password:', pwd);
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
    try {
      await client.connect();
      console.log('🎉 SUCCESS! Connected with password:', pwd);
      const res = await client.query('SELECT 1 as val;');
      console.log('Query result:', res.rows);
      await client.end();
      return;
    } catch (e: any) {
      console.log('Failed:', e.message);
    }
  }
}
test();
