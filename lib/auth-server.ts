
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'

export interface DecodedUser {
    id: string
    email: string
    role: string // 'authenticated' usually
    user_role: string // 'admin', 'auditor', etc. in our custom claim
}

export function verifyAuthToken(token: string): DecodedUser | null {
    try {
        const rawSecret = JWT_SECRET.trim().replace(/^"(.*)"$/, '$1')
        const secret = rawSecret.length === 88 || rawSecret.includes('+') || rawSecret.includes('/')
            ? Buffer.from(rawSecret, 'base64')
            : rawSecret

        const decoded = jwt.verify(token, secret) as any

        // Return structured user data
        return {
            id: decoded.sub || decoded.id,
            email: decoded.email,
            role: decoded.role,
            user_role: decoded.user_role // Our critical custom claim
        }
    } catch (e) {
        console.error('Token verification failed:', e)
        return null
    }
}
