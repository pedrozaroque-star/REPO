/**
 * @module app/api/training/ronos-auth/route
 * @description Endpoint de autenticación en tiempo real mediante PIN de 4 dígitos de RONOS
 * para el Módulo TRAINING (Academia SOP 4 Días Tacos Gavilan).
 *
 * @businessRules
 * - Utiliza exactamente la misma función `verifyRonosPin(storeId, pin)` del módulo Blindaje Delivery (`lib/delivery-armor.ts`),
 *   sincronizada en vivo contra RONOS API y `ronos_employee_timecards_cache`.
 * - Candado Anti-Suplantación (PIN Ownership Check): si el usuario eligió un colaborador específico en la lista,
 *   valida que el titular real del PIN en RONOS coincida con la persona seleccionada (evitando cruces de expediente).
 * - Crea o recupera el expediente oficial en `public.training_enrollments` usando exclusivamente las columnas
 *   reales de la tabla (`access_code`, `employee_name`, `position_key`, `day1_completed`..`day4_completed`, `expires_at`).
 *
 * @dataFlow
 * - `POST /api/training/ronos-auth` -> `verifyRonosPin(storeId, pin)` -> `public.training_enrollments` -> `{ ok: true, ronosEmployee, enrollment }`
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRonosPin } from '@/lib/delivery-armor';
import { formatStoreName, supabaseAdmin } from '@/lib/supabase';
import { normalizeText } from '@/lib/actividades-resolution';
import { STATION_POSITIONS_CATALOG } from '@/lib/training-sop-catalog';

function generateTemporaryCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `TG-${digits}`;
}

function generateCertificateFolio(storeId: number): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `TG-CERT-${year}-S${storeId}-${rand}`;
}

function namesMatchOwner(ronosFullName: string, selectedName: string): boolean {
  const normRonos = normalizeText(ronosFullName);
  const normSelected = normalizeText(selectedName);
  if (!normRonos || !normSelected) return false;
  if (normRonos === normSelected) return true;

  const ronosTokens = normRonos.split(/\s+/).filter((t) => t.length > 1);
  const selectedTokens = normSelected.split(/\s+/).filter((t) => t.length > 1);
  if (ronosTokens.length === 0 || selectedTokens.length === 0) return false;

  const ronosSet = new Set(ronosTokens);
  const matches = selectedTokens.filter((t) => ronosSet.has(t));
  const minRequired = Math.min(2, selectedTokens.length, ronosTokens.length);
  return matches.length >= minRequired;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      storeId,
      storeName,
      pin,
      employeeId,
      employeeName,
      expectedEmployeeName,
      employeePhone,
      positionKey,
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

    const requestedName = String(expectedEmployeeName || employeeName || '').trim();
    if (requestedName && !namesMatchOwner(verified.fullName, requestedName)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'PIN_OWNER_MISMATCH',
          pinOwnerName: verified.fullName,
          error: `El PIN ingresado pertenece a ${verified.fullName} y no coincide con ${requestedName}.`,
        },
        { status: 403 }
      );
    }

    const ronosCode = `RONOS-${verified.employeeUserId}`;
    const effectiveName = requestedName || verified.fullName.trim();
    const effectiveStation = String(stationKey || positionKey || 'BURRITOS').trim();
    const validPos = STATION_POSITIONS_CATALOG.find((p) => p.positionKey === effectiveStation);
    const resolvedPositionKey = validPos ? validPos.positionKey : 'BURRITOS';

    let cleanStoreName = String(storeName || '').trim();
    if (!cleanStoreName) {
      const { data: stRow } = await supabaseAdmin
        .from('stores')
        .select('name')
        .eq('id', numericStoreId)
        .maybeSingle();
      cleanStoreName = formatStoreName(stRow?.name || `Sucursal #${numericStoreId}`);
    }

    const parsedEmpId = Number(employeeId);
    const numericEmployeeId =
      employeeId && Number.isInteger(parsedEmpId) && parsedEmpId > 0 ? parsedEmpId : null;

    // Buscar si ya tiene expediente en public.training_enrollments usando columnas reales
    const { data: existingList, error: fetchErr } = await supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .eq('store_id', numericStoreId)
      .ilike('employee_name', effectiveName)
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchErr) {
      throw new Error(`Error consultando training_enrollments: ${fetchErr.message}`);
    }

    let enrollment = existingList?.[0] || null;
    const nowIso = new Date().toISOString();

    if (enrollment) {
      const expMs = new Date(enrollment.expires_at).getTime();
      const needsRefresh = Number.isFinite(expMs) && expMs < Date.now() && enrollment.status !== 'CERTIFIED';
      const patch: Record<string, any> = {
        last_accessed_at: nowIso,
        updated_at: nowIso,
      };
      if (needsRefresh) {
        patch.expires_at = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
        patch.status = 'IN_PROGRESS';
      }
      if (autoCertified && !enrollment.day4_completed) {
        patch.status = 'CERTIFIED';
        patch.current_day = 4;
        patch.day1_completed = true;
        patch.day1_completed_at = enrollment.day1_completed_at || nowIso;
        patch.day1_quiz_score = enrollment.day1_quiz_score ?? 100;
        patch.day2_completed = true;
        patch.day2_completed_at = enrollment.day2_completed_at || nowIso;
        patch.day2_supervised_reps = Math.max(5, Number(enrollment.day2_supervised_reps || 0));
        patch.day3_completed = true;
        patch.day3_completed_at = enrollment.day3_completed_at || nowIso;
        patch.day3_solo_reps = Math.max(5, Number(enrollment.day3_solo_reps || 0));
        patch.day4_completed = true;
        patch.day4_completed_at = enrollment.day4_completed_at || nowIso;
        patch.day4_final_score = enrollment.day4_final_score ?? 100;
        patch.certificate_folio = enrollment.certificate_folio || generateCertificateFolio(numericStoreId);
      }

      const { data: updated } = await supabaseAdmin
        .from('training_enrollments')
        .update(patch)
        .eq('id', enrollment.id)
        .select('*')
        .single();

      if (updated) {
        enrollment = updated;
      }
    } else {
      let accessCode = generateTemporaryCode();
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: dup } = await supabaseAdmin
          .from('training_enrollments')
          .select('id')
          .eq('access_code', accessCode)
          .maybeSingle();
        if (!dup) break;
        accessCode = generateTemporaryCode();
      }

      const isAlreadyCertified = Boolean(autoCertified);
      const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

      const insertPayload = {
        access_code: accessCode,
        employee_name: effectiveName,
        employee_id: numericEmployeeId,
        employee_phone: employeePhone ? String(employeePhone).trim() : null,
        store_id: numericStoreId,
        store_name: cleanStoreName,
        position_key: resolvedPositionKey,
        trainer_name: String(trainerName || 'Manager de Turno').trim(),
        current_day: isAlreadyCertified ? 4 : 1,
        status: isAlreadyCertified ? 'CERTIFIED' : 'IN_PROGRESS',
        day1_completed: isAlreadyCertified,
        day1_completed_at: isAlreadyCertified ? nowIso : null,
        day1_quiz_score: isAlreadyCertified ? 100 : null,
        day1_videos_watched: isAlreadyCertified ? validPos?.primaryVideoSlugs || [] : [],
        day2_completed: isAlreadyCertified,
        day2_completed_at: isAlreadyCertified ? nowIso : null,
        day2_supervised_reps: isAlreadyCertified ? 5 : 0,
        day2_checklist_json: {},
        day3_completed: isAlreadyCertified,
        day3_completed_at: isAlreadyCertified ? nowIso : null,
        day3_solo_reps: isAlreadyCertified ? 5 : 0,
        day3_checklist_json: {},
        day4_completed: isAlreadyCertified,
        day4_completed_at: isAlreadyCertified ? nowIso : null,
        day4_exam_score: isAlreadyCertified ? 100 : null,
        day4_practical_score: isAlreadyCertified ? 100 : null,
        day4_final_score: isAlreadyCertified ? 100 : null,
        certificate_folio: isAlreadyCertified ? generateCertificateFolio(numericStoreId) : null,
        expires_at: expiresAt,
        last_accessed_at: nowIso,
      };

      const { data: created, error: createErr } = await supabaseAdmin
        .from('training_enrollments')
        .insert(insertPayload)
        .select('*')
        .single();

      if (createErr || !created) {
        throw new Error(`Error creando expediente de entrenamiento: ${createErr?.message || 'Error desconocido'}`);
      }
      enrollment = created;
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
