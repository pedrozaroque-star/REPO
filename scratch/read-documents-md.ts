async function run() {
    const url = 'https://raw.githubusercontent.com/basecamp/bc3-api/master/sections/documents.md'
    const res = await fetch(url)
    if (res.ok) {
        console.log(await res.text())
    } else {
        console.log('Error:', res.status)
    }
}
run()
