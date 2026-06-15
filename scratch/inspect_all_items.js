const supabaseUrl = "https://ywwwdcvgfculqmcfkihq.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA";
const fs = require('fs');
const path = require('path');

async function main() {
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/toast_menu_items?select=guid,name,price,group_name,is_modifier,active&active=eq.true`, {
            headers: {
                "apikey": serviceRoleKey,
                "Authorization": `Bearer ${serviceRoleKey}`
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        const products = data.filter(item => !item.is_modifier);
        
        let output = `Total Active Products: ${products.length}\n`;
        
        // Group by group_name
        const grouped = {};
        products.forEach(p => {
            if (!grouped[p.group_name]) {
                grouped[p.group_name] = [];
            }
            grouped[p.group_name].push(p);
        });
        
        // Print groups and items
        for (const [group, items] of Object.entries(grouped)) {
            output += `\n========================================\n`;
            output += `GROUP: ${group} (${items.length} items)\n`;
            output += `========================================\n`;
            items.sort((a,b) => a.name.localeCompare(b.name)).forEach(item => {
                output += `- "${item.name}" | Price: $${Number(item.price).toFixed(2)} | guid: ${item.guid}\n`;
            });
        }
        
        const outputPath = path.join(__dirname, 'inspect_all_items_output_utf8.txt');
        fs.writeFileSync(outputPath, output, 'utf8');
        console.log(`Saved output to ${outputPath}`);
        
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
