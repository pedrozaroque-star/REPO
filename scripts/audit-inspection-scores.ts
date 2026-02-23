import { getSupabaseClient } from '../lib/supabase';

async function checkInspectionScores() {
    const supabase = await getSupabaseClient();

    // Get the most recent 5 inspections
    const { data: inspections, error } = await supabase
        .from('supervisor_inspections')
        .select('id, overall_score, service_score, meat_score, food_score, tortilla_score, cleaning_score, log_score, grooming_score, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error fetching inspections:', error);
        return;
    }

    console.log('--- RECENT INSPECTIONS SCORE AUDIT ---');
    inspections.forEach((ins, i) => {
        const categories = [
            ins.service_score,
            ins.meat_score,
            ins.food_score,
            ins.tortilla_score,
            ins.cleaning_score,
            // ins.log_score, // Not in the dashboard category list but in table
            ins.grooming_score
        ].filter(s => s !== null && s !== undefined);

        const calculatedAvg = categories.length > 0
            ? Math.round(categories.reduce((a, b) => a + b, 0) / categories.length)
            : 0;

        console.log(`\nInspection ${i + 1} [${ins.id}] at ${ins.created_at}`);
        console.log(`Stored Overall Score: ${ins.overall_score}%`);
        console.log(`Calculated Avg of 6 categories: ${calculatedAvg}%`);
        console.log(`Breakdown: Service: ${ins.service_score}, Meat: ${ins.meat_score}, Food: ${ins.food_score}, Tortilla: ${ins.tortilla_score}, Clean: ${ins.cleaning_score}, Grooming: ${ins.grooming_score}`);

        if (Math.abs((ins.overall_score || 0) - calculatedAvg) > 5) {
            console.log('!!! DISCREPANCY DETECTED !!!');
        }
    });

    // Also calculate the global averages like the dashboard does
    const totalOverall = inspections.reduce((a, b) => a + (b.overall_score || 0), 0);
    const avgOverall = Math.round(totalOverall / inspections.length);
    console.log(`\nGLOBAL DASHBOARD SIMULATION:`);
    console.log(`Global Score (Avg of Overall): ${avgOverall}%`);

    const catKeys = ['service_score', 'meat_score', 'food_score', 'tortilla_score', 'cleaning_score', 'grooming_score'];
    catKeys.forEach(key => {
        const vals = inspections.map(i => i[key]).filter(v => v !== null && v !== undefined);
        const avg = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
        console.log(`Avg ${key}: ${avg}%`);
    });
}

checkInspectionScores();
