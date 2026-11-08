/**
 * @module api/phone/dashboard
 * @description API administrativa y operativa para el módulo de Contestadora IA Multi-Sucursal (`/admin/llamadas`)
 * y para las alertas de recados prioritarios en la PC del Manager (`/order-ready-board`).
 *
 * @businessRules
 * - Centraliza la lectura y edición de:
 *   1. `phone_agent_config` (configuración por tienda, tipo de línea Spectrum vs AT&T, número Twilio, desvío, voz, EBT).
 *   2. `phone_knowledge_base` (Base de Conocimiento Editable global o por tienda).
 *   3. `phone_special_hours` (días festivos y horarios especiales).
 *   4. `phone_calls` (bitácora de llamadas, transcripciones y detector de preguntas nuevas).
 *   5. `phone_callback_requests` (recados prioritarios para el gerente en turno).
 * - Todas las operaciones matemáticas de porcentaje (`resolvedByAiPct`) previenen divisiones por cero (`0/0`).
 *
 * @dataFlow
 * - `/admin/llamadas` o `/order-ready-board` -> `GET / POST / PATCH / DELETE /api/phone/dashboard` -> Supabase (`supabaseAdmin`).
 *
 * @notes
 * - Protegido con `verifyStaffAuth`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  CarrierType,
  cleanPhoneStoreName,
  evaluateStoreSchedulePure,
  getCarrierForwardingInstructions,
  invalidateStorePhoneContextCache,
  StoreScheduleDay
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'

function sanitizeNestedStore<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== 'object') return row
  if (row.stores && typeof row.stores === 'object' && row.stores.name) {
    return {
      ...row,
      stores: {
        ...row.stores,
        name: cleanPhoneStoreName(row.stores.name)
      }
    }
  }
  return row
}

export async function GET(request: NextRequest) {
  try {
    const staff = await verifyStaffAuth(request)
    if (!staff.authorized) {
      return staff.response || NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const storeIdParam = searchParams.get('storeId')
    const filterStoreId = storeIdParam && storeIdParam !== 'all' ? Number(storeIdParam) : null
    const callbacksOnly = searchParams.get('callbacksOnly') === 'true'

    if (callbacksOnly) {
      let cbQuery = supabaseAdmin
        .from('phone_callback_requests')
        .select('*, stores(id, name)')
        .order('created_at', { ascending: false })
        .limit(50)

      if (filterStoreId && Number.isFinite(filterStoreId)) {
        cbQuery = cbQuery.eq('store_id', filterStoreId)
      }
      const statusFilter = searchParams.get('status')
      if (statusFilter) {
        cbQuery = cbQuery.eq('status', statusFilter)
      }

      const { data: callbacks, error: cbErr } = await cbQuery
      if (cbErr) throw cbErr
      return NextResponse.json({ callbacks: (callbacks || []).map(sanitizeNestedStore) })
    }

    const [storesRes, configsRes, kbRes, specialRes, callsRes, callbacksRes] = await Promise.all([
      supabaseAdmin
        .from('stores')
        .select('id, name, address, phone, has_drive_thru, weekly_hours')
        .order('id', { ascending: true }),
      supabaseAdmin.from('phone_agent_config').select('*').order('store_id', { ascending: true }),
      supabaseAdmin
        .from('phone_knowledge_base')
        .select('*, stores(id, name)')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('phone_special_hours')
        .select('*, stores(id, name)')
        .order('event_date', { ascending: true }),
      (() => {
        let q = supabaseAdmin
          .from('phone_calls')
          .select('*, stores(id, name)')
          .order('started_at', { ascending: false })
          .limit(120)
        if (filterStoreId && Number.isFinite(filterStoreId)) {
          q = q.eq('store_id', filterStoreId)
        }
        return q
      })(),
      (() => {
        let q = supabaseAdmin
          .from('phone_callback_requests')
          .select('*, stores(id, name)')
          .order('created_at', { ascending: false })
          .limit(100)
        if (filterStoreId && Number.isFinite(filterStoreId)) {
          q = q.eq('store_id', filterStoreId)
        }
        return q
      })()
    ])

    const stores = storesRes.data || []
    const configs = configsRes.data || []
    const specialHours = (specialRes.data || []).map(sanitizeNestedStore)
    const configByStore = new Map<number, any>()
    for (const c of configs) {
      configByStore.set(c.store_id, c)
    }

    const storeRows = stores.map((s) => {
      const cleanName = cleanPhoneStoreName(s.name)
      const cfg = configByStore.get(s.id) || {
        store_id: s.id,
        is_enabled: true,
        routing_mode: 'conditional_forward',
        carrier_type: [1, 8, 14, 16].includes(s.id) ? 'spectrum_landline' : 'att_wireless',
        twilio_phone_number: null,
        forwarding_status: 'pending',
        ring_timeout_seconds: 20,
        voice_id: 'Kore',
        default_language: 'es',
        custom_greeting_es: null,
        custom_greeting_en: null,
        manager_transfer_phone: null,
        allow_live_transfer: false,
        accepts_ebt: ![1, 9].includes(s.id),
        parking_notes_es: null,
        parking_notes_en: null
      }

      const scheduleEval = evaluateStoreSchedulePure({
        storeId: s.id,
        storeName: cleanName,
        weeklyHours: s.weekly_hours as Record<string, StoreScheduleDay>,
        specialHours
      })

      const forwardingGuide = getCarrierForwardingInstructions(
        (cfg.carrier_type || 'att_wireless') as CarrierType,
        cfg.twilio_phone_number,
        Number(cfg.ring_timeout_seconds || 20)
      )

      return {
        ...s,
        name: cleanName,
        config: cfg,
        scheduleEval,
        forwardingGuide
      }
    })

    const calls = (callsRes.data || []).map(sanitizeNestedStore)
    const callbacks = (callbacksRes.data || []).map(sanitizeNestedStore)

    const totalCalls = calls.length
    const resolvedByAiCount = calls.filter((c) => c.resolved_by_ai).length
    const resolvedByAiPct = totalCalls > 0 ? Math.round((resolvedByAiCount / totalCalls) * 1000) / 10 : 100
    const pendingCallbacksCount = callbacks.filter((cb) => cb.status === 'pending').length
    const estimatedCashierMinutesSaved = Math.round(resolvedByAiCount * 1.5)

    const unansweredQuestions = calls
      .filter((c) => c.unanswered_question && String(c.unanswered_question).trim().length > 0)
      .map((c) => ({
        callId: c.id,
        storeId: c.store_id,
        storeName: cleanPhoneStoreName((c.stores as any)?.name) || `Tienda #${c.store_id}`,
        question: c.unanswered_question,
        callerNumber: c.caller_number,
        startedAt: c.started_at
      }))

    return NextResponse.json({
      stores: storeRows,
      knowledgeBase: (kbRes.data || []).map(sanitizeNestedStore),
      specialHours,
      calls,
      callbacks,
      unansweredQuestions,
      kpis: {
        totalCalls,
        resolvedByAiCount,
        resolvedByAiPct,
        pendingCallbacksCount,
        estimatedCashierMinutesSaved,
        activeStoresCount: storeRows.filter((s) => s.config.is_enabled).length,
        verifiedForwardingCount: storeRows.filter((s) => s.config.forwarding_status === 'verified').length
      }
    })
  } catch (err: any) {
    console.error('[api/phone/dashboard] GET Error:', err)
    return NextResponse.json({ error: err?.message || 'Error al cargar dashboard telefónico' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const staff = await verifyStaffAuth(request)
    if (!staff.authorized) {
      return staff.response || NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const entity = String(body?.entity || '')

    if (entity === 'knowledge_base') {
      const storeId = body?.store_id ? Number(body.store_id) : null
      const category = String(body?.category || 'general').trim()
      const title = String(body?.title || '').trim()
      const questionKeywords = body?.question_keywords ? String(body.question_keywords).trim() : null
      const answerEs = String(body?.answer_es || '').trim()
      const answerEn = String(body?.answer_en || answerEs).trim()
      const priority = Number.isFinite(Number(body?.priority)) ? Number(body.priority) : 50

      if (!title || !answerEs) {
        return NextResponse.json({ error: 'Título y respuesta en español son obligatorios' }, { status: 400 })
      }

      const { data: created, error } = await supabaseAdmin
        .from('phone_knowledge_base')
        .insert({
          store_id: storeId,
          category,
          title,
          question_keywords: questionKeywords,
          answer_es: answerEs,
          answer_en: answerEn,
          is_active: true,
          priority
        })
        .select('*, stores(id, name)')
        .single()

      if (error) throw error
      invalidateStorePhoneContextCache()

      // Si provino de una pregunta sin respuesta detectada, limpiarla de phone_calls
      if (body?.resolveCallId) {
        await supabaseAdmin
          .from('phone_calls')
          .update({ unanswered_question: null })
          .eq('id', String(body.resolveCallId))
      }

      return NextResponse.json({ ok: true, item: sanitizeNestedStore(created) })
    }

    if (entity === 'special_hours') {
      const storeId = body?.store_id ? Number(body.store_id) : null
      const eventDate = String(body?.event_date || '').trim()
      const holidayName = String(body?.holiday_name || '').trim()
      const isClosed = Boolean(body?.is_closed)
      const openTime = isClosed ? null : String(body?.open_time || '08:00').trim()
      const closeTime = isClosed ? null : String(body?.close_time || '22:00').trim()

      if (!eventDate || !holidayName) {
        return NextResponse.json({ error: 'Fecha y nombre del día festivo son requeridos' }, { status: 400 })
      }

      const { data: created, error } = await supabaseAdmin
        .from('phone_special_hours')
        .insert({
          store_id: storeId,
          event_date: eventDate,
          holiday_name: holidayName,
          is_closed: isClosed,
          open_time: openTime,
          close_time: closeTime,
          notes_es: body?.notes_es || null,
          notes_en: body?.notes_en || null
        })
        .select('*, stores(id, name)')
        .single()

      if (error) throw error
      invalidateStorePhoneContextCache()
      return NextResponse.json({ ok: true, item: sanitizeNestedStore(created) })
    }

    return NextResponse.json({ error: 'Entidad POST no soportada' }, { status: 400 })
  } catch (err: any) {
    console.error('[api/phone/dashboard] POST Error:', err)
    return NextResponse.json({ error: err?.message || 'Error al guardar registro' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const staff = await verifyStaffAuth(request)
    if (!staff.authorized) {
      return staff.response || NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const entity = String(body?.entity || '')

    if (entity === 'store_config') {
      const storeId = Number(body?.store_id)
      if (!Number.isFinite(storeId)) {
        return NextResponse.json({ error: 'store_id inválido' }, { status: 400 })
      }

      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
        updated_by: staff.user?.email || String(staff.user?.id || 'admin')
      }

      const allowedFields = [
        'is_enabled',
        'routing_mode',
        'carrier_type',
        'twilio_phone_number',
        'forwarding_status',
        'ring_timeout_seconds',
        'voice_id',
        'default_language',
        'custom_greeting_es',
        'custom_greeting_en',
        'manager_transfer_phone',
        'allow_live_transfer',
        'accepts_ebt',
        'parking_notes_es',
        'parking_notes_en'
      ]

      for (const f of allowedFields) {
        if (body[f] !== undefined) {
          updates[f] = body[f]
        }
      }
      if (updates.forwarding_status === 'verified') {
        updates.forwarding_verified_at = new Date().toISOString()
      }

      const { data: updated, error } = await supabaseAdmin
        .from('phone_agent_config')
        .upsert({ store_id: storeId, ...updates }, { onConflict: 'store_id' })
        .select()
        .single()

      if (error) throw error
      invalidateStorePhoneContextCache(storeId)
      return NextResponse.json({ ok: true, config: updated })
    }

    if (entity === 'knowledge_base') {
      const id = String(body?.id || '')
      if (!id) {
        return NextResponse.json({ error: 'ID de regla requerido' }, { status: 400 })
      }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      for (const f of ['store_id', 'category', 'title', 'question_keywords', 'answer_es', 'answer_en', 'is_active', 'priority']) {
        if (body[f] !== undefined) {
          updates[f] = body[f]
        }
      }

      const { data: updated, error } = await supabaseAdmin
        .from('phone_knowledge_base')
        .update(updates)
        .eq('id', id)
        .select('*, stores(id, name)')
        .single()

      if (error) throw error
      invalidateStorePhoneContextCache()
      return NextResponse.json({ ok: true, item: sanitizeNestedStore(updated) })
    }

    if (entity === 'callback_request') {
      const id = String(body?.id || '')
      if (!id) {
        return NextResponse.json({ error: 'ID de recado requerido' }, { status: 400 })
      }

      const status = String(body?.status || 'resolved')
      const updates: Record<string, any> = {
        status,
        resolved_by: staff.user?.email || String(staff.user?.id || 'manager')
      }
      if (body?.resolution_notes !== undefined) {
        updates.resolution_notes = body.resolution_notes
      }
      if (status === 'resolved' || status === 'dismissed') {
        updates.resolved_at = new Date().toISOString()
      }

      const { data: updated, error } = await supabaseAdmin
        .from('phone_callback_requests')
        .update(updates)
        .eq('id', id)
        .select('*, stores(id, name)')
        .single()

      if (error) throw error
      return NextResponse.json({ ok: true, callback: sanitizeNestedStore(updated) })
    }

    return NextResponse.json({ error: 'Entidad PATCH no soportada' }, { status: 400 })
  } catch (err: any) {
    console.error('[api/phone/dashboard] PATCH Error:', err)
    return NextResponse.json({ error: err?.message || 'Error al actualizar registro' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const staff = await verifyStaffAuth(request)
    if (!staff.authorized) {
      return staff.response || NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const entity = searchParams.get('entity')
    const id = searchParams.get('id')

    if (!entity || !id) {
      return NextResponse.json({ error: 'entity e id requeridos' }, { status: 400 })
    }

    if (entity === 'knowledge_base') {
      const { error } = await supabaseAdmin.from('phone_knowledge_base').delete().eq('id', id)
      if (error) throw error
      invalidateStorePhoneContextCache()
      return NextResponse.json({ ok: true })
    }

    if (entity === 'special_hours') {
      const { error } = await supabaseAdmin.from('phone_special_hours').delete().eq('id', id)
      if (error) throw error
      invalidateStorePhoneContextCache()
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Entidad DELETE no soportada' }, { status: 400 })
  } catch (err: any) {
    console.error('[api/phone/dashboard] DELETE Error:', err)
    return NextResponse.json({ error: err?.message || 'Error al eliminar registro' }, { status: 500 })
  }
}
