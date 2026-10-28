/**
 * @module app/api/training/tts/route
 * @description Endpoint de síntesis de voz neuronal masculina ("Orus" / "Puck") y generación de guiones SOP con IA
 * para el Módulo TRAINING (Academia SOP 4 Días de Tacos Gavilan).
 *
 * @businessRules
 * - Sintetiza narraciones paso a paso con voz masculina neutra, cálida y humana (`Orus` por defecto).
 * - Incluye modo `ai-explain` para que Carlos o un Administrador puedan describir brevemente un paso o platillo
 *   y la IA redacte el guion instructivo bilingüe (ES/EN) respetando los gramajes oficiales de Tacos Gavilan,
 *   generando de inmediato el audio neuronal masculino en Supabase Storage.
 *
 * @dataFlow
 * - `GET /api/training/tts?text=...&lang=es|en&voice=Orus` -> `getTrainingStepSpeech()` -> stream `audio/wav`
 * - `POST /api/training/tts` `{ text, lang, voice, forceRegenerate, mode }` -> JSON con `publicUrl` o guion mejorado por IA.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_TRAINING_VOICE,
  getTrainingStepSpeech,
  isValidTrainingVoice,
  TrainingTtsLang,
  TrainingVoiceId,
} from '@/lib/training-tts';
import { getGeminiKeyPool } from '@/lib/order-ready-tts';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const text = (searchParams.get('text') || '').trim();
    const langParam = searchParams.get('lang');
    const lang: TrainingTtsLang = langParam === 'en' ? 'en' : 'es';
    const voiceParam = searchParams.get('voice');
    const voice: TrainingVoiceId = isValidTrainingVoice(voiceParam)
      ? voiceParam
      : DEFAULT_TRAINING_VOICE;
    const force = searchParams.get('regen') === '1';
    const format = searchParams.get('format');

    if (!text || text.length > 1500) {
      return NextResponse.json(
        { ok: false, error: 'Texto inválido o demasiado largo (máx 1500 caracteres).' },
        { status: 400 }
      );
    }

    const result = await getTrainingStepSpeech(text, lang, voice, force);

    if (format === 'json') {
      return NextResponse.json({
        ok: true,
        publicUrl: result.publicUrl,
        storagePath: result.storagePath,
        voice,
        lang,
      });
    }

    return new NextResponse(new Uint8Array(result.wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Training-Voice': voice,
        'X-Training-Audio-Url': result.publicUrl,
      },
    });
  } catch (err: any) {
    console.error('[GET /api/training/tts] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error generando voz masculina de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = body.mode || 'tts';
    const voice: TrainingVoiceId = isValidTrainingVoice(body.voice)
      ? body.voice
      : DEFAULT_TRAINING_VOICE;

    // Modo IA: Generar o perfeccionar explicación de un paso con IA + sintetizar voz masculina
    if (mode === 'ai-explain') {
      const dishTitle = String(body.dishTitle || 'Platillo Tacos Gavilan').trim();
      const stepTitle = String(body.stepTitle || 'Paso de preparación').trim();
      const rawHint = String(body.rawHint || body.narrationEs || '').trim();
      const stepNumber = Number(body.stepNumber || 1);

      const keys = getGeminiKeyPool();
      if (keys.length === 0) {
        return NextResponse.json(
          { ok: false, error: 'No GEMINI_API_KEY configured' },
          { status: 500 }
        );
      }

      const aiPrompt = `Eres el Director de Entrenamiento Operativo (SOP) de Tacos Gavilan.
Redacta la narración hablada para el Paso ${stepNumber} ("${stepTitle}") del módulo "${dishTitle}".
Notas o instrucciones del usuario: "${rawHint}"

Reglas estrictas de Tacos Gavilan:
- Nombre oficial de la marca: estrictamente "Tacos Gavilan".
- La narración será leída por una voz masculina neutra, cálida, clara y humana mientras el empleado nuevo ve el video.
- Sé directo, claro y preciso (entre 22 y 40 palabras).
- Respeta los gramajes oficiales cuando apliquen: Burrito (6 oz carne, 4 oz frijol, 6 oz arroz; Super añade 2.1 oz queso Jack, 2.3 oz aguacate, 1.5 oz crema), Torta (1 telera, 0.6 oz mayonesa, 1.5 oz frijol, 6 oz carne, 2.3 oz aguacate, NUNCA lleva crema), Mulita (1.5 oz carne; Super añade 1.15 oz aguacate, 0.75 oz crema), Quesadilla (6 oz carne; Super añade 1.5 oz crema, 2.3 oz aguacate), Plato (6 oz carne, 4 oz arroz, 4 oz frijol, 2 oz aguacate, 0.15 oz cotija), Taco (2 tortillas maíz, 1.5 oz carne), Plancha (250°F).

Devuelve ÚNICAMENTE un JSON válido con esta estructura exacta (sin markdown):
{"narrationEs":"...","narrationEn":"...","keyPortionEs":"...","keyPortionEn":"..."}`;

      let narrationEs = rawHint;
      let narrationEn = String(body.narrationEn || rawHint);
      let keyPortionEs = String(body.keyPortionEs || '');
      let keyPortionEn = String(body.keyPortionEn || '');

      for (const key of keys) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: aiPrompt }] }],
                generationConfig: { temperature: 0.25 },
              }),
            }
          );
          if (res.ok) {
            const data: any = await res.json();
            const rawText =
              data.candidates?.[0]?.content?.parts
                ?.map((p: any) => p.text)
                .join('\n') || '';
            const cleaned = rawText.replace(/```json|```/gi, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed.narrationEs) narrationEs = parsed.narrationEs;
            if (parsed.narrationEn) narrationEn = parsed.narrationEn;
            if (parsed.keyPortionEs) keyPortionEs = parsed.keyPortionEs;
            if (parsed.keyPortionEn) keyPortionEn = parsed.keyPortionEn;
            break;
          }
        } catch {
          // try next key
        }
      }

      const [ttsEs, ttsEn] = await Promise.all([
        getTrainingStepSpeech(narrationEs, 'es', voice, true),
        getTrainingStepSpeech(narrationEn, 'en', voice, true),
      ]);

      return NextResponse.json({
        ok: true,
        narrationEs,
        narrationEn,
        keyPortionEs,
        keyPortionEn,
        audioUrlEs: ttsEs.publicUrl,
        audioUrlEn: ttsEn.publicUrl,
      });
    }

    // Modo estándar: sintetizar texto específico
    const text = String(body.text || '').trim();
    const lang: TrainingTtsLang = body.lang === 'en' ? 'en' : 'es';
    const forceRegenerate = Boolean(body.forceRegenerate);

    if (!text || text.length > 1500) {
      return NextResponse.json(
        { ok: false, error: 'Texto requerido (máx 1500 caracteres).' },
        { status: 400 }
      );
    }

    const result = await getTrainingStepSpeech(text, lang, voice, forceRegenerate);
    return NextResponse.json({
      ok: true,
      publicUrl: result.publicUrl,
      storagePath: result.storagePath,
      voice,
      lang,
    });
  } catch (err: any) {
    console.error('[POST /api/training/tts] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error en servicio de voz de entrenamiento' },
      { status: 500 }
    );
  }
}
