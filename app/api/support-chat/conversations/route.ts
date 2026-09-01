/**
 * @module api/support-chat/conversations/route
 * @description API route to manage TEG Assistant AI conversations per user, enabling listing and deleting stored question history.
 * @businessRules
 * - Stores all historical user queries linked by user_email, user_id, or store_id.
 * - Enforces chronological descending order by updated_at for conversation indexing.
 * - Allows managers and supervisors to review previous AI answers and recommendations anytime.
 * @dataFlow
 * - GET: Client -> Fetch assistant_conversations filtered by user_email / user_id -> JSON Array.
 * - DELETE: Client (conversation_id) -> Delete assistant_conversations (cascades to assistant_messages) -> JSON Status.
 * @notes Cascading deletion is handled at the database level in Supabase.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userEmail = searchParams.get('user_email');
    const userId = searchParams.get('user_id');

    if (!userEmail && !userId) {
      return NextResponse.json({ error: 'Missing user identification (user_email or user_id).' }, { status: 400 });
    }

    let query = supabaseAdmin
      .from('assistant_conversations')
      .select('id, title, user_id, user_name, user_email, user_role, store_id, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (userEmail && userId) {
      query = query.or(`user_email.eq.${userEmail},user_id.eq.${userId}`);
    } else if (userEmail) {
      query = query.eq('user_email', userEmail);
    } else if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Conversations API] Error fetching conversations:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversations: data || [] });
  } catch (error: any) {
    console.error('[Conversations API] Unexpected error in GET:', error);
    return NextResponse.json({ error: 'Internal server error.', details: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('id');

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversation id.' }, { status: 400 });
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
    return NextResponse.json({ error: 'Internal server error.', details: error.message }, { status: 500 });
  }
}
