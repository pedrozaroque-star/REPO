import { supabaseAdmin } from '../lib/supabase';

async function main() {
    const { data: todo, error } = await supabaseAdmin
        .from('bc_todos')
        .select('id, bc_id, title, description')
        .eq('bc_id', 9287087501);
        
    if (error) {
        console.error('Error fetching todo:', error);
        return;
    }
    
    console.log('Result for bc_id = 9287087501:', todo);
}

main().catch(console.error);
