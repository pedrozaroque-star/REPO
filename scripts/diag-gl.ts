import { supabaseAdmin } from '../lib/supabase'
async function main() {
  const { data, error } = await supabaseAdmin
    .from('accounting_gl_accounts')
    .select('account_number,account_name,account_type,qb_account_id')
    .in('account_number', ['53060', '12100', '51050', '51030', '10010'])
    .order('account_number')
  console.log(error?.message || data)
}
main()
