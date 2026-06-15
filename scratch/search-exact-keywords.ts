import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function run() {
    const files = ['documents.md', 'uploads.md', 'vaults.md', 'recordings.md']
    const keywords = ['google', 'cloud', 'drive', 'dropbox', 'box', 'onedrive']
    
    for (const file of files) {
        const url = `https://raw.githubusercontent.com/basecamp/bc3-api/master/sections/${file}`
        const res = await fetch(url)
        if (res.ok) {
            const text = await res.text()
            const lines = text.split('\n')
            console.log(`\n=================== ${file} ===================`)
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]
                if (keywords.some(k => line.toLowerCase().includes(k))) {
                    console.log(`L${i+1}: ${line.trim()}`)
                }
            }
        }
    }
}
run()
