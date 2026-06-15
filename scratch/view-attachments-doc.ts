async function run() {
    const url = 'https://raw.githubusercontent.com/basecamp/bc3-api/master/sections/attachments.md'
    const res = await fetch(url)
    if (res.ok) {
        const text = await res.text()
        console.log('Attachments Doc Content (first 2000 chars):')
        console.log(text.slice(0, 2000))
    } else {
        console.log('Failed:', res.status)
    }
}
run()
