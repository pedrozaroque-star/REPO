import fs from 'fs'
import readline from 'readline'

async function run() {
    const transcriptPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\4ceb2434-e87c-471e-9645-0aa73d71baea\\.system_generated\\logs\\transcript.jsonl'
    
    if (!fs.existsSync(transcriptPath)) {
        console.log('Not found')
        return
    }
    
    const fileStream = fs.createReadStream(transcriptPath)
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    })
    
    const keywords = ['GoogleDocument', 'GoogleDoc', 'CloudFile', 'Weekly Operations', '4942652625']
    let lineNum = 0
    for await (const line of rl) {
        lineNum++
        if (keywords.some(k => line.includes(k))) {
            const obj = JSON.parse(line)
            console.log(`\n--- STEP ${lineNum} (Index: ${obj.step_index}) ---`)
            if (obj.thinking) {
                console.log(`Thinking: ${obj.thinking}`)
            }
            if (obj.content) {
                console.log(`Content: ${obj.content.slice(0, 500)}`)
            }
            if (obj.tool_calls) {
                console.log(`Tool Calls:`, JSON.stringify(obj.tool_calls, null, 2))
            }
        }
    }
}
run()
