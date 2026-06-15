const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- DETAILED MESSAGES AUDIT ---');
    try {
        const { data: totalMsgs, error: err1 } = await supabase
            .from('bc_messages')
            .select('id, project_id, board_id, title');

        if (err1) throw err1;

        console.log(`Total messages in bc_messages: ${totalMsgs.length}`);
        
        let nullProject = 0;
        let nullBoard = 0;
        
        totalMsgs.forEach(m => {
            if (!m.project_id) nullProject++;
            if (!m.board_id) nullBoard++;
        });

        console.log(`Messages with null project_id: ${nullProject}`);
        console.log(`Messages with null board_id: ${nullBoard}`);
        
        if (totalMsgs.length > 0) {
            console.log('\nSample message structure:');
            console.log(totalMsgs[0]);
        }
    } catch (e) {
        console.error(e);
    }
}

run();
