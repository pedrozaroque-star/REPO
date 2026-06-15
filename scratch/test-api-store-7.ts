async function test() {
  const storeId = '7'; // Slauson ID in client
  const start = '2026-06-01';
  const end = '2026-06-07';

  try {
    const res = await fetch(`http://localhost:3000/api/roles?store_id=${storeId}&start_date=${start}&end_date=${end}`);
    const data = await res.json();
    console.log("Assignments count from API with store_id=7:", data.length);
  } catch (e) {
    console.log("Error:", (e as any).message);
  }
}

test();
