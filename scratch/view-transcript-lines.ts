import fs from 'fs'
import readline from 'readline'

async function run() {
    const transcriptPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\4ceb2434-e87c-471e-9645-0aa73d71baea\\.system_generated\\logs\\transcript.jsonl'
    
    const fileStream = fs.createReadStream(transcriptPath)
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    })
    
    let lineNumber = 0
    const startLine = 3520
    const endLine = 3535
    
    for await (const line of rl) {
        lineNumber++
        if (lineNumber >= startLine && lineNumber <= endLine) {
            console.log(`Line ${lineNumber}: ${line}`)
        }
        if (lineNumber > endLine) {
            break
        }
    }
}
run()
