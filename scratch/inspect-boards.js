const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- DETAILED DB PROJECT & BOARD INSPECTION ---');
    try {
        const { data: projects, error: projErr } = await supabase
            .from('bc_projects')
            .select('id, name, bc_id');

        if (projErr) throw projErr;

        console.log(`Found ${projects.length} projects in bc_projects.`);

        for (const proj of projects) {
            console.log(`\nProject: "${proj.name}" (UUID: ${proj.id}, Basecamp ID: ${proj.bc_id})`);
            
            // Look for boards
            const { data: boards, error: boardErr } = await supabase
                .from('bc_message_boards')
                .select('id, bc_id')
                .eq('project_id', proj.id);
                
            if (boardErr) {
                console.log(`  Error loading boards: ${boardErr.message}`);
                continue;
            }

            console.log(`  Message Boards found: ${boards.length}`);
            for (const board of boards) {
                // Count messages
                const { count, error: msgErr } = await supabase
                    .from('bc_messages')
                    .select('*', { count: 'exact', head: true })
                    .eq('board_id', board.id);
                
                console.log(`    Board UUID: ${board.id}, Basecamp ID: ${board.bc_id}`);
                console.log(`    Total messages on this board in DB: ${count}`);

                // Fetch sample message if exists
                if (count > 0) {
                    const { data: sample } = await supabase
                        .from('bc_messages')
                        .select('id, title, created_at')
                        .eq('board_id', board.id)
                        .limit(1);
                    console.log(`    Sample Msg: "${sample[0].title}" (Created: ${sample[0].created_at})`);
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

run();
