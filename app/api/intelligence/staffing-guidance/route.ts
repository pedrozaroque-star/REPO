
import { NextRequest, NextResponse } from 'next/server'
import { generateSmartForecast } from '@/lib/intelligence'

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')
    const date = searchParams.get('date')

    if (!storeId || !date) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    try {
        const forecast = await generateSmartForecast(storeId, date)
        return NextResponse.json(forecast)
    } catch (e) {
        console.error(e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
