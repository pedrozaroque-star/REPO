import fs from 'fs'
import path from 'path'

const filePath = path.resolve(process.cwd(), 'app/api/basecamp/sync/route.ts')
const content = fs.readFileSync(filePath, 'utf8')

const lines = content.split('\n')
let braceCount = 0
const stack = []

for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let openCount = 0
    let closeCount = 0
    
    // Remove comments
    const cleanLine = line.replace(/\/\/.*$/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    
    for (let charIndex = 0; charIndex < cleanLine.length; charIndex++) {
        const char = cleanLine[charIndex]
        if (char === '{') {
            braceCount++
            stack.push({ lineNum: i + 1, lineContent: line.trim() })
        } else if (char === '}') {
            braceCount--
            stack.pop()
        }
    }
    // Print brace level if it's main blocks
    if (i > 700 && i < 760) {
        console.log(`Line ${i+1} [level=${braceCount}]: ${line}`)
    }
}

console.log('Final brace count:', braceCount)
if (braceCount !== 0) {
    console.log('Currently open blocks:')
    stack.forEach(item => {
        console.log(`Line ${item.lineNum}: ${item.lineContent}`)
    })
}
