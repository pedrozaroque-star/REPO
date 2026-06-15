const supabaseUrl = "https://ywwwdcvgfculqmcfkihq.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA";

async function main() {
    try {
        console.log("Fetching one row from toast_menu_items to see schema...");
        const response = await fetch(`${supabaseUrl}/rest/v1/toast_menu_items?limit=1`, {
            headers: {
                "apikey": serviceRoleKey,
                "Authorization": `Bearer ${serviceRoleKey}`,
                "Prefer": "return=representation"
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        console.log("Schema columns of toast_menu_items:");
        if (data.length > 0) {
            console.log(Object.keys(data[0]));
            console.log("\nSample row:");
            console.log(JSON.stringify(data[0], null, 2));
        } else {
            console.log("No data found.");
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
