async function run() {
    const url = 'https://raw.githubusercontent.com/basecamp/bc3-api/master/sections/webhooks.md'
    const res = await fetch(url)
    if (res.ok) {
        const text = await res.text()
        const lines = text.split('\n')
        console.log('Searching in webhooks.md for GoogleDocument/CloudFile...')
        lines.forEach((line, idx) => {
            const lower = line.toLowerCase()
            if (lower.includes('googledocument') || lower.includes('cloudfile')) {
                console.log(`L${idx+1}: ${line.trim()}`)
                // Print surrounding lines
                const start = Math.max(0, idx - 5)
                const end = Math.min(lines.length - 1, idx + 10)
                console.log(`--- Context L${start+1}-L${end+1} ---`)
                console.log(lines.slice(start, end).join('\n'))
                console.log('--------------------------------')
            }
        })
    } else {
        console.log('Failed to fetch:', res.status)
    }
}
run()
