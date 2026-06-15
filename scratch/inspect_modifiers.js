const supabaseUrl = "https://ywwwdcvgfculqmcfkihq.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA";

async function main() {
    try {
        console.log("Fetching all active modifiers from the database...");
        const response = await fetch(`${supabaseUrl}/rest/v1/toast_menu_items?select=name,group_name,price,is_modifier,active&is_modifier=eq.true&active=eq.true`, {
            headers: {
                "apikey": serviceRoleKey,
                "Authorization": `Bearer ${serviceRoleKey}`
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        console.log(`Fetched ${data.length} active modifiers.\n`);

        const groups = {};
        data.forEach(item => {
            if (!groups[item.group_name]) {
                groups[item.group_name] = [];
            }
            groups[item.group_name].push(item);
        });

        console.log("--- MODIFIER GROUPS AND ITEMS ---");
        for (const [groupName, mods] of Object.entries(groups)) {
            console.log(`\nGroup: "${groupName}" (${mods.length} modifiers)`);
            mods.slice(0, 15).forEach(m => {
                console.log(`  - Name: "${m.name}" | Price: $${Number(m.price || 0).toFixed(2)}`);
            });
            if (mods.length > 15) {
                console.log(`  ... and ${mods.length - 15} more`);
            }
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
