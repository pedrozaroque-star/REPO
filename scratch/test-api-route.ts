import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function test() {
  const storeId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'; // Slauson
  const start = '2026-06-01';
  const end = '2026-06-07';

  // We can fetch from local server if it is running, or we can import the GET handler directly!
  // Since we don't know if the local server is running, let's mock the GET request by calling the handler code.
  // But wait, the GET handler is in app/api/roles/route.ts. We can just run a node script that calls the database query.
  // We already did that in check-week.ts and it returned 22 assignments.
  // Let's call the API directly using fetch if the local server is running!
  // Is the local server running? Let's check port 3000.
  try {
    const res = await fetch(`http://localhost:3000/api/roles?store_id=${storeId}&start_date=${start}&end_date=${end}`);
    const data = await res.json();
    console.log("Local API status: UP");
    console.log("Assignments count from API:", data.length);
    const sundayAssignments = data.filter((a: any) => a.assignment_date === '2026-06-07');
    console.log("Sunday assignments count from API:", sundayAssignments.length);
  } catch (e) {
    console.log("Local API is not running or returned error:", (e as any).message);
  }
}

test();
