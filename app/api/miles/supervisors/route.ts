/**
 * @module api/miles/supervisors/route
 * @description API endpoint to fetch list of active system supervisors and admins for MilesIQ filters and trip logging.
 * @businessRules
 * - Dynamically queries the 'users' table for users with role 'supervisor' or 'admin'.
 * - Ensures any supervisor added or modified in the Users module (/usuarios) is automatically detected.
 * @dataFlow Client GET request -> Supabase ('users') -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
  if (!auth.authorized) return auth.response!

  try {
    const supabase = await getSupabaseAdminClient()
    const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase()
    const isAdminOrCron = !auth.user || userRole === 'admin' || userRole === 'administrador'

    let query = supabase
      .from('users')
      .select('id, full_name, email, role, store_id, is_active')
      .or('role.ilike.supervisor,role.ilike.admin')
      .eq('is_active', true)
      .order('full_name')

    if (!isAdminOrCron && auth.user?.id) {
      const numericUid = Number(auth.user.id)
      if (Number.isFinite(numericUid) && numericUid > 0) {
        query = query.eq('id', numericUid)
      }
    }

    const { data: users, error } = await query

    if (error) {
      console.warn('Warning fetching supervisors from users table:', error.message)
      return NextResponse.json({ success: true, supervisors: [] })
    }

    const supervisors = (users || []).map(u => ({
      id: String(u.id),
      name: u.full_name || u.email || 'Supervisor',
      email: u.email || '',
      role: u.role
    }))

    return NextResponse.json({ success: true, supervisors })
  } catch (err: any) {
    console.error('Error in GET /api/miles/supervisors:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
