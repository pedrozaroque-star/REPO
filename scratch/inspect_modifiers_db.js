const supabaseUrl = "https://ywwwdcvgfculqmcfkihq.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA";
const fs = require('fs');
const path = require('path');

async function main() {
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/toast_menu_items?select=name,price,group_name,is_modifier,active&active=eq.true&is_modifier=eq.true`, {
            headers: {
                "apikey": serviceRoleKey,
                "Authorization": `Bearer ${serviceRoleKey}`
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        
        let output = `Total Active Modifiers: ${data.length}\n`;
        
        // Group by group_name
        const grouped = {};
        data.forEach(m => {
            if (!grouped[m.group_name]) {
                grouped[m.group_name] = [];
            }
            grouped[m.group_name].push(m);
        });
        
        // Print groups and items
        for (const [group, items] of Object.entries(grouped)) {
            output += `\n========================================\n`;
            output += `GROUP: ${group} (${items.length} modifiers)\n`;
            output += `========================================\n`;
            items.sort((a,b) => a.name.localeCompare(b.name)).forEach(item => {
                output += `- "${item.name}" | Price: $${Number(item.price).toFixed(2)}\n`;
            });
        }
        
        const outputPath = path.join(__dirname, 'inspect_modifiers_output_utf8.txt');
        fs.writeFileSync(outputPath, output, 'utf8');
        console.log(`Saved output to ${outputPath}`);
        
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
