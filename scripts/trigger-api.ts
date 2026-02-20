
async function triggerApi() {
    const url = 'http://localhost:3000/api/inventory/food-cost?storeId=21634000000002131&startDate=2026-02-12&endDate=2026-02-15';
    console.log('Fetching:', url);
    const res = await fetch(url);
    console.log('Status:', res.status);
}
triggerApi();
