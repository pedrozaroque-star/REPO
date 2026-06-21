async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=2026-06-01&endDate=2026-06-01');
        console.log('Server is running, status:', res.status);
    } catch (e: any) {
        console.log('Server is NOT running:', e.message);
    }
}
test();
