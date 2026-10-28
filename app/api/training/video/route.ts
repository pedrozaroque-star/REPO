/**
 * @module app/api/training/video/route
 * @description Endpoint para subir, reemplazar o eliminar el video SOP de cualquier producto con receta
 * en el Módulo TRAINING (Academia SOP Tacos Gavilan), adaptando automáticamente la Voz IA (`Orus`)
 * a la duración del video y los ingredientes reales de la receta.
 *
 * @businessRules
 * - Sube archivos `.mp4` / `.webm` / `.mov` al bucket público `training-media` (`videos/{slug}-{timestamp}.mp4`).
 * - Cuando se sube un video para un platillo con receta, distribuye proporcionalmente los pasos de su receta
 *   a lo largo de la duración del video (`durationSeconds`) y genera automáticamente los audios de Voz IA (`Orus`)
 *   en español e inglés para cada paso.
 * - Si el procedimiento cambia, permite reemplazar el video o eliminarlo (`DELETE`).
 *
 * @dataFlow
 * - `POST /api/training/video` (FormData) -> Supabase Storage (`training-media`) -> `training_sop_modules` + TTS (`Orus`)
 * - `DELETE /api/training/video?slug=...` -> Marca el video como eliminado en `training_sop_modules`
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  DEFAULT_FOUR_DAY_METHOD,
  TRAINING_SOP_VIDEOS,
  TrainingVideoStep,
} from '@/lib/training-sop-catalog';
import {
  DEFAULT_TRAINING_VOICE,
  ensureTrainingBucket,
  getTrainingStepSpeech,
  TRAINING_MEDIA_BUCKET,
} from '@/lib/training-tts';

function formatSecLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const slug = String(formData.get('slug') || '').trim();
    const titleEs = String(formData.get('titleEs') || slug).trim();
    const titleEn = String(formData.get('titleEn') || titleEs).trim();
    const positionKey = String(formData.get('positionKey') || 'BURRITOS').trim();
    const durationSeconds = Math.max(12, Number(formData.get('durationSeconds') || 45));
    const ingredientsRaw = String(formData.get('ingredientsJson') || '[]');
    const autoAdaptVoice = String(formData.get('autoAdaptVoice') ?? 'true') !== 'false';

    if (!slug) {
      return NextResponse.json(
        { ok: false, error: 'Falta el identificador del producto (slug).' },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { ok: false, error: 'Selecciona un archivo de video (.mp4, .webm o .mov) para subir.' },
        { status: 400 }
      );
    }

    await ensureTrainingBucket();

    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const storagePath = `videos/${slug}-${Date.now()}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(TRAINING_MEDIA_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || 'video/mp4',
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Error subiendo video a Storage: ${uploadErr.message}`);
    }

    const { data: pubData } = supabaseAdmin.storage
      .from(TRAINING_MEDIA_BUCKET)
      .getPublicUrl(storagePath);
    const publicVideoUrl = pubData.publicUrl;

    const baseModule = TRAINING_SOP_VIDEOS.find((m) => m.slug === slug);
    const { data: existingRow } = await supabaseAdmin
      .from('training_sop_modules')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    let parsedIngredients: Array<{ name: string; quantity: number; unit: string }> = [];
    try {
      parsedIngredients = JSON.parse(ingredientsRaw);
    } catch {
      parsedIngredients = [];
    }

    let stepsToSave: TrainingVideoStep[] =
      Array.isArray(existingRow?.steps_json) && existingRow.steps_json.length > 0
        ? existingRow.steps_json
        : baseModule?.steps || [];

    // Adaptar tiempos de los pasos automáticamente a la duración del nuevo video
    if (stepsToSave.length === 0 && parsedIngredients.length > 0) {
      const count = parsedIngredients.length;
      const segDuration = Math.max(4, Math.floor(durationSeconds / count));
      stepsToSave = parsedIngredients.map((ing, idx) => {
        const startSec = idx * segDuration;
        const endSec = idx === count - 1 ? durationSeconds : (idx + 1) * segDuration;
        return {
          id: `${slug}-step-${idx + 1}`,
          stepNumber: idx + 1,
          startSec,
          endSec,
          timestampLabel: `${formatSecLabel(startSec)} - ${formatSecLabel(endSec)}`,
          titleEs: `Paso ${idx + 1}: ${ing.name}`,
          titleEn: `Step ${idx + 1}: ${ing.name}`,
          narrationEs: `Paso ${idx + 1} para ${titleEs}: sirve exactamente ${ing.quantity} ${ing.unit} de ${ing.name}.`,
          narrationEn: `Step ${idx + 1} for ${titleEn}: serve exactly ${ing.quantity} ${ing.unit} of ${ing.name}.`,
          keyPortionEs: `${ing.quantity} ${ing.unit} ${ing.name}`,
          keyPortionEn: `${ing.quantity} ${ing.unit} ${ing.name}`,
          utensilEs: ing.unit === 'oz' ? 'Porcionador oficial' : 'Pinza / Mano enguantada',
          utensilEn: ing.unit === 'oz' ? 'Official scoop' : 'Tongs / Gloved hand',
        };
      });
    } else if (stepsToSave.length > 0 && durationSeconds > 0) {
      // Escalar proporcionalmente los pasos existentes a la duración real del nuevo video
      const count = stepsToSave.length;
      const segDuration = Math.max(3, Math.floor(durationSeconds / count));
      stepsToSave = stepsToSave.map((st, idx) => {
        const startSec = idx * segDuration;
        const endSec = idx === count - 1 ? durationSeconds : (idx + 1) * segDuration;
        return {
          ...st,
          stepNumber: idx + 1,
          startSec,
          endSec,
          timestampLabel: `${formatSecLabel(startSec)} - ${formatSecLabel(endSec)}`,
        };
      });
    }

    if (autoAdaptVoice && stepsToSave.length > 0) {
      const syncedSteps: TrainingVideoStep[] = [];
      for (const st of stepsToSave) {
        let audioUrlEs = st.audioUrlEs;
        let audioUrlEn = st.audioUrlEn;
        if (st.narrationEs && !audioUrlEs) {
          try {
            const ttsEs = await getTrainingStepSpeech(st.narrationEs, 'es', DEFAULT_TRAINING_VOICE);
            audioUrlEs = ttsEs.publicUrl;
          } catch (e) {
            console.warn('[POST /api/training/video] TTS ES fallback:', e);
          }
        }
        if (st.narrationEn && !audioUrlEn) {
          try {
            const ttsEn = await getTrainingStepSpeech(st.narrationEn, 'en', DEFAULT_TRAINING_VOICE);
            audioUrlEn = ttsEn.publicUrl;
          } catch (e) {
            console.warn('[POST /api/training/video] TTS EN fallback:', e);
          }
        }
        syncedSteps.push({ ...st, audioUrlEs, audioUrlEn });
      }
      stepsToSave = syncedSteps;
    }

    const recipeSpecsToSave =
      Array.isArray(existingRow?.recipe_specs_json) && existingRow.recipe_specs_json.length > 0
        ? existingRow.recipe_specs_json
        : baseModule?.recipeSpecs ||
          parsedIngredients.map((ing) => ({
            itemEs: ing.name,
            itemEn: ing.name,
            quantity: String(ing.quantity),
            unit: ing.unit,
            utensilEs: ing.unit === 'oz' ? 'Medida oficial' : 'Estándar de línea',
            utensilEn: ing.unit === 'oz' ? 'Official measure' : 'Line standard',
          }));

    const upsertPayload = {
      slug,
      position_key: positionKey || existingRow?.position_key || baseModule?.positionKey || 'BURRITOS',
      group_key: existingRow?.group_key || baseModule?.groupKey || 'cocina',
      title_es: titleEs || existingRow?.title_es || baseModule?.titleEs || slug,
      title_en: titleEn || existingRow?.title_en || baseModule?.titleEn || slug,
      subtitle_es: existingRow?.subtitle_es || baseModule?.subtitleEs || `Procedimiento oficial de ${titleEs}`,
      subtitle_en: existingRow?.subtitle_en || baseModule?.subtitleEn || `Official procedure for ${titleEn}`,
      source_video_filename: file.name,
      video_slug: slug,
      video_url: publicVideoUrl,
      duration_seconds: durationSeconds,
      target_prep_seconds: existingRow?.target_prep_seconds || baseModule?.targetPrepSeconds || 45,
      grill_temp_fahrenheit: existingRow?.grill_temp_fahrenheit ?? baseModule?.grillTempFahrenheit ?? null,
      steps_json: stepsToSave,
      recipe_specs_json: recipeSpecsToSave,
      quiz_json: existingRow?.quiz_json || baseModule?.quiz || [],
      day_plan_json: existingRow?.day_plan_json || baseModule?.dayPlan || DEFAULT_FOUR_DAY_METHOD,
      voice_id: DEFAULT_TRAINING_VOICE,
      sort_order: existingRow?.sort_order ?? baseModule?.sortOrder ?? 50,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { data: savedRow, error: saveErr } = await supabaseAdmin
      .from('training_sop_modules')
      .upsert(upsertPayload, { onConflict: 'slug' })
      .select('*')
      .single();

    if (saveErr) throw saveErr;

    return NextResponse.json({
      ok: true,
      videoUrl: publicVideoUrl,
      module: savedRow,
      steps: stepsToSave,
    });
  } catch (err: any) {
    console.error('[POST /api/training/video] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al subir el video de entrenamiento.' },
      { status: 500 }
    );
  }
}
