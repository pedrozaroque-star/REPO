/**
 * @module app/api/training/enrollments/route
 * @description API de inscripciones, progreso de los 4 días, códigos de acceso temporal (`TG-XXXX`)
 * y emisión de Certificados Oficiales de Estación para el Módulo TRAINING de Tacos Gavilan.
 *
 * @businessRules
 * - Cada empleado en entrenamiento recibe un Código de Acceso Temporal único (`TG-XXXX`) válido por 4 días (96 horas),
 *   renovable con 1 clic por el Manager, Supervisor o Administrador.
 * - Progreso secuencial estructurado en 4 días:
 *   * Día 1: Observación de videos SOP con voz masculina IA (`Orus`) + Quiz Teórico (>= 80%).
 *   * Día 2: Práctica Supervisada (mínimo 5 repeticiones validadas con firma de Entrenador/Manager).
 *   * Día 3: Ejecución Autónoma y Velocidad de Línea (El aprendiz lo hace solo cumpliendo Tiempo Meta + Checklist).
 *   * Día 4: Certificación Oficial (Examen Teórico + Auditoría Práctica Ciega >= 90% -> Folio `TG-CERT-2026-XXXX`).
 * - Ninguna columna autocalculada se envía en payloads de `INSERT` o `UPDATE` (cumpliendo regla Postgres 428C9).
 *
 * @dataFlow
 * - `GET /api/training/enrollments` (o `?code=TG-XXXX`) -> `public.training_enrollments`
 * - `POST /api/training/enrollments` -> crea inscripción y genera código temporal `TG-XXXX`
 * - `PUT /api/training/enrollments` -> actualiza progreso de Día 1, Día 2, Día 3, Certificación Día 4 o extiende vigencia
 * - `DELETE /api/training/enrollments?id=...` -> elimina registro de entrenamiento
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, formatStoreName } from '@/lib/supabase';

function generateTemporaryCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `TG-${digits}`;
}

function generateCertificateFolio(storeId: number): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `TG-CERT-${year}-S${storeId}-${rand}`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const codeParam = (searchParams.get('code') || '').trim().toUpperCase();
    const storeIdParam = searchParams.get('store_id');
    const statusParam = searchParams.get('status');

    // 1. Consulta por Código de Acceso Temporal (Modo Aprendiz / Tableta)
    if (codeParam) {
      const normalizedCode = codeParam.startsWith('TG-') ? codeParam : `TG-${codeParam}`;
      const { data: enrollment, error } = await supabaseAdmin
        .from('training_enrollments')
        .select('*')
        .or(`access_code.ilike.${codeParam},access_code.ilike.${normalizedCode}`)
        .limit(1)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      if (!enrollment) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Código de entrenamiento no encontrado. Verifica tu código TG-XXXX con tu Manager.',
            errorEn: 'Training code not found. Please verify your TG-XXXX code with your Manager.',
          },
          { status: 404 }
        );
      }

      const now = new Date();
      const expiresAt = new Date(enrollment.expires_at);
      const isExpired = expiresAt.getTime() < now.getTime() && enrollment.status !== 'CERTIFIED';

      if (isExpired) {
        return NextResponse.json(
          {
            ok: false,
            expired: true,
            enrollment,
            error: 'Tu acceso temporal de 4 días ha expirado. Solicita a tu Manager que renueve tu pase.',
            errorEn: 'Your 4-day temporary access has expired. Ask your Manager to extend your pass.',
          },
          { status: 403 }
        );
      }

      await supabaseAdmin
        .from('training_enrollments')
        .update({ last_accessed_at: now.toISOString() })
        .eq('id', enrollment.id);

      return NextResponse.json({
        ok: true,
        enrollment: {
          ...enrollment,
          last_accessed_at: now.toISOString(),
        },
      });
    }

    // 2. Consulta general administrativa (Managers / Supervisores / Admins)
    let query = supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);

    if (storeIdParam && storeIdParam !== 'all') {
      const numericStore = Number(storeIdParam);
      if (!isNaN(numericStore) && numericStore > 0) {
        query = query.eq('store_id', numericStore);
      }
    }

    if (statusParam && statusParam !== 'all') {
      query = query.eq('status', statusParam);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const nowMs = Date.now();
    const enriched = (data || []).map((row: any) => {
      const expMs = new Date(row.expires_at).getTime();
      const hoursRemaining = Math.max(0, Math.round((expMs - nowMs) / (1000 * 60 * 60)));
      const isExpired = expMs < nowMs && row.status === 'IN_PROGRESS';
      return {
        ...row,
        hours_remaining: hoursRemaining,
        is_expired: isExpired,
      };
    });

    return NextResponse.json({
      ok: true,
      enrollments: enriched,
    });
  } catch (err: any) {
    console.error('[GET /api/training/enrollments] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al consultar entrenamientos' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const employeeName = String(body.employeeName || '').trim();
    const storeId = Number(body.storeId);
    const positionKey = String(body.positionKey || '').trim();
    const trainerName = String(body.trainerName || 'Manager de Turno').trim();
    const parsedEmpId = Number(body.employeeId);
    const employeeId =
      body.employeeId && Number.isInteger(parsedEmpId) && parsedEmpId > 0
        ? parsedEmpId
        : null;
    const employeePhone = body.employeePhone ? String(body.employeePhone).trim() : null;
    const durationDays = Math.max(1, Math.min(14, Number(body.durationDays || 4)));

    if (!employeeName || !storeId || isNaN(storeId) || !positionKey) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Nombre del empleado, sucursal y estación de trabajo son obligatorios.',
        },
        { status: 400 }
      );
    }

    // Obtener nombre limpio de la sucursal desde public.stores
    let storeName = String(body.storeName || '').trim();
    if (!storeName) {
      const { data: storeRow } = await supabaseAdmin
        .from('stores')
        .select('name')
        .eq('id', storeId)
        .maybeSingle();
      storeName = formatStoreName(storeRow?.name || `Sucursal #${storeId}`);
    }

    // Verificar si el empleado del Planificador ya tiene un entrenamiento para esta sucursal y estación
    const { data: existingEnrollment } = await supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .eq('store_id', storeId)
      .ilike('employee_name', employeeName)
      .eq('position_key', positionKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingEnrollment) {
      const expMs = new Date(existingEnrollment.expires_at).getTime();
      if (expMs < Date.now() && existingEnrollment.status !== 'CERTIFIED') {
        const refreshedExp = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
        const { data: refreshed } = await supabaseAdmin
          .from('training_enrollments')
          .update({
            expires_at: refreshedExp,
            status: 'IN_PROGRESS',
            trainer_name: trainerName || existingEnrollment.trainer_name,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingEnrollment.id)
          .select('*')
          .single();
        return NextResponse.json({
          ok: true,
          enrollment: refreshed || existingEnrollment,
          existed: true,
        });
      }
      return NextResponse.json({
        ok: true,
        enrollment: existingEnrollment,
        existed: true,
      });
    }

    // Generar código temporal único TG-XXXX
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

    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const insertPayload = {
      access_code: accessCode,
      employee_name: employeeName,
      employee_id: employeeId,
      employee_phone: employeePhone,
      store_id: storeId,
      store_name: storeName,
      position_key: positionKey,
      trainer_name: trainerName,
      current_day: 1,
      status: 'IN_PROGRESS',
      day1_completed: false,
      day1_videos_watched: [],
      day2_completed: false,
      day2_supervised_reps: 0,
      day2_checklist_json: {},
      day3_completed: false,
      day3_solo_reps: 0,
      day3_checklist_json: {},
      day4_completed: false,
      expires_at: expiresAt,
    };

    const { data, error } = await supabaseAdmin
      .from('training_enrollments')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      enrollment: data,
    });
  } catch (err: any) {
    console.error('[POST /api/training/enrollments] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error creando inscripción de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body.id || '').trim();
    const action = String(body.action || 'update_progress').trim();

    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'ID de inscripción requerido.' },
        { status: 400 }
      );
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { ok: false, error: 'Inscripción no encontrada.' },
        { status: 404 }
      );
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, any> = {
      updated_at: nowIso,
    };

    if (action === 'complete_day1') {
      const quizScore = Number(body.quizScore ?? existing.day1_quiz_score ?? 100);
      const videosWatched = Array.isArray(body.videosWatched)
        ? body.videosWatched
        : existing.day1_videos_watched || [];
      patch.day1_completed = true;
      patch.day1_completed_at = nowIso;
      patch.day1_quiz_score = quizScore;
      patch.day1_videos_watched = videosWatched;
      patch.current_day = Math.max(Number(existing.current_day || 1), 2);
    } else if (action === 'complete_day2') {
      patch.day2_completed = true;
      patch.day2_completed_at = nowIso;
      patch.day2_supervised_reps = Number(body.supervisedReps ?? existing.day2_supervised_reps ?? 5);
      if (body.checklistJson) patch.day2_checklist_json = body.checklistJson;
      if (body.supervisorNotes !== undefined) patch.day2_supervisor_notes = String(body.supervisorNotes);
      patch.day2_approved_by = String(body.approvedBy || existing.trainer_name || 'Manager');
      patch.current_day = Math.max(Number(existing.current_day || 2), 3);
    } else if (action === 'complete_day3') {
      patch.day3_completed = true;
      patch.day3_completed_at = nowIso;
      patch.day3_solo_reps = Number(body.soloReps ?? existing.day3_solo_reps ?? 5);
      if (body.bestTimeSeconds !== undefined && body.bestTimeSeconds !== null) {
        patch.day3_best_time_seconds = Number(body.bestTimeSeconds);
      }
      if (body.checklistJson) patch.day3_checklist_json = body.checklistJson;
      patch.day3_approved_by = String(body.approvedBy || existing.trainer_name || 'Manager');
      patch.current_day = Math.max(Number(existing.current_day || 3), 4);
    } else if (action === 'certify_day4') {
      const examScore = Math.min(100, Math.max(0, Number(body.examScore ?? 100)));
      const practicalScore = Math.min(100, Math.max(0, Number(body.practicalScore ?? 100)));
      const finalScore = Math.round((examScore + practicalScore) / 2);
      const passed = finalScore >= 90;

      patch.day4_exam_score = examScore;
      patch.day4_practical_score = practicalScore;
      patch.day4_final_score = finalScore;
      patch.day4_certified_by = String(body.certifiedBy || existing.trainer_name || 'Manager');

      if (passed) {
        patch.day4_completed = true;
        patch.day4_completed_at = nowIso;
        patch.status = 'CERTIFIED';
        patch.current_day = 4;
        patch.certificate_folio =
          existing.certificate_folio || generateCertificateFolio(Number(existing.store_id || 1));
      } else {
        patch.day4_completed = false;
        patch.status = 'NEEDS_REINFORCEMENT';
      }
    } else if (action === 'extend_access') {
      const extraDays = Math.max(1, Math.min(14, Number(body.extraDays || 4)));
      const baseMs = Math.max(Date.now(), new Date(existing.expires_at).getTime());
      patch.expires_at = new Date(baseMs + extraDays * 24 * 60 * 60 * 1000).toISOString();
      if (existing.status === 'EXPIRED') {
        patch.status = 'IN_PROGRESS';
      }
    } else {
      // Actualización parcial en tiempo real (videos vistos, reps, tiempo de cronómetro, checklist, cambio de día manual)
      if (Array.isArray(body.day1VideosWatched)) {
        patch.day1_videos_watched = body.day1VideosWatched;
      }
      if (body.day1QuizScore !== undefined) {
        patch.day1_quiz_score = Number(body.day1QuizScore);
      }
      if (body.day2SupervisedReps !== undefined) {
        patch.day2_supervised_reps = Number(body.day2SupervisedReps);
      }
      if (body.day2ChecklistJson !== undefined) {
        patch.day2_checklist_json = body.day2ChecklistJson;
      }
      if (body.day2SupervisorNotes !== undefined) {
        patch.day2_supervisor_notes = String(body.day2SupervisorNotes);
      }
      if (body.day3SoloReps !== undefined) {
        patch.day3_solo_reps = Number(body.day3SoloReps);
      }
      if (body.day3BestTimeSeconds !== undefined) {
        patch.day3_best_time_seconds = Number(body.day3BestTimeSeconds);
      }
      if (body.day3ChecklistJson !== undefined) {
        patch.day3_checklist_json = body.day3ChecklistJson;
      }
      if (body.currentDay !== undefined) {
        patch.current_day = Math.max(1, Math.min(4, Number(body.currentDay)));
      }
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('training_enrollments')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      enrollment: updated,
    });
  } catch (err: any) {
    console.error('[PUT /api/training/enrollments] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error actualizando progreso de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'ID requerido' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('training_enrollments')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[DELETE /api/training/enrollments] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error eliminando registro' },
      { status: 500 }
    );
  }
}
