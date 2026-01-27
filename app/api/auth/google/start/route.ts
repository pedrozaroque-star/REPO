
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const returnUrl = searchParams.get('returnUrl') || '/planificador'

    const clientId = process.env.GOOGLE_CLIENT_ID
    const redirectUri = `${new URL(req.url).origin}/api/auth/google/callback`

    // Scope crítico: gmail.send
    const scopes = [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email'
    ].join(' ')

    if (!clientId) {
        return NextResponse.json({ error: 'Google Client ID not configured' }, { status: 500 })
    }

    // Construir URL de autorización de Google
    // access_type=offline y prompt=consent son OBLIGATORIOS para obtener el refresh_token
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent&state=${encodeURIComponent(returnUrl)}`

    return NextResponse.redirect(url)
}
