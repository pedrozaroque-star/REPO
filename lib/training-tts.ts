/**
 * @module lib/training-tts
 * @description Motor de síntesis de voz neuronal masculina (Gemini 3.8 Neural TTS - Voz "Orus" / "Puck")
 * para el Módulo TRAINING (Academia SOP 4 Días de Tacos Gavilan).
 *
 * @businessRules
 * - Voz por defecto: `Orus` (Voz masculina neutra, cálida, firme y muy humana para instrucción SOP).
 * - Segunda opción masculina: `Puck` (Voz masculina dinámica y amable).
 * - Bloqueo estricto de cualquier voz robótica del navegador como Microsoft Raúl (`isForbiddenRaulVoice`).
 * - Caché permanente en Supabase Storage (bucket público `training-media` en `voiceovers/{voice}/{lang}/{md5}.wav`).
 * - Soporta textos de pasos de hasta 1,200 caracteres tanto en Español (`es`) como en Inglés (`en`).
 *
 * @dataFlow
 * - `POST / GET /api/training/tts` -> `getTrainingStepSpeech()` -> Supabase Storage (`training-media`)
 *   -> si no existe: Gemini 3.8 TTS (`Orus`) -> WAV 24kHz -> Storage -> `audio/wav` + URL pública.
 *
 * @notes
 * - Reutiliza el pool de llaves `getGeminiKeyPool()` de `lib/order-ready-tts.ts` con rotación round-robin.
 */

import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getGeminiKeyPool, isForbiddenRaulVoice } from '@/lib/order-ready-tts';

export const TRAINING_MALE_VOICES = [
  {
    id: 'Orus',
    name: 'Orus',
    gender: 'male',
    labelEs: 'Orus (Masculina • Neutra, Cálida y Muy Humana)',
    labelEn: 'Orus (Male • Neutral, Warm & Human Instructor)',
  },
  {
    id: 'Puck',
    name: 'Puck',
    gender: 'male',
    labelEs: 'Puck (Masculina • Dinámica y Amable)',
    labelEn: 'Puck (Male • Upbeat & Friendly Instructor)',
  },
] as const;

export type TrainingVoiceId = (typeof TRAINING_MALE_VOICES)[number]['id'];
export type TrainingTtsLang = 'es' | 'en';

export const TRAINING_MEDIA_BUCKET = 'training-media';
export const DEFAULT_TRAINING_VOICE: TrainingVoiceId = 'Orus';

const TTS_MODELS = [
  'gemini-3.8-flash-lite-tts',
  'gemini-3.8-flash-tts',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
];

let bucketInitialized = false;
let rrIndex = 0;
const inflightMap = new Map<string, Promise<{ wav: Buffer; publicUrl: string }>>();
const keyCooldown = new Map<string, number>();

export { isForbiddenRaulVoice };

export function isValidTrainingVoice(v: string | null | undefined): v is TrainingVoiceId {
  if (!v) return false;
  return TRAINING_MALE_VOICES.some((item) => item.id === v);
}

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitDepth) / 8, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function ensureWavBuffer(data: Buffer): Buffer {
  if (data.length >= 4 && data.subarray(0, 4).toString('ascii') === 'RIFF') {
    return data;
  }
  return pcmToWav(data);
}

export async function ensureTrainingBucket(): Promise<void> {
  if (bucketInitialized) return;
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === TRAINING_MEDIA_BUCKET);
    if (!exists) {
      await supabaseAdmin.storage.createBucket(TRAINING_MEDIA_BUCKET, {
        public: true,
        fileSizeLimit: 52428800, // 50 MB
      });
    } else {
      await supabaseAdmin.storage.updateBucket(TRAINING_MEDIA_BUCKET, {
        public: true,
        fileSizeLimit: 52428800,
      });
    }
    bucketInitialized = true;
  } catch {
    // Ignore transient bucket check errors
  }
}

export function getTrainingAudioStoragePath(
  text: string,
  lang: TrainingTtsLang = 'es',
  voice: TrainingVoiceId = DEFAULT_TRAINING_VOICE
): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  const hash = createHash('md5')
    .update(`v1:${voice}:${lang}:${clean.toLowerCase()}`)
    .digest('hex');
  return `voiceovers/${voice}/${lang}/${hash}.wav`;
}

export function getTrainingAudioPublicUrl(storagePath: string): string {
  const { data } = supabaseAdmin.storage.from(TRAINING_MEDIA_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function synthesizeTrainingVoiceWithGemini(
  textToSpeak: string,
  lang: TrainingTtsLang,
  voice: TrainingVoiceId
): Promise<Buffer> {
  const allKeys = getGeminiKeyPool();
  if (allKeys.length === 0) {
    throw new Error('No GEMINI_API_KEY configured for Training TTS');
  }

  const now = Date.now();
  const availableKeys = allKeys.filter((k) => (keyCooldown.get(k) || 0) <= now);
  const candidateKeys = availableKeys.length > 0 ? availableKeys : allKeys;

  const startIdx = (rrIndex++) % candidateKeys.length;
  const rotatedKeys = [
    ...candidateKeys.slice(startIdx),
    ...candidateKeys.slice(0, startIdx),
  ];

  const languageCode = lang === 'es' ? 'es-US' : 'en-US';
  const stylePrompt =
    lang === 'es'
      ? 'warm, clear, neutral, calm, articulate and very human male chef instructor explaining a restaurant recipe and standard operating procedure step by step in natural Latin American Spanish'
      : 'warm, clear, neutral, calm, articulate and very human male chef instructor explaining a restaurant recipe and standard operating procedure step by step';

  let lastError = '';

  for (const model of TTS_MODELS) {
    for (const key of rotatedKeys) {
      const kmKey = `${key}:${model}`;
      if ((keyCooldown.get(kmKey) || 0) > Date.now()) continue;

      try {
        const promptText = model.includes('3.8')
          ? textToSpeak
          : lang === 'es'
          ? `Say in a warm, neutral, clear, natural Latin American Spanish male instructor voice: "${textToSpeak}"`
          : `Say in a warm, neutral, clear, natural male instructor voice: "${textToSpeak}"`;

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'x-goog-api-key': key,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(22000),
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: promptText,
                      ...(model.includes('3.8')
                        ? {
                            speech_metadata: {
                              style: stylePrompt,
                            },
                          }
                        : {}),
                    },
                  ],
                },
              ],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  languageCode,
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: voice,
                    },
                  },
                },
              },
            }),
          }
        );

        if (res.ok) {
          const json: any = await res.json();
          const part = json.candidates?.[0]?.content?.parts?.find(
            (p: any) => p.inlineData?.data
          );
          if (part) {
            const raw = Buffer.from(part.inlineData.data, 'base64');
            return ensureWavBuffer(raw);
          }
          lastError = `${model}: empty audio response`;
        } else {
          const errText = await res.text();
          lastError = `${model}: ${res.status} ${errText.slice(0, 140)}`;
          if (res.status === 429 || /quota|exceeded/i.test(errText)) {
            keyCooldown.set(kmKey, Date.now() + 60 * 1000);
          }
        }
      } catch (err: any) {
        lastError = `${model}: ${err.message}`;
      }
    }
  }

  throw new Error(`Training TTS failed (${lastError})`);
}

export async function getTrainingStepSpeech(
  text: string,
  lang: TrainingTtsLang = 'es',
  voice: TrainingVoiceId = DEFAULT_TRAINING_VOICE,
  forceRegenerate = false
): Promise<{ wav: Buffer; publicUrl: string; storagePath: string }> {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) {
    throw new Error('Empty text for Training TTS');
  }
  const selectedVoice: TrainingVoiceId = isValidTrainingVoice(voice)
    ? voice
    : DEFAULT_TRAINING_VOICE;
  const storagePath = getTrainingAudioStoragePath(clean, lang, selectedVoice);
  const publicUrl = getTrainingAudioPublicUrl(storagePath);

  if (!forceRegenerate) {
    const cached = await supabaseAdmin.storage
      .from(TRAINING_MEDIA_BUCKET)
      .download(storagePath);
    if (cached.data) {
      return {
        wav: Buffer.from(await cached.data.arrayBuffer()),
        publicUrl,
        storagePath,
      };
    }
  }

  const inflight = inflightMap.get(storagePath);
  if (inflight && !forceRegenerate) {
    const res = await inflight;
    return { ...res, storagePath };
  }

  const job = (async () => {
    const wav = await synthesizeTrainingVoiceWithGemini(clean, lang, selectedVoice);
    try {
      await ensureTrainingBucket();
      await supabaseAdmin.storage.from(TRAINING_MEDIA_BUCKET).upload(storagePath, wav, {
        contentType: 'audio/wav',
        cacheControl: '31536000',
        upsert: true,
      });
    } catch (e) {
      console.warn('[training-tts] Could not upload voiceover to Storage:', e);
    }
    return { wav, publicUrl };
  })();

  inflightMap.set(storagePath, job);
  try {
    const res = await job;
    return { ...res, storagePath };
  } finally {
    inflightMap.delete(storagePath);
  }
}
