/**
 * @module api/miles/submissions/route
 * @description API endpoint to fetch the audited history log of HR payroll submissions.
 * @businessRules
 * - Returns historical batches sent to HR with date, sender, recipient, supervisor counts, miles, and total reimbursement.
 * - Ordered by created_at descending (most recent first).
 * @dataFlow Client GET request -> Supabase ('mileage_hr_submissions') -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
  if (!auth.authorized) return auth.response!

  const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase()
  const isAdminOrCron = !auth.user || userRole === 'admin' || userRole === 'administrador'
  if (!isAdminOrCron) {
    return NextResponse.json({ success: true, submissions: [] })
  }

  try {
    const supabase = await getSupabaseAdminClient()

    const { data: submissions, error } = await supabase
      .from('mileage_hr_submissions')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error querying mileage_hr_submissions:', error.message)
      return NextResponse.json({ success: false, error: error.message, submissions: [] }, { status: 500 })
    }

    return NextResponse.json({ success: true, submissions: submissions || [] })
  } catch (err: any) {
    console.error('Error in GET /api/miles/submissions:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
