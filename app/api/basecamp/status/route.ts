/**
 * @module api/basecamp/status
 * @description Ruta GET que verifica el estado global de la integración de Basecamp.
 *              Determina si existe un token de acceso guardado en Supabase.
 *
 * @businessRules
 * - **Estado Global**: La integración es a nivel de cuenta (global). Si existe algún token
 *   válido en `bc_oauth_tokens`, el sistema se considera "autorizado".
 * - **Seguridad**: No expone el token en sí, solo un indicador booleano.
 *
 * @dataFlow
 * - GET /api/basecamp/status → Consulta bc_oauth_tokens (service role) → Retorna { authorized: boolean, last_updated: string }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    )

    // Check if there is any token stored
    const { data, error } = await supabase
      .from('bc_oauth_tokens')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error) {
      throw error
    }

    const authorized = data && data.length > 0

    return NextResponse.json({
      authorized,
      last_updated: authorized ? data[0].updated_at : null,
    })
  } catch (error: any) {
    console.error('❌ [Basecamp Status] Error checking status:', error.message)
    return NextResponse.json(
      { error: `Failed to check status: ${error.message}` },
      { status: 500 }
    )
  }
}
