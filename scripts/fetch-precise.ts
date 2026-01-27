
const addresses = [
    { name: 'Downey', q: '7947 E Florence Ave Downey CA' },
    { name: 'Bell', q: '4406 E Florence Ave Bell CA' },
    { name: 'Hollywood', q: '7070 Sunset Blvd Los Angeles CA' },
    { name: 'Huntington Park', q: '2425 E Florence Ave Huntington Park CA' },
    { name: 'LA Central', q: '1900 S Central Ave Los Angeles CA' },
    { name: 'La Puente', q: '13009 Valley Blvd La Puente CA' },
    { name: 'Lynwood', q: '3220 E Imperial Hwy Lynwood CA' },
    { name: 'Slauson', q: '5833 S Broadway Los Angeles CA' },
    { name: 'South Gate', q: '5800 Firestone Blvd South Gate CA' },
    { name: 'West Covina', q: '101 S Azusa Ave West Covina CA' },
    { name: 'Santa Ana', q: '1258 E 17th St Santa Ana CA' },
    { name: 'LA Broadway', q: '4380 S Broadway Los Angeles CA' }
]

async function run() {
    console.log("Fetching precise coordinates...")
    for (const addr of addresses) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr.q)}&format=json&limit=1`
            // Node 18+ has native fetch
            const res = await fetch(url, { headers: { 'User-Agent': 'TacosGavilanApp/1.0 (internal tool)' } })
            const data = await res.json()
            if (Array.isArray(data) && data.length > 0) {
                console.log(`${addr.name}: ${data[0].lat}, ${data[0].lon}`)
            } else {
                console.log(`${addr.name}: NOT FOUND`)
            }
            // Respect Nominatim rate limit (1 request/sec)
            await new Promise(r => setTimeout(r, 1200))
        } catch (e) {
            console.error(`Error fetching ${addr.name}:`, e)
        }
    }
}
run()
