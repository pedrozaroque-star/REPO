/**
 * @module api/support-chat/conversations/[id]/route
 * @description API route to fetch all messages and full context for a specific conversation by ID.
 * @businessRules
 * - Requires staff JWT (`verifyStaffAuth(req, { allowCron: false })`) and verifies conversation ownership (`user_email` / `user_id`) unless `auth.user.role === 'admin'`.
 * - Messages are retrieved in chronological ascending order (`created_at ASC`) to rebuild the full conversation.
 * @dataFlow
 * - GET: Client (`id`) -> `verifyStaffAuth` + ownership check -> Query `assistant_conversations` + `assistant_messages` -> JSON Conversation with messages.
 * - DELETE: Client (`id`) -> `verifyStaffAuth` + ownership check -> Delete conversation from database -> JSON Status.
 * @notes
 * - Cascading foreign keys automatically delete child messages when the parent conversation is deleted.
 * - Blindaje anti-IDOR (2026-11-21): validación estricta de titularidad en `GET` y `DELETE`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffAuth } from '@/lib/auth-server';
import { supabaseAdmin } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canAccessConversation(authUser: any, conversation: { user_email?: string | null; user_id?: string | null }): boolean {
  const roleLower = String(authUser?.role || authUser?.user_role || '').toLowerCase();
  if (roleLower === 'admin' || roleLower === 'administrador') return true;
  const emailMatches = Boolean(
    authUser?.email &&
    conversation.user_email &&
    String(conversation.user_email).trim().toLowerCase() === String(authUser.email).trim().toLowerCase()
  );
  const idMatches = Boolean(
    authUser?.id &&
    conversation.user_id &&
    String(conversation.user_id).trim() === String(authUser.id).trim()
  );
  return emailMatches || idMatches;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyStaffAuth(req, { allowCron: false });
  if (!auth.authorized || !auth.user) return auth.response!;

  try {
    const { id } = await params;

    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid or missing conversation id.' }, { status: 400 });
    }

    // 1. Fetch conversation details
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('assistant_conversations')
      .select('id, title, user_id, user_name, user_email, user_role, store_id, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }

    if (!canAccessConversation(auth.user, conversation)) {
      return NextResponse.json({ error: 'Acceso denegado a esta conversación.' }, { status: 403 });
    }

    // 2. Fetch all messages for this conversation
    const { data: messages, error: msgsError } = await supabaseAdmin
      .from('assistant_messages')
      .select('id, conversation_id, role, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (msgsError) {
      console.error('[Conversation Detail API] Error fetching messages:', msgsError);
      return NextResponse.json({ error: msgsError.message }, { status: 500 });
    }

    return NextResponse.json({
      conversation,
      messages: messages || []
    });
  } catch (error: any) {
    console.error('[Conversation Detail API] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyStaffAuth(req, { allowCron: false });
  if (!auth.authorized || !auth.user) return auth.response!;

  try {
    const { id } = await params;

    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid or missing conversation id.' }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('assistant_conversations')
      .select('id, user_id, user_email')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }

    if (!canAccessConversation(auth.user, existing)) {
      return NextResponse.json({ error: 'Acceso denegado: no puedes eliminar conversaciones de otro usuario.' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('assistant_conversations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Conversation Detail API] Error deleting conversation:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (error: any) {
    console.error('[Conversation Detail API] Unexpected error in DELETE:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
