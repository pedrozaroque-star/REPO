const supabaseUrl = "https://ywwwdcvgfculqmcfkihq.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA";

async function main() {
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/toast_menu_items?select=name,price,group_name,is_modifier,active&group_name=ilike.*burrito*&active=eq.true`, {
            headers: {
                "apikey": serviceRoleKey,
                "Authorization": `Bearer ${serviceRoleKey}`
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        console.log(`Found ${data.length} active items under Burrito groups`);
        
        // Group by group_name
        const grouped = {};
        data.forEach(m => {
            if (!grouped[m.group_name]) {
                grouped[m.group_name] = [];
            }
            grouped[m.group_name].push(m);
        });
        
        for (const [group, items] of Object.entries(grouped)) {
            console.log(`\nGroup: ${group} (${items.length} items)`);
            items.forEach(item => {
                console.log(`- "${item.name}" | Price: $${Number(item.price).toFixed(2)} | is_modifier: ${item.is_modifier}`);
            });
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
