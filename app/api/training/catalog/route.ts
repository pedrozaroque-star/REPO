/**
 * @module app/api/training/catalog/route
 * @description API de catálogo y configuración SOP para el Módulo TRAINING (Academia SOP 4 Días Tacos Gavilan).
 *
 * @businessRules
 * - Combina los módulos de video SOP almacenados en `public.training_sop_modules` con el catálogo de respaldo `TRAINING_SOP_VIDEOS`.
 * - Cruza cada estación de trabajo de `STATION_POSITIONS_CATALOG` con sus actividades reales de Apertura, Regular y Cierre
 *   configuradas en `public.position_activities` y `public.operating_procedures` (Módulo Actividades).
 * - Permite a Administradores, Supervisores y Managers editar los pasos narrados (`steps_json`), tiempos meta (`target_prep_seconds`),
 *   recetas (`recipe_specs_json`) y preguntas de evaluación (`quiz_json`), regenerando automáticamente la voz masculina (`Orus`).
 *
 * @dataFlow
 * - `GET /api/training/catalog` -> `{ ok: true, modules, positions, stores, employees }`
 * - `PUT /api/training/catalog` -> actualiza `public.training_sop_modules` + regenera audio `Orus` en Supabase Storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  DEFAULT_FOUR_DAY_METHOD,
  STATION_POSITIONS_CATALOG,
  TRAINING_SOP_VIDEOS,
  TrainingSopModuleSpec,
  TrainingVideoStep,
} from '@/lib/training-sop-catalog';
import {
  DEFAULT_TRAINING_VOICE,
  getTrainingStepSpeech,
  isValidTrainingVoice,
  TrainingVoiceId,
} from '@/lib/training-tts';
import { getPositionMatchCandidates, normalizeText } from '@/lib/actividades-resolution';

export async function GET() {
  try {
    const [dbModulesRes, paRes, storesRes, empRes] = await Promise.all([
      supabaseAdmin
        .from('training_sop_modules')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('position_activities')
        .select(
          'id, position_key, shift, frequency, store_model, sort_order, operating_procedures(id, activity, shift_type, frequency, description, start_time, duration_minutes)'
        )
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('stores')
        .select('id, name, number, external_id')
        .order('number', { ascending: true }),
      supabaseAdmin
        .from('toast_employees')
        .select('id, first_name, last_name, chosen_name, email, store_ids')
        .eq('deleted', false)
        .order('first_name', { ascending: true })
        .limit(800),
    ]);

    const dbModules = dbModulesRes.data || [];
    const bySlug = new Map<string, any>();
    for (const row of dbModules) {
      bySlug.set(row.slug, row);
    }

    // Combinar módulos de DB con catálogo base para garantizar integridad total
    const modules: TrainingSopModuleSpec[] = TRAINING_SOP_VIDEOS.map((base) => {
      const dbRow = bySlug.get(base.slug);
      if (!dbRow) return base;
      return {
        slug: dbRow.slug,
        positionKey: dbRow.position_key || base.positionKey,
        groupKey: (dbRow.group_key as any) || base.groupKey,
        titleEs: dbRow.title_es || base.titleEs,
        titleEn: dbRow.title_en || base.titleEn,
        subtitleEs: dbRow.subtitle_es || base.subtitleEs,
        subtitleEn: dbRow.subtitle_en || base.subtitleEn,
        sourceVideoFilename: dbRow.source_video_filename || base.sourceVideoFilename,
        videoSlug: dbRow.video_slug || base.videoSlug,
        videoUrl: dbRow.video_url || base.videoUrl,
        durationSeconds: Number(dbRow.duration_seconds || base.durationSeconds),
        targetPrepSeconds: Number(dbRow.target_prep_seconds || base.targetPrepSeconds),
        grillTempFahrenheit:
          dbRow.grill_temp_fahrenheit !== null && dbRow.grill_temp_fahrenheit !== undefined
            ? Number(dbRow.grill_temp_fahrenheit)
            : base.grillTempFahrenheit,
        steps:
          Array.isArray(dbRow.steps_json) && dbRow.steps_json.length > 0
            ? dbRow.steps_json
            : base.steps,
        recipeSpecs:
          Array.isArray(dbRow.recipe_specs_json) && dbRow.recipe_specs_json.length > 0
            ? dbRow.recipe_specs_json
            : base.recipeSpecs,
        quiz:
          Array.isArray(dbRow.quiz_json) && dbRow.quiz_json.length > 0
            ? dbRow.quiz_json
            : base.quiz,
        dayPlan:
          Array.isArray(dbRow.day_plan_json) && dbRow.day_plan_json.length > 0
            ? dbRow.day_plan_json
            : base.dayPlan || DEFAULT_FOUR_DAY_METHOD,
        sortOrder: Number(dbRow.sort_order || base.sortOrder),
      };
    });

    // Agregar cualquier módulo extra creado en DB que no esté en el array estático
    for (const dbRow of dbModules) {
      if (!TRAINING_SOP_VIDEOS.some((b) => b.slug === dbRow.slug)) {
        modules.push({
          slug: dbRow.slug,
          positionKey: dbRow.position_key,
          groupKey: (dbRow.group_key as any) || 'cocina',
          titleEs: dbRow.title_es,
          titleEn: dbRow.title_en,
          subtitleEs: dbRow.subtitle_es || '',
          subtitleEn: dbRow.subtitle_en || '',
          sourceVideoFilename: dbRow.source_video_filename,
          videoSlug: dbRow.video_slug,
          videoUrl: dbRow.video_url,
          durationSeconds: Number(dbRow.duration_seconds || 60),
          targetPrepSeconds: Number(dbRow.target_prep_seconds || 60),
          grillTempFahrenheit: dbRow.grill_temp_fahrenheit,
          steps: Array.isArray(dbRow.steps_json) ? dbRow.steps_json : [],
          recipeSpecs: Array.isArray(dbRow.recipe_specs_json) ? dbRow.recipe_specs_json : [],
          quiz: Array.isArray(dbRow.quiz_json) ? dbRow.quiz_json : [],
          dayPlan: Array.isArray(dbRow.day_plan_json)
            ? dbRow.day_plan_json
            : DEFAULT_FOUR_DAY_METHOD,
          sortOrder: Number(dbRow.sort_order || 99),
        });
      }
    }

    const allPositionActivities = paRes.data || [];

    // Enriquecer cada estación con sus actividades reales de Apertura, Regular y Cierre del módulo Actividades
    const positions = STATION_POSITIONS_CATALOG.map((pos) => {
      const candidates = new Set(
        getPositionMatchCandidates(pos.positionKey).map(normalizeText)
      );
      if (pos.positionKey === 'ACTIVIDADES EXTRA 1') {
        for (let i = 1; i <= 6; i++) {
          candidates.add(normalizeText(`ACTIVIDADES EXTRA ${i}`));
        }
      }
      if (pos.positionKey === 'SHIFT_LEADER_MALE') {
        candidates.add(normalizeText('SHIFT_LEADER_FEMALE'));
      }

      const matched = allPositionActivities.filter((pa: any) =>
        candidates.has(normalizeText(pa.position_key || ''))
      );

      const seenIds = new Set<string>();
      const activities = [];
      for (const pa of matched) {
        const proc = Array.isArray(pa.operating_procedures)
          ? pa.operating_procedures[0]
          : pa.operating_procedures;
        if (!proc || !proc.activity) continue;
        const uniqueKey = `${proc.activity}:${pa.shift}`;
        if (seenIds.has(uniqueKey)) continue;
        seenIds.add(uniqueKey);
        activities.push({
          id: proc.id || pa.id,
          activity: proc.activity,
          shiftType: proc.shift_type || 'Regular',
          shift: pa.shift || 'AMBOS',
          frequency: pa.frequency || proc.frequency || 'Diario',
          description: proc.description || '',
          durationMinutes: proc.duration_minutes || 15,
        });
      }

      return {
        ...pos,
        activities,
      };
    });

    return NextResponse.json({
      ok: true,
      modules,
      positions,
      stores: storesRes.data || [],
      employees: empRes.data || [],
    });
  } catch (err: any) {
    console.error('[GET /api/training/catalog] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al cargar catálogo de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const slug = String(body.slug || '').trim();
    if (!slug) {
      return NextResponse.json(
        { ok: false, error: 'El slug del módulo SOP es obligatorio.' },
        { status: 400 }
      );
    }

    const voice: TrainingVoiceId = isValidTrainingVoice(body.voiceId)
      ? body.voiceId
      : DEFAULT_TRAINING_VOICE;
    const rawSteps: TrainingVideoStep[] = Array.isArray(body.steps) ? body.steps : [];

    // Sintetizar voz masculina para cualquier paso cuyo texto haya cambiado o no tenga audioUrl
    const updatedSteps: TrainingVideoStep[] = [];
    for (let i = 0; i < rawSteps.length; i++) {
      const s = rawSteps[i];
      let audioUrlEs = s.audioUrlEs;
      let audioUrlEn = s.audioUrlEn;

      if (s.narrationEs && (!audioUrlEs || body.regenerateVoice)) {
        try {
          const resEs = await getTrainingStepSpeech(
            s.narrationEs,
            'es',
            voice,
            Boolean(body.regenerateVoice)
          );
          audioUrlEs = resEs.publicUrl;
        } catch (e: any) {
          console.warn('[PUT /api/training/catalog] TTS ES warning:', e.message);
        }
      }
      if (s.narrationEn && (!audioUrlEn || body.regenerateVoice)) {
        try {
          const resEn = await getTrainingStepSpeech(
            s.narrationEn,
            'en',
            voice,
            Boolean(body.regenerateVoice)
          );
          audioUrlEn = resEn.publicUrl;
        } catch (e: any) {
          console.warn('[PUT /api/training/catalog] TTS EN warning:', e.message);
        }
      }

      updatedSteps.push({
        ...s,
        stepNumber: i + 1,
        audioUrlEs,
        audioUrlEn,
      });
    }

    const updatePayload: Record<string, any> = {
      steps_json: updatedSteps,
      voice_id: voice,
      updated_at: new Date().toISOString(),
    };

    if (body.titleEs) updatePayload.title_es = String(body.titleEs).trim();
    if (body.titleEn) updatePayload.title_en = String(body.titleEn).trim();
    if (body.subtitleEs !== undefined) updatePayload.subtitle_es = String(body.subtitleEs).trim();
    if (body.subtitleEn !== undefined) updatePayload.subtitle_en = String(body.subtitleEn).trim();
    if (body.targetPrepSeconds !== undefined) {
      updatePayload.target_prep_seconds = Number(body.targetPrepSeconds) || 60;
    }
    if (Array.isArray(body.recipeSpecs)) {
      updatePayload.recipe_specs_json = body.recipeSpecs;
    }
    if (Array.isArray(body.quiz)) {
      updatePayload.quiz_json = body.quiz;
    }
    if (body.updatedBy) {
      updatePayload.updated_by = String(body.updatedBy);
    }

    const { data, error } = await supabaseAdmin
      .from('training_sop_modules')
      .update(updatePayload)
      .eq('slug', slug)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      module: data,
      steps: updatedSteps,
    });
  } catch (err: any) {
    console.error('[PUT /api/training/catalog] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error actualizando módulo SOP' },
      { status: 500 }
    );
  }
}
