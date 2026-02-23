import { getSupabaseClient } from '../lib/supabase';

async function auditSupervisors() {
    const supabase = await getSupabaseClient();

    // Get stats for Estefani and Ricardo
    const { data: inspections, error } = await supabase
        .from('supervisor_inspections')
        .select(`
            id, overall_score, service_score, meat_score, food_score, 
            tortilla_score, cleaning_score, grooming_score, log_score,
            users!inspector_id(full_name),
            created_at
        `)
        .ilike('users.full_name', '%r%') // Search for Ricardo or Estefani approx
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error fetching:', error);
        return;
    }

    console.log('--- AUDIT ESTEFANI / RICARDO ---');
    const filtered = (inspections || []).filter((i: any) =>
        i.users?.full_name?.includes('Ricardo') || i.users?.full_name?.includes('Estefani')
    );

    filtered.forEach((ins, i) => {
        const catStats = [
            ins.service_score, ins.meat_score, ins.food_score,
            ins.tortilla_score, ins.cleaning_score, ins.grooming_score
        ];
        const hasStats = catStats.some(s => s > 0);

        console.log(`\nInspector: ${ins.users?.full_name} | Total: ${ins.overall_score}%`);
        console.log(`Detailed Cats: ${catStats.join(', ')}`);
        console.log(`Log Score: ${ins.log_score}`);
        console.log(`Has Category Stats (>0): ${hasStats}`);
    });
}

auditSupervisors();
