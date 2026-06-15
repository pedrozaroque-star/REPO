async function run() {
    const url = 'https://raw.githubusercontent.com/basecamp/bc3-api/master/sections/documents.md'
    const res = await fetch(url)
    if (res.ok) {
        const text = await res.text()
        const lines = text.split('\n')
        console.log('Searching in documents.md for google/cloud/drive/doc/sheet...')
        lines.forEach((line, idx) => {
            const lower = line.toLowerCase()
            if (lower.includes('google') || lower.includes('drive') || lower.includes('cloud') || lower.includes('sheet')) {
                console.log(`L${idx+1}: ${line.trim()}`)
            }
        })
    } else {
        console.log('Failed to fetch:', res.status)
    }
}
run()
