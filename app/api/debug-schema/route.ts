import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  // Check what position_type values exist
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, full_name, role, position_type, store_id')
    .eq('is_active', true)
    .order('role');

  // Summarize position_types
  const positionCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};
  (users || []).forEach((u: any) => {
    const pos = u.position_type || '(null)';
    const role = u.role || '(null)';
    positionCounts[pos] = (positionCounts[pos] || 0) + 1;
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  });

  return NextResponse.json({
    totalActive: (users || []).length,
    positionTypes: positionCounts,
    roles: roleCounts,
    sampleUsers: (users || []).slice(0, 20).map((u: any) => ({
      name: u.full_name,
      role: u.role,
      position_type: u.position_type
    }))
  });
}
