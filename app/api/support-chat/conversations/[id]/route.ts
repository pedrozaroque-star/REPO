/**
 * @module api/support-chat/conversations/[id]/route
 * @description API route to fetch all messages and full context for a specific conversation by ID.
 * @businessRules
 * - Messages are retrieved in chronological ascending order (created_at ASC) to rebuild the full conversation.
 * - Supports instant re-loading of past questions and answers in TEG Assistant.
 * @dataFlow
 * - GET: Client (conversation_id) -> Query assistant_conversations + assistant_messages -> JSON Conversation with messages.
 * - DELETE: Client (conversation_id) -> Delete conversation from database -> JSON Status.
 * @notes Cascading foreign keys automatically delete child messages when the parent conversation is deleted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Missing conversation id.' }, { status: 400 });
    }

    // 1. Fetch conversation details
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('assistant_conversations')
      .select('id, title, user_id, user_name, user_email, user_role, store_id, created_at, updated_at')
      .eq('id', id)
      .single();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
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
    return NextResponse.json({ error: 'Internal server error.', details: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Missing conversation id.' }, { status: 400 });
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
    return NextResponse.json({ error: 'Internal server error.', details: error.message }, { status: 500 });
  }
}
