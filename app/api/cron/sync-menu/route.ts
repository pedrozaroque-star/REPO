/**
 * @module api/cron/sync-menu
 * @description Cron job y endpoint administrativo que sincroniza el catálogo de menú y modificadores desde Toast POS hacia Supabase (`toast_menu_items`).
 *
 * @businessRules
 * - Solo ejecutable por Vercel Cron (`CRON_SECRET`) o personal directivo autenticado (`admin`, `supervisor`).
 *
 * @dataFlow
 * - Vercel Cron / Admin -> `GET /api/cron/sync-menu` -> `syncMenuFromToast()` -> `toast_menu_items` (Supabase).
 *
 * @notes
 * - Blindaje Fail-Closed (`verifyStaffAuth`): eliminada omisión comentada de autenticación.
 */
import { NextResponse } from 'next/server'
import { syncMenuFromToast } from '@/lib/inventory/toast-sync'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    try {
        const auth = verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor', 'manager', 'gerente', 'general_manager'], allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const result = await syncMenuFromToast()

        if (result.success) {
            return NextResponse.json({ message: 'Menu Synced Successfully', count: result.count })
        } else {
            return NextResponse.json({ error: result.error }, { status: 500 })
        }

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
