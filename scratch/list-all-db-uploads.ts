import { supabaseAdmin } from '../lib/supabase';

async function main() {
    const { data: uploads, error } = await supabaseAdmin
        .from('bc_uploads')
        .select('*');
        
    if (error) {
        console.error(error);
        return;
    }
    
    console.log(`Found ${uploads?.length || 0} uploads in DB.`);
    for (const u of uploads || []) {
        console.log(`- ID: ${u.id}, filename: ${u.filename}, type: ${u.content_type}, url: ${u.download_url}`);
    }
}

main().catch(console.error);
