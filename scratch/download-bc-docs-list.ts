async function run() {
    const url = 'https://api.github.com/repos/basecamp/bc3-api/contents/sections'
    console.log('Fetching files list from GitHub:', url)
    const res = await fetch(url, {
        headers: { 'User-Agent': 'SM-TEG-Sync' }
    })
    if (res.ok) {
        const data = await res.json()
        const files = data.map((f: any) => f.name)
        console.log('Files in sections/ directory:')
        console.log(files)
    } else {
        console.log('Error:', res.status, await res.text())
    }
}
run()
