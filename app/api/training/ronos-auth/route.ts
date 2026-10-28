/**
 * @module app/api/training/ronos-auth/route
 * @description Endpoint de autenticación en tiempo real mediante PIN de 4 dígitos de RONOS
 * para el Módulo TRAINING (Academia SOP 4 Días Tacos Gavilan).
 *
 * @businessRules
 * - Utiliza exactamente la misma función `verifyRonosPin(storeId, pin)` del módulo Blindaje Delivery (`lib/delivery-armor.ts`),
 *   sincronizada en vivo contra RONOS API y `ronos_employee_timecards_cache`.
 * - Valida que el PIN corresponda a un colaborador activo en RONOS y sincroniza su expediente en `public.training_enrollments`.
 *
 * @dataFlow
 * - `POST /api/training/ronos-auth` -> `verifyRonosPin(storeId, pin)` -> `public.training_enrollments` -> `{ ok: true, ronosEmployee, enrollment }`
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRonosPin } from '@/lib/delivery-armor';
import { supabaseAdmin } from '@/lib/supabase';
import { STATION_POSITIONS_CATALOG } from '@/lib/training-sop-catalog';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      storeId,
      storeName,
      pin,
      employeeId,
      expectedEmployeeName,
      stationKey,
      trainerName,
      autoCertified,
    } = body || {};

    const numericStoreId = Number(storeId || 0);
    const cleanPin = String(pin || '').trim();

    if (!numericStoreId || numericStoreId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Selecciona una sucursal válida.' },
        { status: 400 }
      );
    }

    if (!/^\d{4}$/.test(cleanPin)) {
      return NextResponse.json(
        { ok: false, error: 'La clave de RONOS debe tener exactamente 4 dígitos numéricos.' },
        { status: 400 }
      );
    }

    const verified = await verifyRonosPin(numericStoreId, cleanPin);

    if (!verified.valid || !verified.employeeUserId || !verified.fullName) {
      return NextResponse.json(
        {
          ok: false,
          error: verified.error || 'Clave de RONOS incorrecta o colaborador inactivo en RONOS.',
        },
        { status: 401 }
      );
    }

    const ronosCode = `RONOS-${verified.employeeUserId}`;
    const effectiveName = String(expectedEmployeeName || verified.fullName).trim();
    const effectiveStation = String(stationKey || 'BURRITOS').trim();
    const posMeta = STATION_POSITIONS_CATALOG.find((p) => p.positionKey === effectiveStation);

    // Buscar si ya tiene expediente en training_enrollments
    const { data: existingList } = await supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .or(`employee_code.eq.${ronosCode},trainee_name.ilike.${effectiveName}`)
      .order('updated_at', { ascending: false })
      .limit(1);

    let enrollment = existingList?.[0] || null;

    if (!enrollment) {
      const isAlreadyCertified = Boolean(autoCertified);
      const nowIso = new Date().toISOString();
      const insertPayload = {
        store_id: numericStoreId,
        store_name: storeName || `Sucursal #${numericStoreId}`,
        trainee_name: effectiveName,
        employee_code: ronosCode,
        target_position_key: effectiveStation,
        target_position_label: posMeta?.labelEs || effectiveStation,
        trainer_name: trainerName || 'Gerente de Sucursal',
        current_day: isAlreadyCertified ? 4 : 1,
        status: isAlreadyCertified ? 'CERTIFIED' : 'IN_PROGRESS',
        day1_progress_json: isAlreadyCertified
          ? { watchedSlugs: posMeta?.primaryVideoSlugs || [], quizPassed: true, completedAt: nowIso }
          : { watchedSlugs: [], quizScores: {}, completedAt: null },
        day2_progress_json: isAlreadyCertified
          ? { supervisedReps: 5, completedAt: nowIso }
          : { supervisedReps: 0, checklist: {}, trainerNotes: '', completedAt: null },
        day3_progress_json: isAlreadyCertified
          ? { soloReps: 5, bestPrepSeconds: 38, completedAt: nowIso }
          : { soloReps: 0, bestPrepSeconds: null, checklist: {}, completedAt: null },
        day4_exam_json: isAlreadyCertified
          ? { examScore: 100, practicalScore: 100, completedAt: nowIso }
          : { examScore: null, practicalScore: null, managerSignOff: '', completedAt: null },
        final_score: isAlreadyCertified ? 100 : null,
        certified_at: isAlreadyCertified ? nowIso : null,
      };

      const { data: created, error: createErr } = await supabaseAdmin
        .from('training_enrollments')
        .insert(insertPayload)
        .select('*')
        .single();

      if (!createErr && created) {
        enrollment = created;
      }
    }

    return NextResponse.json({
      ok: true,
      ronosEmployee: {
        employeeUserId: verified.employeeUserId,
        fullName: verified.fullName,
        jobTitle: verified.jobTitle || 'Colaborador',
        ronosCode,
      },
      employeeId: employeeId || null,
      enrollment,
    });
  } catch (err: any) {
    console.error('[POST /api/training/ronos-auth] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al verificar PIN en RONOS.' },
      { status: 500 }
    );
  }
}
