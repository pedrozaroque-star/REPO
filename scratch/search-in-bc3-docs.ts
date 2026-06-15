import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function run() {
    const files = ['documents.md', 'uploads.md', 'vaults.md', 'recordings.md']
    const keywords = ['google', 'cloud', 'drive', 'link', 'url', 'sheet', 'doc']
    
    for (const file of files) {
        console.log(`\n==================================================`)
        console.log(`Searching in sections/${file}:`)
        const url = `https://raw.githubusercontent.com/basecamp/bc3-api/master/sections/${file}`
        try {
            const res = await fetch(url)
            if (res.ok) {
                const text = await res.text()
                const lines = text.split('\n')
                let found = 0
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i]
                    const matched = keywords.some(k => line.toLowerCase().includes(k))
                    if (matched) {
                        console.log(`  Line ${i+1}: ${line.trim()}`)
                        found++
                    }
                }
                console.log(`Found ${found} matching lines in ${file}`)
            } else {
                console.log(`Failed to fetch ${file}: ${res.status}`)
            }
        } catch (e: any) {
            console.error(`Error for ${file}:`, e.message)
        }
    }
}
run()
