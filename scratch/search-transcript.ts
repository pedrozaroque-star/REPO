import fs from 'fs'
import readline from 'readline'
import path from 'path'

async function run() {
    const transcriptPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\4ceb2434-e87c-471e-9645-0aa73d71baea\\.system_generated\\logs\\transcript.jsonl'
    
    if (!fs.existsSync(transcriptPath)) {
        console.log(`Transcript not found at: ${transcriptPath}`)
        return
    }
    
    const fileStream = fs.createReadStream(transcriptPath)
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    })
    
    console.log('Searching transcript...')
    let lineNumber = 0
    let matchesCount = 0
    
    const keywords = ['google_document', 'cloud_files', 'google_doc', 'Weekly Operations', '4942652625']
    
    for await (const line of rl) {
        lineNumber++
        const matched = keywords.some(k => line.toLowerCase().includes(k.toLowerCase()))
        if (matched) {
            matchesCount++
            // Print a snippet of the line (first 250 chars) to see what it is
            console.log(`Line ${lineNumber}: ${line.slice(0, 300)}...`)
            if (matchesCount >= 100) {
                console.log('Too many matches, stopping.')
                break
            }
        }
    }
    console.log(`Search completed. Found ${matchesCount} matching steps.`)
}
run()
