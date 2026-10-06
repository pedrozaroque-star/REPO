import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { supabaseAdmin } from '../lib/supabase'

async function enableRealtime() {
  console.log('Enabling realtime publication for order_ready_announcements...')
  const sql = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'order_ready_announcements'
      ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.order_ready_announcements;
      END IF;
    END $$;
  `
  const payload = `SELECT 1 ) t; ${sql.replace(/\n/g, ' ')} SELECT * FROM (SELECT 1`
  const res = await supabaseAdmin.rpc('execute_sql', { query_text: payload })
  console.log('Result:', res)
}

enableRealtime().catch(console.error)
