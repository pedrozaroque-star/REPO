/**
 * @module api/support-chat/conversations/route
 * @description API route to manage TEG Assistant AI conversations per user, enabling listing and deleting stored question history.
 * @businessRules
 * - Derives user identity strictly from the verified server JWT (`auth.user.email` / `auth.user.id`), ignoring client query parameters (`user_email` / `user_id`) to prevent IDOR and PostgREST `.or()` filter injection.
 * - Enforces chronological descending order by `updated_at` for conversation indexing.
 * - `DELETE` verifies conversation ownership (`user_email` / `user_id`) before deletion unless `auth.user.role === 'admin'`.
 * @dataFlow
 * - GET: Client -> `verifyStaffAuth({ allowCron: false })` -> Fetch `assistant_conversations` via parameterized `.eq('user_email', ...)` -> JSON Array.
 * - DELETE: Client (`?id=`) -> `verifyStaffAuth({ allowCron: false })` + ownership check -> Delete `assistant_conversations` -> JSON Status.
 * @notes
 * - Cascading deletion is handled at the database level in Supabase.
 * - Blindaje anti-IDOR y anti-inyección PostgREST (2026-11-21): eliminado `.or(...)` interpolado y suplantación de `user_email`/`user_id`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffAuth } from '@/lib/auth-server';
import { supabaseAdmin } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const auth = verifyStaffAuth(req, { allowCron: false });
  if (!auth.authorized || !auth.user) return auth.response!;

  try {
    const authEmail = String(auth.user.email || '').trim();
    const authUserId = String(auth.user.id || '').trim();

    if (!authEmail && !authUserId) {
      return NextResponse.json({ error: 'No se pudo resolver la identidad del usuario autenticado.' }, { status: 401 });
    }

    let query = supabaseAdmin
      .from('assistant_conversations')
      .select('id, title, user_id, user_name, user_email, user_role, store_id, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (authEmail) {
      query = query.eq('user_email', authEmail);
    } else {
      query = query.eq('user_id', authUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Conversations API] Error fetching conversations:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversations: data || [] });
  } catch (error: any) {
    console.error('[Conversations API] Unexpected error in GET:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = verifyStaffAuth(req, { allowCron: false });
  if (!auth.authorized || !auth.user) return auth.response!;

  try {
    const { searchParams } = new URL(req.url);
    const conversationId = (searchParams.get('id') || '').trim();

    if (!conversationId || !UUID_RE.test(conversationId)) {
      return NextResponse.json({ error: 'Invalid or missing conversation id.' }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('assistant_conversations')
      .select('id, user_id, user_email')
      .eq('id', conversationId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }

    const roleLower = String(auth.user.role || auth.user.user_role || '').toLowerCase();
    const isAdmin = roleLower === 'admin' || roleLower === 'administrador';
    const emailMatches = Boolean(
      auth.user.email &&
      existing.user_email &&
      String(existing.user_email).trim().toLowerCase() === String(auth.user.email).trim().toLowerCase()
    );
    const idMatches = Boolean(
      auth.user.id &&
      existing.user_id &&
      String(existing.user_id).trim() === String(auth.user.id).trim()
    );

    if (!isAdmin && !emailMatches && !idMatches) {
      return NextResponse.json({ error: 'Acceso denegado: no puedes eliminar conversaciones de otro usuario.' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('assistant_conversations')
      .delete()
      .eq('id', conversationId);

    if (error) {
      console.error('[Conversations API] Error deleting conversation:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted_id: conversationId });
  } catch (error: any) {
    console.error('[Conversations API] Unexpected error in DELETE:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
