import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'

async function run() {
    const secret = JWT_SECRET.trim().replace(/^"(.*)"$/, '$1')
    const token = jwt.sign(
        {
          sub: 'test-user',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'carlos@tacosgavilan.com',
          user_role: 'admin',
          user_type: 'admin',
          user_metadata: {
            full_name: 'Carlos Roque',
            role: 'admin'
          }
        },
        secret,
        {
          algorithm: 'HS256',
          expiresIn: '1h'
        }
    )

    console.log('Generated JWT token:', token)

    try {
        const url = 'http://localhost:3000/api/basecamp/attachment?url=' + encodeURIComponent('https://preview.app.basecamp.com/5052386/blobs/3cfeab6a-c196-11f0-9114-0242ac120002/previews/full')
        const res = await fetch(url, {
            headers: {
                Cookie: `teg_token=${token}`
            },
            redirect: 'manual'
        })
        console.log('Local API status:', res.status)
        console.log('Local API location header:', res.headers.get('location'))
        if (res.status !== 307 && res.status !== 302) {
            console.log('Response body:', await res.text())
        }
    } catch (e: any) {
        console.log('Error calling localhost:3000. Is it running? Error:', e.message)
    }
}

run()
