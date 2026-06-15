const supabaseUrl = "https://ywwwdcvgfculqmcfkihq.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA";

async function main() {
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/toast_menu_items?select=name,price,group_name,is_modifier,active&active=eq.true`, {
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
        
        console.log(`Active Products in Database: ${products.length}`);
        
        // Print distinct taco items and burrito items to see what is inside
        const tacos = products.filter(p => p.group_name.toLowerCase().includes('taco'));
        const burritos = products.filter(p => p.group_name.toLowerCase().includes('burrito'));
        
        console.log("\n--- TACOS IN DB ---");
        tacos.forEach(t => console.log(`- "${t.name}" | Price: $${Number(t.price).toFixed(2)} | Group: "${t.group_name}"`));
        
        console.log("\n--- BURRITOS IN DB ---");
        burritos.slice(0, 15).forEach(b => console.log(`- "${b.name}" | Price: $${Number(b.price).toFixed(2)} | Group: "${b.group_name}"`));
        if (burritos.length > 15) {
            console.log(`... and ${burritos.length - 15} more burritos`);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
