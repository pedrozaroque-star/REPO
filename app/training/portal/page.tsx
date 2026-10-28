'use client';

/**
 * @module TraineeKioskPortalPage
 * @description Portal público / kiosco de acceso temporal por 4 días (`/training/portal`)
 * para que los nuevos empleados ingresen únicamente con su código temporal `TG-XXXX`
 * desde cualquier tableta de sucursal o teléfono móvil sin requerir credenciales administrativas.
 * @businessRules
 * - Valida que el código `TG-XXXX` exista en `public.training_enrollments` y no haya expirado (`expires_at > now()`).
 * - Filtra automáticamente la estación asignada al aprendiz, sus videos SOP con voz masculina neural (`Orus`),
 *   su tabla de gramajes en onzas (`oz`), sus actividades de Apertura/Regular/Cierre y su avance de Día 1 a Día 4.
 * - Estricto Light Mode Corporativo Tacos Gavilan (#FFFAF5, #FFFFFF, #DA291C, #FFC72C, #FE5000).
 * @dataFlow
 * - GET `/api/training/enrollments?code=TG-XXXX` -> Valida pase temporal de 4 días.
 * - GET `/api/training/catalog` -> Obtiene videos SOP y actividades de la posición asignada.
 * - PUT `/api/training/enrollments` -> Registra avance del aprendiz en tiempo real.
 * @notes
 * - Ruta pública registrada en `middleware.ts` y `components/ClientLayout.tsx` para operar en tabletas de cocina.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import type {
    TrainingSopModuleSpec,
    TrainingVideoStep,
    StationPositionMeta,
} from '@/lib/training-sop-catalog';
import {
    KeyRound,
    CheckCircle2,
    ArrowLeft,
} from 'lucide-react';

function TraineePortalInner() {
    const searchParams = useSearchParams();
    const initialCode = searchParams.get('code') || '';
    const { language, setLanguage, t } = useLanguage();
    const lang = language === 'en' ? 'en' : 'es';

    const [codeInput, setCodeInput] = useState(initialCode.toUpperCase());
    const [validating, setValidating] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [enrollment, setEnrollment] = useState<any | null>(null);
    const [videos, setVideos] = useState<TrainingSopModuleSpec[]>([]);
    const [positions, setPositions] = useState<StationPositionMeta[]>([]);
    const [selectedVideoSlug, setSelectedVideoSlug] = useState<string>('');
    const [activeDayTab, setActiveDayTab] = useState<1 | 2 | 3 | 4>(1);

    // Video & Orus Voice refs
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const lastSpokenStepIdRef = useRef<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [voiceEnabled] = useState(true);
    const [, setIsVoiceSpeaking] = useState(false);

    // Day 1 Quiz
    const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
    const [quizResult, setQuizResult] = useState<{ score: number; passed: boolean } | null>(null);

    const loadCatalog = useCallback(async () => {
        try {
            const res = await fetch('/api/training/catalog');
            const data = await res.json();
            if (data.ok) {
                setVideos(data.modules || []);
                setPositions(data.positions || []);
            }
        } catch (err) {
            console.error('[TraineePortal] Catalog load error:', err);
        }
    }, []);

    const verifyAccessCode = useCallback(async (rawCode: string) => {
        const clean = rawCode.trim().toUpperCase();
        if (!clean) return;
        setValidating(true);
        setErrorMsg(null);
        try {
            const res = await fetch(
                `/api/training/enrollments?code=${encodeURIComponent(clean)}`
            );
            const data = await res.json();
            if (!res.ok || !data.ok) {
                setErrorMsg(
                    data.error ||
                        'Código temporal inválido o expirado. Solicita renovación a tu Manager.'
                );
                setEnrollment(null);
            } else {
                setEnrollment(data.enrollment);
                setActiveDayTab((data.enrollment.current_day || 1) as 1 | 2 | 3 | 4);
            }
        } catch {
            setErrorMsg('Error de conexión verificando tu código temporal.');
        } finally {
            setValidating(false);
        }
    }, []);

    useEffect(() => {
        loadCatalog();
        if (initialCode) {
            verifyAccessCode(initialCode);
        }
    }, [initialCode, loadCatalog, verifyAccessCode]);

    const assignedPosition = useMemo(() => {
        if (!enrollment) return null;
        return (
            positions.find((p) => p.positionKey === enrollment.position_key) ||
            positions[0] ||
            null
        );
    }, [enrollment, positions]);

    const stationVideos = useMemo(() => {
        if (!assignedPosition) return videos;
        const matched = videos.filter(
            (v) =>
                assignedPosition.primaryVideoSlugs.includes(v.slug) ||
                v.positionKey === assignedPosition.positionKey
        );
        return matched.length > 0 ? matched : videos;
    }, [videos, assignedPosition]);

    const currentVideo = useMemo(() => {
        return (
            stationVideos.find((v) => v.slug === selectedVideoSlug) ||
            stationVideos[0] ||
            videos[0] ||
            null
        );
    }, [stationVideos, videos, selectedVideoSlug]);

    useEffect(() => {
        if (stationVideos.length > 0 && !selectedVideoSlug) {
            setSelectedVideoSlug(stationVideos[0].slug);
        }
    }, [stationVideos, selectedVideoSlug]);

    const currentStep = useMemo(() => {
        if (!currentVideo || !currentVideo.steps.length) return null;
        return (
            currentVideo.steps.find(
                (s) => currentTime >= s.startSec && currentTime < s.endSec
            ) || currentVideo.steps[currentVideo.steps.length - 1]
        );
    }, [currentVideo, currentTime]);

    const playStepVoice = useCallback(
        (step: TrainingVideoStep) => {
            if (!voiceEnabled || !audioRef.current) return;
            const textToSpeak = lang === 'en' ? step.narrationEn : step.narrationEs;
            const srcUrl =
                lang === 'en' && step.audioUrlEn
                    ? step.audioUrlEn
                    : lang === 'es' && step.audioUrlEs
                    ? step.audioUrlEs
                    : `/api/training/tts?text=${encodeURIComponent(textToSpeak)}&voice=Orus&lang=${lang}`;

            if (videoRef.current) videoRef.current.volume = 0.08;
            audioRef.current.src = srcUrl;
            setIsVoiceSpeaking(true);
            audioRef.current.play().catch(() => setIsVoiceSpeaking(false));
        },
        [voiceEnabled, lang]
    );

    const handleTimeUpdate = useCallback(() => {
        const vid = videoRef.current;
        if (!vid || !currentVideo) return;
        const now = vid.currentTime;
        setCurrentTime(now);
        const step = currentVideo.steps.find((s) => now >= s.startSec && now < s.endSec);
        if (step && !vid.paused && lastSpokenStepIdRef.current !== step.id) {
            lastSpokenStepIdRef.current = step.id;
            playStepVoice(step);
        }
    }, [currentVideo, playStepVoice]);

    const submitDay1Quiz = async () => {
        if (!currentVideo || !enrollment) return;
        let correct = 0;
        for (const q of currentVideo.quiz) {
            if (quizAnswers[q.id] === q.correctIndex) correct++;
        }
        const score = Math.round((correct / currentVideo.quiz.length) * 100);
        const passed = score >= 80;
        setQuizResult({ score, passed });

        const res = await fetch('/api/training/enrollments', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: enrollment.id,
                action: 'complete_day1',
                quizScore: score,
                videosWatched: [currentVideo.slug],
            }),
        });
        const data = await res.json();
        if (data.ok && data.enrollment) {
            setEnrollment(data.enrollment);
        }
    };

    return (
        <div
            className="min-h-screen w-full text-[#0F172A]"
            style={{ backgroundColor: '#FFFAF5', colorScheme: 'light' }}
        >
            <audio
                ref={audioRef}
                onEnded={() => {
                    setIsVoiceSpeaking(false);
                    if (videoRef.current) videoRef.current.volume = 0.25;
                }}
                className="hidden"
            />

            {/* Header */}
            <header className="bg-white border-b-2 border-[#DA291C]/15 px-4 sm:px-6 py-3.5 shadow-xs">
                <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#FFF5EB] border-2 border-[#FFC72C] p-1.5 flex items-center justify-center">
                            <img
                                src="/logo.png"
                                alt="Tacos Gavilan"
                                className="w-full h-full object-contain"
                            />
                        </div>
                        <div>
                            <span className="px-2 py-0.5 rounded-full bg-[#DA291C] text-white text-[10px] font-black uppercase">
                                PORTAL DE APRENDIZ • 4 DÍAS
                            </span>
                            <h1 className="text-base sm:text-lg font-black text-[#0F172A]">
                                Academia de Entrenamiento — Tacos Gavilan
                            </h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {enrollment && (
                            <button
                                type="button"
                                onClick={() => setEnrollment(null)}
                                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                            >
                                Cambiar Código ({enrollment.access_code})
                            </button>
                        )}
                        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
                            <button
                                type="button"
                                onClick={() => setLanguage('es')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-black ${
                                    lang === 'es' ? 'bg-[#DA291C] text-white' : 'text-slate-600'
                                }`}
                            >
                                ES
                            </button>
                            <button
                                type="button"
                                onClick={() => setLanguage('en')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-black ${
                                    lang === 'en' ? 'bg-[#DA291C] text-white' : 'text-slate-600'
                                }`}
                            >
                                EN
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
                {!enrollment ? (
                    <div className="max-w-md mx-auto bg-white rounded-3xl border-2 border-[#FFC72C] p-7 shadow-xl text-center space-y-5 mt-8">
                        <div className="w-16 h-16 rounded-2xl bg-[#FFF5EB] border-2 border-[#DA291C]/20 mx-auto flex items-center justify-center">
                            <KeyRound className="w-8 h-8 text-[#DA291C]" />
                        </div>
                        <div className="space-y-1">
                            <span className="px-3 py-0.5 rounded-full bg-[#FFF8E7] text-[#B45309] text-[11px] font-black uppercase border border-[#FFC72C]">
                                PASE TEMPORAL DE 4 DÍAS
                            </span>
                            <h2 className="text-xl font-black text-[#0F172A]">
                                {lang === 'es'
                                    ? 'Bienvenido a tu Entrenamiento'
                                    : 'Welcome to Your Training'}
                            </h2>
                            <p className="text-xs text-slate-600">
                                {t('training.portal_enter_code_label')}
                            </p>
                        </div>

                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                verifyAccessCode(codeInput);
                            }}
                            className="space-y-3"
                        >
                            <input
                                type="text"
                                value={codeInput}
                                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                                placeholder="TG-XXXX"
                                className="w-full text-center text-2xl font-mono font-black tracking-widest px-4 py-3.5 rounded-2xl border-2 border-[#FED7AA] bg-[#FFFAF5] text-[#DA291C] focus:outline-none focus:border-[#DA291C]"
                            />
                            {errorMsg && (
                                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
                                    {errorMsg}
                                </div>
                            )}
                            <button
                                type="submit"
                                disabled={validating}
                                className="w-full py-3.5 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-sm font-black shadow-md cursor-pointer"
                            >
                                {validating ? 'Verificando...' : t('training.portal_enter_btn')}
                            </button>
                        </form>

                        <div className="pt-2 border-t border-slate-100">
                            <Link
                                href="/training"
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#DA291C]"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" />
                                Ir al Panel Gerencial de Entrenamiento
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="bg-gradient-to-r from-[#DA291C] to-[#B91C1C] text-white rounded-3xl p-6 shadow-md border-2 border-[#FFC72C]/40 flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <div className="text-xs font-black uppercase text-[#FFC72C]">
                                    CÓDIGO TEMPORAL ACTIVO: {enrollment.access_code} •{' '}
                                    {enrollment.store_name}
                                </div>
                                <h2 className="text-2xl font-black mt-0.5">
                                    ¡Hola, {enrollment.employee_name}!
                                </h2>
                                <p className="text-xs sm:text-sm text-white/90 font-medium">
                                    Estación Asignada:{' '}
                                    <strong>{enrollment.position_key}</strong> • Entrenador:{' '}
                                    <strong>{enrollment.trainer_name}</strong>
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {[1, 2, 3, 4].map((d) => {
                                    const isActive = activeDayTab === d;
                                    const isDone =
                                        (d === 1 && enrollment.day1_completed) ||
                                        (d === 2 && enrollment.day2_completed) ||
                                        (d === 3 && enrollment.day3_completed) ||
                                        (d === 4 && enrollment.day4_completed);
                                    return (
                                        <button
                                            key={d}
                                            type="button"
                                            onClick={() => setActiveDayTab(d as 1 | 2 | 3 | 4)}
                                            className={`px-4 py-2 rounded-xl text-xs font-black cursor-pointer transition-all flex items-center gap-1.5 ${
                                                isActive
                                                    ? 'bg-[#FFC72C] text-[#0F172A] shadow-sm'
                                                    : 'bg-white/15 text-white hover:bg-white/25'
                                            }`}
                                        >
                                            {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                                            Día {d}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {activeDayTab === 1 && currentVideo && (
                            <div className="space-y-6">
                                {stationVideos.length > 1 && (
                                    <div className="flex flex-wrap gap-2">
                                        {stationVideos.map((v) => (
                                            <button
                                                key={v.slug}
                                                type="button"
                                                onClick={() => setSelectedVideoSlug(v.slug)}
                                                className={`px-3.5 py-2 rounded-xl text-xs font-extrabold border cursor-pointer ${
                                                    v.slug === currentVideo.slug
                                                        ? 'bg-[#DA291C] text-white border-[#DA291C]'
                                                        : 'bg-white text-slate-700 border-slate-200'
                                                }`}
                                            >
                                                {lang === 'en' ? v.titleEn : v.titleEs}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                                    <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-5 space-y-4">
                                        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
                                            <video
                                                key={currentVideo.videoUrl || currentVideo.slug}
                                                ref={videoRef}
                                                src={currentVideo.videoUrl || ''}
                                                onTimeUpdate={handleTimeUpdate}
                                                playsInline
                                                controls
                                                className="w-full h-full object-contain"
                                            />
                                        </div>
                                        {currentStep && (
                                            <div className="p-4 rounded-2xl bg-[#FFF9F2] border-2 border-[#FFC72C]">
                                                <div className="text-xs font-black text-[#DA291C] uppercase">
                                                    Paso {currentStep.stepNumber}:{' '}
                                                    {lang === 'en'
                                                        ? currentStep.titleEn
                                                        : currentStep.titleEs}
                                                </div>
                                                <p className="text-sm font-bold text-[#0F172A] mt-1">
                                                    “
                                                    {lang === 'en'
                                                        ? currentStep.narrationEn
                                                        : currentStep.narrationEs}
                                                    ”
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-5 space-y-3">
                                        <h3 className="text-sm font-black text-[#0F172A]">
                                            Tabla Oficial de Gramajes (oz)
                                        </h3>
                                        <div className="space-y-2">
                                            {currentVideo.recipeSpecs.map((sp, i) => (
                                                <div
                                                    key={i}
                                                    className="p-3 rounded-xl bg-[#FFFAF5] border border-slate-200 flex items-center justify-between gap-2 text-xs"
                                                >
                                                    <div>
                                                        <div className="font-extrabold text-[#0F172A]">
                                                            {lang === 'en'
                                                                ? sp.itemEn
                                                                : sp.itemEs}
                                                        </div>
                                                        <div className="text-slate-500">
                                                            {lang === 'en'
                                                                ? sp.utensilEn
                                                                : sp.utensilEs}
                                                        </div>
                                                    </div>
                                                    <span className="px-2.5 py-1 rounded-lg bg-[#FFF0E5] text-[#DA291C] font-black">
                                                        {sp.quantity} {sp.unit}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-3xl border-2 border-[#FFC72C] p-6 space-y-4">
                                    <h3 className="text-base font-black text-[#0F172A]">
                                        {t('training.quiz_day1_title')}
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {currentVideo.quiz.map((q, idx) => (
                                            <div
                                                key={q.id}
                                                className="p-4 rounded-2xl bg-[#FFFAF5] border border-slate-200 space-y-2"
                                            >
                                                <div className="text-xs font-extrabold text-[#0F172A]">
                                                    {idx + 1}.{' '}
                                                    {lang === 'en'
                                                        ? q.questionEn
                                                        : q.questionEs}
                                                </div>
                                                {(lang === 'en' ? q.optionsEn : q.optionsEs).map(
                                                    (opt, oIdx) => (
                                                        <label
                                                            key={oIdx}
                                                            className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer"
                                                        >
                                                            <input
                                                                type="radio"
                                                                name={`portal-q-${q.id}`}
                                                                checked={
                                                                    quizAnswers[q.id] === oIdx
                                                                }
                                                                onChange={() =>
                                                                    setQuizAnswers((prev) => ({
                                                                        ...prev,
                                                                        [q.id]: oIdx,
                                                                    }))
                                                                }
                                                                className="accent-[#DA291C]"
                                                            />
                                                            <span>{opt}</span>
                                                        </label>
                                                    )
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={submitDay1Quiz}
                                        className="px-6 py-3 rounded-2xl bg-[#DA291C] text-white text-xs font-black cursor-pointer"
                                    >
                                        {t('training.quiz_submit_btn')}
                                    </button>
                                    {quizResult && (
                                        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold">
                                            Resultado: {quizResult.score}%
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeDayTab > 1 && (
                            <div className="bg-white rounded-3xl border border-slate-200 p-6 text-center space-y-4">
                                <h3 className="text-lg font-black text-[#0F172A]">
                                    Día {activeDayTab} en Progreso — Estación{' '}
                                    {enrollment.position_key}
                                </h3>
                                <p className="text-xs sm:text-sm text-slate-600 max-w-xl mx-auto">
                                    Completa tu práctica en línea y cronómetro junto con tu Entrenador ({enrollment.trainer_name}) o abre la vista completa de entrenamiento:
                                </p>
                                <Link
                                    href="/training"
                                    className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-[#DA291C] text-white text-xs font-black"
                                >
                                    Abrir Estación Completa Día {activeDayTab} →
                                </Link>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default function TraineeKioskPortalPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-[#FFFAF5] flex items-center justify-center text-sm font-bold text-[#0F172A]">
                    Cargando Portal de Entrenamiento Tacos Gavilan...
                </div>
            }
        >
            <TraineePortalInner />
        </Suspense>
    );
}
