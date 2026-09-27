import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function run() {
  console.log('--- HORCHATA ITEMS IN TOAST MENU ITEMS ---')
  const { data: horchatas } = await supabase
    .from('toast_menu_items')
    .select('*')
    .ilike('name', '%horchata%')
  console.log(horchatas)

  if (horchatas && horchatas.length > 0) {
    const guids = horchatas.map(h => h.guid)
    const { data: recs } = await supabase
      .from('recipes')
      .select('*')
      .in('toast_menu_item_guid', guids)
    console.log('Existing recipes for horchatas:', recs)
  }
}

run().catch(console.error)
