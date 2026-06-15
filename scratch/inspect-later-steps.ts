import fs from 'fs'
import readline from 'readline'

async function run() {
    const transcriptPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\4ceb2434-e87c-471e-9645-0aa73d71baea\\.system_generated\\logs\\transcript.jsonl'
    
    const fileStream = fs.createReadStream(transcriptPath)
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    })
    
    for await (const line of rl) {
        const obj = JSON.parse(line)
        if (obj.step_index >= 3568 && obj.step_index <= 3600) {
            console.log(`\n--- STEP ${obj.step_index} ---`)
            console.log(`Type: ${obj.type} | Status: ${obj.status} | Source: ${obj.source}`)
            if (obj.thinking) console.log(`Thinking: ${obj.thinking}`)
            if (obj.content) console.log(`Content: ${obj.content.slice(0, 500)}`)
            if (obj.tool_calls) console.log(`Tool Calls:`, JSON.stringify(obj.tool_calls, null, 2))
        }
    }
}
run()
