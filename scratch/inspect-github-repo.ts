async function run() {
    const url = 'https://api.github.com/repos/basecamp/bc3-api/contents/sections'
    const res = await fetch(url, {
        headers: { 'User-Agent': 'SM-TEG-Sync' }
    })
    console.log('GitHub API Status:', res.status)
    if (res.ok) {
        const data = await res.json()
        console.log('Documentation files in sections/:')
        for (const file of data) {
            console.log(`- ${file.name} (download_url: ${file.download_url})`)
        }
    } else {
        console.log('Error:', await res.text())
    }
}
run()
