async function run() {
    try {
        const res = await fetch('https://ywwwdcvgfculqmcfkihq.supabase.co/rest/v1/');
        console.log('Status:', res.status);
        console.log('Headers:');
        for (const [key, value] of res.headers.entries()) {
            console.log(`  ${key}: ${value}`);
        }
    } catch (e: any) {
        console.error('Fetch error:', e.message);
    }
}
run();
