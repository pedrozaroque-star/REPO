import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf-8')
const keys = env.split('\n').map(line => line.split('=')[0].trim()).filter(k => k && !k.startsWith('#'))
console.log('Keys found:', keys)
