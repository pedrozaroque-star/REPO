import { supabaseAdmin } from '../lib/supabase';

async function main() {
    const { data: vaults, error } = await supabaseAdmin
        .from('bc_vaults')
        .select('*');
        
    if (error) {
        console.error(error);
        return;
    }
    
    console.log(`Found ${vaults?.length || 0} vaults in DB.`);
    for (const v of vaults || []) {
        console.log(`- ID: ${v.id}, name: ${v.name}, parent: ${v.parent_vault_id}, bc_id: ${v.bc_id}`);
    }
}

main().catch(console.error);
