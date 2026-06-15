import fs from 'fs'

const logPath = 'c:\\Users\\pedro\\Desktop\\teg-modernizado\\server-debug.log'

async function run() {
    if (!fs.existsSync(logPath)) {
        console.log('No log file found')
        return
    }
    const content = fs.readFileSync(logPath, 'utf-8')
    const lines = content.split('\n')
    console.log(`Total lines: ${lines.length}`)
    const lastLines = lines.slice(-100)
    console.log('Last 100 lines:')
    console.log(lastLines.join('\n'))
}
run()
