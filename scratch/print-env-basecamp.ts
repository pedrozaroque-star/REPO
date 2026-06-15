import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
console.log('BASECAMP_ACCOUNT_ID:', process.env.BASECAMP_ACCOUNT_ID)
console.log('BASECAMP_USER_AGENT:', process.env.BASECAMP_USER_AGENT)
