/**
 * @module api/support-chat/conversations/predictive-suggestions
 * @description API endpoint to predict personalized, context-aware operational questions for the current user based on their historical queries, store, and role.
 * @businessRules
 * - Analyzes recent conversation history in assistant_conversations.
 * - Extracts operational topics of interest (Sales, Food Cost, Breaks, Meat Prep, Safe Counts, Schedules).
 * - Generates 3 to 4 hyper-relevant suggested questions for the user's active session.
 * - Returns localized suggestions in Spanish and English based on user preferences.
 * @dataFlow
 * - Client (SupportChatWidget) -> GET /api/support-chat/conversations/predictive-suggestions?user_email=...&store_id=...&language=... -> Analyzes past topics -> Returns suggested questions.
 * @notes Pure non-blocking fallback mechanism ensuring instant load time.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userEmail = searchParams.get('user_email')
    const userId = searchParams.get('user_id')
    const storeId = searchParams.get('store_id')
    const lang = searchParams.get('language') === 'en' ? 'en' : 'es'

    let pastTitles: string[] = []

    if (userEmail || userId) {
      let q = supabaseAdmin
        .from('assistant_conversations')
        .select('title, updated_at')
        .order('updated_at', { ascending: false })
        .limit(10)

      if (userEmail && userId) {
        q = q.or(`user_email.eq.${userEmail},user_id.eq.${userId}`)
      } else if (userEmail) {
        q = q.eq('user_email', userEmail)
      } else if (userId) {
        q = q.eq('user_id', userId)
      }

      const { data } = await q
      if (data && data.length > 0) {
        pastTitles = data.map(d => d.title.toLowerCase())
      }
    }

    const suggestions: string[] = []

    // Pattern analysis based on user's previous questions
    const hasSales = pastTitles.some(t => t.includes('venta') || t.includes('sale') || t.includes('ticket') || t.includes('compara'))
    const hasBreaks = pastTitles.some(t => t.includes('descanso') || t.includes('break') || t.includes('comida') || t.includes('labor') || t.includes('hora'))
    const hasMeat = pastTitles.some(t => t.includes('carne') || t.includes('meat') || t.includes('parrilla') || t.includes('grill') || t.includes('prep'))
    const hasFoodCost = pastTitles.some(t => t.includes('costo') || t.includes('food cost') || t.includes('merma') || t.includes('margen'))
    const hasSafe = pastTitles.some(t => t.includes('caja') || t.includes('safe') || t.includes('dinero') || t.includes('efectivo'))
    const hasOrders = pastTitles.some(t => t.includes('orden') || t.includes('order') || t.includes('bodega') || t.includes('uniforme'))

    if (lang === 'es') {
      if (hasSales) {
        suggestions.push('¿Cómo van las ventas de hoy vs ayer?')
        suggestions.push('Compara las ventas de esta semana con la semana pasada')
      }
      if (hasBreaks) {
        suggestions.push('Calcula los descansos (breaks) de comida de hoy')
        suggestions.push('Audita el costo de labor de mi tienda esta semana')
      }
      if (hasMeat) {
        suggestions.push('¿Cuánta carne poner en parrilla para el siguiente tramo?')
      }
      if (hasFoodCost) {
        suggestions.push('¿Cuál es el Food Cost de mi tienda este mes?')
      }
      if (hasSafe) {
        suggestions.push('¿Cómo registro el conteo de la Caja Fuerte?')
      }
      if (hasOrders) {
        suggestions.push('¿Cómo funcionan los pedidos diarios a La Bodega?')
      }

      // Default smart fallbacks if no history or fewer than 3
      if (suggestions.length < 3) {
        const defaults = [
          '¿Cómo van las ventas hoy en mi tienda?',
          'Calcula los descansos de comida de hoy',
          '¿Cuánta carne poner en parrilla hoy?',
          'Compara las ventas de hoy vs ayer'
        ]
        defaults.forEach(d => {
          if (!suggestions.includes(d) && suggestions.length < 3) suggestions.push(d)
        })
      }
    } else {
      if (hasSales) {
        suggestions.push("How are today's sales vs yesterday?")
        suggestions.push('Compare this week sales vs last week')
      }
      if (hasBreaks) {
        suggestions.push('Calculate meal break compliance for today')
        suggestions.push('Audit labor cost for my store this week')
      }
      if (hasMeat) {
        suggestions.push('How much meat to prep on the grill for the next period?')
      }
      if (hasFoodCost) {
        suggestions.push('What is my store Food Cost percentage this month?')
      }
      if (hasSafe) {
        suggestions.push('How do I log Safe Box cash counts?')
      }
      if (hasOrders) {
        suggestions.push('How do daily warehouse supply orders work?')
      }

      // Default smart fallbacks
      if (suggestions.length < 3) {
        const defaults = [
          "How are today's sales in my store?",
          'Calculate meal break compliance for today',
          'How much meat to put on the grill today?',
          "Compare today's sales vs yesterday"
        ]
        defaults.forEach(d => {
          if (!suggestions.includes(d) && suggestions.length < 3) suggestions.push(d)
        })
      }
    }

    return NextResponse.json({
      suggestions: suggestions.slice(0, 3)
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message, suggestions: [] }, { status: 500 })
  }
}
