'use client';

/**
 * @module TraineeKioskPortalPage
 * @description Portal móvil, tableta y kiosco de capacitación (`/training/portal`)
 * conectado 100% en tiempo real con las 15 sucursales reales (`public.stores`), la plantilla
 * real de empleados del Planificador (`toast_employees` + `shifts`) y la validación de clave
 * RONOS de 4 dígitos (`POST /api/training/ronos-auth`).
 *
 * @businessRules
 * 1. Pre-selección desde Email (`?store=14&emp=...`): Si el empleado abre el link enviado a su
 *    correo electrónico, su sucursal y su nombre quedan pre-seleccionados automáticamente y solo
 *    ingresa su Clave RONOS de 4 dígitos.
 * 2. Antigüedad (2+ Semanas = Ya Certificado): Si el empleado tiene >= 14 días en el Planificador
 *    (`auto_certified: true`), ve directamente su Certificado Oficial Ejecutivo (`OfficialCertificateView`)
 *    listo para imprimir o consultar los videos SOP.
 * 3. Reproductor de Video 100% Limpio:
 *    - Sin barra de progreso (`controls={false}`).
 *    - Solo botón de Pausa/Reproducir y Pantalla Completa (Fullscreen).
 *    - Cuando el video se pausa automáticamente por la explicación de un paso (`autoPausedForVoice === true`),
 *      NO se muestran controles sobre el reproductor.
 * 4. 100% Adaptado a Móviles y Tabletas Vertical y Horizontalmente (`md:landscape:grid-cols-12 lg:grid-cols-12`).
 * 5. Estricto Light Mode Corporativo Tacos Gavilan (#FFFAF5, #FFFFFF, #DA291C, #FFC72C, #0F172A).
 *
 * @dataFlow
 * - GET `/api/training/catalog` -> Sucursales reales, empleados con antigüedad, videos y recetas.
 * - POST `/api/training/ronos-auth` -> Valida el PIN de 4 dígitos en vivo contra RONOS.
 * - PUT `/api/training/enrollments` -> Registra avance del Día 1-4.
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
    OfficialCertificateView,
    type RecipeProductItem,
} from '@/components/training/OfficialCertificateView';
import {
    KeyRound,
    CheckCircle2,
    ArrowLeft,
    Play,
    Pause,
    RotateCcw,
    ChevronLeft,
    ChevronRight,
    Scale,
    Award,
    Store as StoreIcon,
    UserCheck,
    Lock,
    Maximize2,
    Volume2,
    Sparkles,
} from 'lucide-react';

interface RealStoreInfo {
    id: number;
    code: string;
    name: string;
    external_id: string;
    supervisor_name: string | null;
    has_drive_thru: boolean;
    managers: {
        id: number;
        fullName: string;
        role: string;
    }[];
}

interface RealPlanificadorEmployee {
    id: string;
    toast_guid: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    store_ids: string[];
    job_titles: string[];
    assigned_station: string;
    job_role_key: 'COCINERO' | 'CAJERA' | 'LIDERAZGO';
    job_role_title_es: string;
    job_role_title_en: string;
    job_role_badge_es: string;
    job_role_badge_en: string;
    required_stations: {
        stationKey: string;
        labelEs: string;
        labelEn: string;
        dayTarget: number;
    }[];
    is_leader: boolean;
    sort_order: number;
    first_seen_date: string;
    tenure_days: number;
    tenure_weeks: number;
    is_new_hire: boolean;
    auto_certified: boolean;
    certificate_folio: string;
    ronos_synced: boolean;
}

function TraineePortalInner() {
    const searchParams = useSearchParams();
    const initialCode = searchParams.get('code') || '';
    const initialStoreParam = searchParams.get('store') || '';
    const initialEmpParam = searchParams.get('emp') || '';
    const { language, setLanguage, t } = useLanguage();
    const lang = language === 'en' ? 'en' : 'es';

    const [ronosPin, setRonosPin] = useState('');
    const [codeInput, setCodeInput] = useState(initialCode.toUpperCase());
    const [validating, setValidating] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [enrollment, setEnrollment] = useState<any | null>(null);
    const [authenticatedEmployee, setAuthenticatedEmployee] =
        useState<RealPlanificadorEmployee | null>(null);
    const [showCertifiedView, setShowCertifiedView] = useState<boolean>(false);

    const [videos, setVideos] = useState<TrainingSopModuleSpec[]>([]);
    const [positions, setPositions] = useState<StationPositionMeta[]>([]);
    const [stores, setStores] = useState<RealStoreInfo[]>([]);
    const [allEmployees, setAllEmployees] = useState<RealPlanificadorEmployee[]>([]);
    const [recipeProducts, setRecipeProducts] = useState<RecipeProductItem[]>([]);
    const [selectedStoreId, setSelectedStoreId] = useState<number>(
        initialStoreParam ? Number(initialStoreParam) : 14
    );
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(initialEmpParam);
    const [selectedStationKey, setSelectedStationKey] = useState<string>('BURRITOS');
    const [selectedVideoSlug, setSelectedVideoSlug] = useState<string>('');
    const [activeDayTab, setActiveDayTab] = useState<1 | 2 | 3 | 4>(1);
    const [day1SubStep, setDay1SubStep] = useState<'video' | 'portions' | 'quiz'>('video');

    // Clean Video Player & Orus Voice refs
    const videoContainerRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const lastSpokenStepIdRef = useRef<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [autoPausedForVoice, setAutoPausedForVoice] = useState(false);

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
                const realStores: RealStoreInfo[] = data.stores || [];
                setStores(realStores);
                const emps: RealPlanificadorEmployee[] = data.employees || [];
                setAllEmployees(emps);
                setRecipeProducts(data.recipeProducts || []);

                if (initialStoreParam) {
                    setSelectedStoreId(Number(initialStoreParam));
                } else if (realStores.length > 0) {
                    const lynwood = realStores.find((s) => Number(s.id) === 14) || realStores[0];
                    setSelectedStoreId(Number(lynwood.id));
                }
                if (initialEmpParam) {
                    setSelectedEmployeeId(initialEmpParam);
                }
            }
        } catch (err) {
            console.error('[TraineePortal] Catalog load error:', err);
        }
    }, [initialStoreParam, initialEmpParam]);

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
                        'Código inválido. Selecciona tu sucursal, tu nombre e ingresa tu clave RONOS de 4 dígitos.'
                );
                setEnrollment(null);
            } else {
                setEnrollment(data.enrollment);
                setSelectedStationKey(data.enrollment.position_key || 'BURRITOS');
                setActiveDayTab((data.enrollment.current_day || 1) as 1 | 2 | 3 | 4);
            }
        } catch {
            setErrorMsg('Error de conexión verificando tu código.');
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

    const selectedStore = useMemo(
        () => stores.find((s) => Number(s.id) === Number(selectedStoreId)) || stores[0] || null,
        [stores, selectedStoreId]
    );

    const storeEmployees = useMemo(() => {
        if (!selectedStore) return [];
        const extId = String(selectedStore.external_id || '');
        return allEmployees.filter((emp) => emp.store_ids.includes(extId));
    }, [allEmployees, selectedStore]);

    const handleEnterWithRonosPin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEmployeeId || !selectedStore) return;
        const emp =
            storeEmployees.find((x) => x.id === selectedEmployeeId) ||
            allEmployees.find((x) => x.id === selectedEmployeeId);
        if (!emp) return;

        const cleanPin = ronosPin.replace(/\D/g, '').trim();
        if (cleanPin.length !== 4) {
            setErrorMsg(
                lang === 'es'
                    ? 'Ingresa tu clave RONOS de 4 dígitos.'
                    : 'Enter your 4-digit RONOS PIN.'
            );
            return;
        }

        setValidating(true);
        setErrorMsg(null);
        try {
            const validStation = positions.some((p) => p.positionKey === emp.assigned_station)
                ? emp.assigned_station
                : emp.required_stations?.[0]?.stationKey || 'BURRITOS';
            const defaultTrainer =
                selectedStore.managers?.[0]?.fullName ||
                selectedStore.supervisor_name ||
                'Manager';

            const res = await fetch('/api/training/ronos-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storeId: selectedStore.id,
                    storeName: selectedStore.name,
                    pin: cleanPin,
                    employeeId: emp.id,
                    employeeName: emp.full_name,
                    employeePhone: emp.phone,
                    positionKey: validStation,
                    trainerName: defaultTrainer,
                }),
            });
            const data = await res.json();
            if (res.ok && data.ok && data.enrollment) {
                setAuthenticatedEmployee(emp);
                setEnrollment(data.enrollment);
                setSelectedStationKey(validStation);
                setActiveDayTab((data.enrollment.current_day || 1) as 1 | 2 | 3 | 4);
                setShowCertifiedView(Boolean(emp.auto_certified));
            } else {
                setErrorMsg(data.error || t('training.ronos_pin_invalid'));
            }
        } catch {
            setErrorMsg('Error de conexión validando tu clave RONOS.');
        } finally {
            setValidating(false);
        }
    };

    const roleRequiredStations = useMemo(() => {
        if (authenticatedEmployee?.required_stations?.length) {
            return authenticatedEmployee.required_stations;
        }
        return [
            { stationKey: 'CARNES', labelEs: '1. Cocción de Carnes', labelEn: '1. Meat Cooking & Grill', dayTarget: 1 },
            { stationKey: 'TORTILLAS', labelEs: '2. Tortillas', labelEn: '2. Tortillas Station', dayTarget: 1 },
            { stationKey: 'TACOS', labelEs: '3. Tacos y Platos', labelEn: '3. Tacos & Combination Plates', dayTarget: 2 },
            { stationKey: 'TORTAS/QUESADILLAS', labelEs: '4. Plancha de Tortas, Mulitas y Quesadillas', labelEn: '4. Tortas, Mulitas & Quesadillas Griddle', dayTarget: 2 },
            { stationKey: 'BURRITOS', labelEs: '5. Burritos', labelEn: '5. Burritos Line', dayTarget: 3 },
            { stationKey: 'PREPARACION', labelEs: '6. Preparación', labelEn: '6. Prep, Salsas & Portions', dayTarget: 3 },
        ];
    }, [authenticatedEmployee]);

    const assignedPosition = useMemo(() => {
        if (!enrollment) return null;
        const targetKey = selectedStationKey || enrollment.position_key || 'BURRITOS';
        return (
            positions.find((p) => p.positionKey === targetKey) ||
            positions.find((p) => p.positionKey === enrollment.position_key) ||
            positions[0] ||
            null
        );
    }, [enrollment, positions, selectedStationKey]);

    const stationRecipeProducts = useMemo(() => {
        const activeKey = assignedPosition?.positionKey || selectedStationKey || 'BURRITOS';
        const matched = recipeProducts.filter((prod) => {
            if (activeKey === 'TORTAS/QUESADILLAS' || activeKey === 'TORTAS/MULITAS') {
                return (
                    prod.positionKey === 'TORTAS/QUESADILLAS' ||
                    prod.positionKey === 'TORTAS/MULITAS'
                );
            }
            if (activeKey === 'Ventana 1' || activeKey === 'Ventana 2') {
                return (
                    prod.positionKey === 'Caja 1 / Salón' ||
                    prod.positionKey === 'Uber + Salsas'
                );
            }
            return prod.positionKey === activeKey;
        });
        return matched.length > 0 ? matched : recipeProducts;
    }, [recipeProducts, assignedPosition, selectedStationKey]);

    const stationVideos = useMemo(() => {
        const activeVideos = videos.filter((v) => Boolean(v.videoUrl) && v.videoUrl !== 'DELETED');
        if (!assignedPosition) return activeVideos;
        const matched = activeVideos.filter(
            (v) =>
                assignedPosition.primaryVideoSlugs.includes(v.slug) ||
                v.positionKey === assignedPosition.positionKey
        );
        return matched.length > 0 ? matched : activeVideos;
    }, [videos, assignedPosition]);

    const currentVideo = useMemo(() => {
        const chosen =
            stationVideos.find((v) => v.slug === selectedVideoSlug) ||
            videos.find((v) => v.slug === selectedVideoSlug && Boolean(v.videoUrl));
        return chosen || stationVideos[0] || videos.find((v) => Boolean(v.videoUrl)) || null;
    }, [stationVideos, videos, selectedVideoSlug]);

    useEffect(() => {
        if (stationVideos.length > 0) {
            const exists = stationVideos.some((v) => v.slug === selectedVideoSlug);
            if (!exists) {
                setSelectedVideoSlug(stationVideos[0].slug);
            }
        }
    }, [stationVideos, selectedVideoSlug]);

    const currentStepIndex = useMemo(() => {
        if (!currentVideo || !currentVideo.steps.length) return 0;
        const idx = currentVideo.steps.findIndex(
            (s) => currentTime >= s.startSec && currentTime < s.endSec
        );
        return idx >= 0 ? idx : currentVideo.steps.length - 1;
    }, [currentVideo, currentTime]);

    const currentStep = useMemo(() => {
        if (!currentVideo || !currentVideo.steps.length) return null;
        return currentVideo.steps[currentStepIndex] || currentVideo.steps[0];
    }, [currentVideo, currentStepIndex]);

    const playStepVoice = useCallback(
        (step: TrainingVideoStep, pauseVideoWhileSpeaking = true) => {
            if (!audioRef.current) return;
            const textToSpeak = lang === 'en' ? step.narrationEn : step.narrationEs;
            const srcUrl =
                lang === 'en' && step.audioUrlEn
                    ? step.audioUrlEn
                    : lang === 'es' && step.audioUrlEs
                    ? step.audioUrlEs
                    : `/api/training/tts?text=${encodeURIComponent(textToSpeak)}&voice=Orus&lang=${lang}`;

            if (videoRef.current) {
                videoRef.current.muted = true;
                videoRef.current.volume = 0;
            }
            if (pauseVideoWhileSpeaking && videoRef.current && !videoRef.current.paused) {
                setAutoPausedForVoice(true);
                videoRef.current.pause();
                setIsPlaying(false);
            }

            audioRef.current.src = srcUrl;
            audioRef.current.play().catch(() => {
                setAutoPausedForVoice(false);
            });
        },
        [lang]
    );

    const handleTimeUpdate = useCallback(() => {
        const vid = videoRef.current;
        if (!vid || !currentVideo) return;
        const now = vid.currentTime;
        setCurrentTime(now);
        const step = currentVideo.steps.find((s) => now >= s.startSec && now < s.endSec);
        if (step && !vid.paused && lastSpokenStepIdRef.current !== step.id) {
            lastSpokenStepIdRef.current = step.id;
            playStepVoice(step, true);
        }
    }, [currentVideo, playStepVoice]);

    const jumpToStep = (step: TrainingVideoStep) => {
        const vid = videoRef.current;
        if (!vid) return;
        lastSpokenStepIdRef.current = step.id;
        setAutoPausedForVoice(false);
        vid.currentTime = step.startSec;
        setCurrentTime(step.startSec);
        playStepVoice(step, true);
    };

    const togglePlayVideo = () => {
        const vid = videoRef.current;
        if (!vid) return;
        setAutoPausedForVoice(false);
        if (vid.paused) {
            if (vid.currentTime < 0.3 && currentVideo?.steps[0]) {
                lastSpokenStepIdRef.current = currentVideo.steps[0].id;
                playStepVoice(currentVideo.steps[0], false);
            }
            vid.play().then(() => setIsPlaying(true)).catch(() => {});
        } else {
            vid.pause();
            if (audioRef.current) audioRef.current.pause();
            setIsPlaying(false);
        }
    };

    const toggleFullscreenVideo = () => {
        const container = videoContainerRef.current || videoRef.current;
        if (!container) return;
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else if (container.requestFullscreen) {
            container.requestFullscreen().catch(() => {});
        }
    };

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
                    if (videoRef.current) {
                        videoRef.current.muted = true;
                        videoRef.current.volume = 0;
                        if (autoPausedForVoice) {
                            setAutoPausedForVoice(false);
                            videoRef.current
                                .play()
                                .then(() => setIsPlaying(true))
                                .catch(() => {});
                        }
                    } else {
                        setAutoPausedForVoice(false);
                    }
                }}
                className="hidden"
            />

            {/* Simple Top Header */}
            <header className="bg-white border-b-2 border-[#DA291C]/15 px-4 sm:px-6 py-3.5 shadow-xs print:hidden">
                <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#FFF5EB] border-2 border-[#FFC72C] p-1.5 flex items-center justify-center">
                            <img
                                src="/logo.png"
                                alt="Tacos Gavilan"
                                className="w-full h-full object-contain"
                            />
                        </div>
                        <div>
                            <h1 className="text-lg sm:text-xl font-black text-[#0F172A]">
                                {t('training.simple_title')} — Tacos Gavilan
                            </h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                        {enrollment && (
                            <button
                                type="button"
                                onClick={() => {
                                    setEnrollment(null);
                                    setAuthenticatedEmployee(null);
                                    setRonosPin('');
                                }}
                                className="px-4 py-2 rounded-2xl border-2 border-slate-200 text-xs sm:text-sm font-black text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                                Cambiar Empleado ({enrollment.access_code})
                            </button>
                        )}
                        <div className="inline-flex rounded-2xl border-2 border-slate-200 bg-white p-1">
                            <button
                                type="button"
                                onClick={() => setLanguage('es')}
                                className={`px-3 py-1 rounded-xl text-xs font-black cursor-pointer ${
                                    lang === 'es' ? 'bg-[#DA291C] text-white' : 'text-slate-600'
                                }`}
                            >
                                ES
                            </button>
                            <button
                                type="button"
                                onClick={() => setLanguage('en')}
                                className={`px-3 py-1 rounded-xl text-xs font-black cursor-pointer ${
                                    lang === 'en' ? 'bg-[#DA291C] text-white' : 'text-slate-600'
                                }`}
                            >
                                EN
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-8">
                {!enrollment ? (
                    <div className="max-w-xl mx-auto bg-white rounded-3xl border-2 border-[#FFC72C] p-6 sm:p-8 shadow-xl space-y-6 mt-2">
                        <div className="text-center space-y-2">
                            <div className="w-16 h-16 rounded-2xl bg-[#FFF5EB] border-2 border-[#DA291C]/20 mx-auto flex items-center justify-center">
                                <Lock className="w-8 h-8 text-[#DA291C]" />
                            </div>
                            <h2 className="text-2xl font-black text-[#0F172A]">
                                {lang === 'es'
                                    ? 'Bienvenido a tu Entrenamiento'
                                    : 'Welcome to Your Training'}
                            </h2>
                            <p className="text-sm font-semibold text-slate-600">
                                {t('training.ronos_pin_helper')}
                            </p>
                        </div>

                        {/* OPCIÓN PRINCIPAL: Sucursal Real + Nombre del Planificador + Clave RONOS de 4 dígitos */}
                        <form
                            onSubmit={handleEnterWithRonosPin}
                            className="p-5 rounded-3xl bg-[#FFFAF5] border-2 border-[#FED7AA] space-y-4"
                        >
                            <div>
                                <label className="block text-xs font-extrabold uppercase text-slate-500 mb-1.5">
                                    1. {t('training.store_label')}
                                </label>
                                <div className="flex items-center gap-2.5 bg-white border-2 border-slate-200 rounded-2xl px-4 py-3">
                                    <StoreIcon className="w-5 h-5 text-[#DA291C] shrink-0" />
                                    <select
                                        value={selectedStoreId}
                                        onChange={(e) => {
                                            setSelectedStoreId(Number(e.target.value));
                                            setSelectedEmployeeId('');
                                        }}
                                        className="w-full bg-transparent text-base font-black text-[#0F172A] focus:outline-none cursor-pointer"
                                    >
                                        {stores.map((st) => (
                                            <option key={st.id} value={st.id}>
                                                {st.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-extrabold uppercase text-slate-500 mb-1.5">
                                    2. {t('training.employee_planificador_label')}
                                </label>
                                <div className="flex items-center gap-2.5 bg-white border-2 border-slate-200 rounded-2xl px-4 py-3">
                                    <UserCheck className="w-5 h-5 text-[#DA291C] shrink-0" />
                                    <select
                                        value={selectedEmployeeId}
                                        onChange={(e) => setSelectedEmployeeId(e.target.value)}
                                        className="w-full bg-transparent text-base font-black text-[#0F172A] focus:outline-none cursor-pointer"
                                    >
                                        <option value="">
                                            {t('training.select_employee_option')}
                                        </option>
                                        {storeEmployees.map((emp) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.is_new_hire ? '🆕 ' : '🏅 '}
                                                {emp.full_name} —{' '}
                                                {lang === 'en'
                                                    ? emp.job_role_title_en
                                                    : emp.job_role_title_es}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-extrabold uppercase text-slate-500 mb-1.5">
                                    3. {t('training.ronos_pin_label')}
                                </label>
                                <div className="flex items-center gap-2.5 bg-white border-2 border-[#FFC72C] rounded-2xl px-4 py-3">
                                    <KeyRound className="w-5 h-5 text-[#DA291C] shrink-0" />
                                    <input
                                        type="password"
                                        inputMode="numeric"
                                        maxLength={4}
                                        value={ronosPin}
                                        onChange={(e) =>
                                            setRonosPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                                        }
                                        placeholder={t('training.ronos_pin_placeholder')}
                                        className="w-full bg-transparent text-center text-2xl font-mono font-black tracking-[0.5em] text-[#DA291C] focus:outline-none"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={!selectedEmployeeId || ronosPin.length !== 4 || validating}
                                className="w-full py-4 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] disabled:opacity-40 text-white text-base font-black shadow-md cursor-pointer transition-all"
                            >
                                {validating ? 'Verificando RONOS...' : t('training.ronos_verify_btn')}
                            </button>
                        </form>

                        {errorMsg && (
                            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold text-center">
                                {errorMsg}
                            </div>
                        )}

                        <div className="pt-2 text-center">
                            <Link
                                href="/training"
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#DA291C]"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" />
                                Volver al Panel Principal
                            </Link>
                        </div>
                    </div>
                ) : showCertifiedView && authenticatedEmployee?.auto_certified ? (
                    <div className="space-y-6">
                        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4 print:hidden">
                            <div className="flex items-center gap-3">
                                <Award className="w-9 h-9 text-emerald-700 shrink-0" />
                                <div>
                                    <div className="text-xs font-black uppercase text-emerald-800">
                                        {t('training.badge_certified_2w')} ({authenticatedEmployee.tenure_weeks}{' '}
                                        {t('training.weeks_in_scheduler')})
                                    </div>
                                    <h3 className="text-lg font-black text-[#0F172A]">
                                        {t('training.certified_banner_title')}
                                    </h3>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowCertifiedView(false)}
                                className="px-5 py-3 rounded-2xl bg-[#0F172A] text-white text-xs sm:text-sm font-black cursor-pointer"
                            >
                                🎬 Ver Videos SOP y Recetas
                            </button>
                        </div>

                        <OfficialCertificateView
                            employeeName={authenticatedEmployee.full_name}
                            storeName={enrollment.store_name || selectedStore?.name || 'Tacos Gavilan'}
                            jobRoleTitle={
                                lang === 'en'
                                    ? authenticatedEmployee.job_role_title_en
                                    : authenticatedEmployee.job_role_title_es
                            }
                            certifiedStations={authenticatedEmployee.required_stations}
                            stationName={enrollment.position_key || authenticatedEmployee.assigned_station}
                            folio={authenticatedEmployee.certificate_folio}
                            issuedDate={authenticatedEmployee.first_seen_date}
                            tenureWeeks={authenticatedEmployee.tenure_weeks}
                            score={100}
                            managerName={enrollment.trainer_name || 'Gerente de Tienda'}
                            supervisorName={selectedStore?.supervisor_name || 'Supervisión Operativa'}
                            lang={lang}
                        />
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Saludo por Puesto Oficial + Botones de los 4 días + Estaciones del Puesto */}
                        <div className="bg-white rounded-3xl border-2 border-[#FED7AA] p-5 sm:p-6 shadow-xs space-y-5 print:hidden">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <div className="text-xs font-black uppercase text-[#DA291C]">
                                        RONOS OK • CÓDIGO: {enrollment.access_code} • {enrollment.store_name}
                                    </div>
                                    <h2 className="text-2xl font-black text-[#0F172A]">
                                        ¡Hola, {enrollment.employee_name}!
                                    </h2>
                                    <p className="text-sm font-bold text-slate-700 mt-1">
                                        Puesto a Certificar (4 Días):{' '}
                                        <span className="px-2.5 py-1 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] text-[#DA291C] font-black">
                                            {authenticatedEmployee
                                                ? lang === 'en'
                                                    ? authenticatedEmployee.job_role_title_en
                                                    : authenticatedEmployee.job_role_title_es
                                                : 'COCINERO (6 Estaciones)'}
                                        </span>
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {authenticatedEmployee?.auto_certified && (
                                        <button
                                            type="button"
                                            onClick={() => setShowCertifiedView(true)}
                                            className="px-4 py-3 rounded-2xl bg-emerald-600 text-white text-xs sm:text-sm font-black cursor-pointer flex items-center gap-1.5"
                                        >
                                            <Award className="w-4 h-4" />
                                            {t('training.view_official_certificate')}
                                        </button>
                                    )}
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
                                                className={`px-5 py-3 rounded-2xl text-sm font-black cursor-pointer transition-all flex items-center gap-2 border-2 ${
                                                    isActive
                                                        ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-xs'
                                                        : 'bg-[#FFFAF5] text-[#0F172A] border-slate-200 hover:bg-[#FFF0E5]'
                                                }`}
                                            >
                                                {isDone && <CheckCircle2 className="w-4 h-4" />}
                                                Día {d}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* BARRA DE ESTACIONES DE TRABAJO DE TU PUESTO (Conectada al Módulo de Actividades) */}
                            <div className="pt-4 border-t border-slate-200">
                                <div className="text-xs font-extrabold uppercase text-slate-600 mb-2">
                                    Estaciones de Trabajo de tu Puesto (Selecciona una estación para ver su Video SOP y Productos de Receta):
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                                    {roleRequiredStations.map((st) => {
                                        const isActive =
                                            (assignedPosition?.positionKey || selectedStationKey) ===
                                            st.stationKey;
                                        return (
                                            <button
                                                key={st.stationKey}
                                                type="button"
                                                onClick={() => setSelectedStationKey(st.stationKey)}
                                                className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                                                    isActive
                                                        ? 'bg-[#0F172A] text-white border-[#FFC72C] shadow-md'
                                                        : 'bg-[#FFFAF5] text-[#0F172A] border-slate-200 hover:border-[#DA291C]/40'
                                                }`}
                                            >
                                                <div className="text-[10px] font-black uppercase text-[#DA291C]">
                                                    Día {st.dayTarget}
                                                </div>
                                                <div className="text-xs sm:text-sm font-black leading-snug mt-0.5">
                                                    {lang === 'en' ? st.labelEn : st.labelEs}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {activeDayTab === 1 && currentVideo && (
                            <div className="space-y-6">
                                {/* 3 Botones Simples para el Día 1 */}
                                <div className="bg-white rounded-3xl border border-slate-200 p-3 flex flex-wrap gap-2">
                                    {[
                                        {
                                            id: 'video' as const,
                                            label: `🎬 ${t('training.substep_video')}`,
                                        },
                                        {
                                            id: 'portions' as const,
                                            label: `⚖️ ${t('training.substep_portions')}`,
                                        },
                                        {
                                            id: 'quiz' as const,
                                            label: `✅ ${t('training.substep_quiz')}`,
                                        },
                                    ].map((sub) => (
                                        <button
                                            key={sub.id}
                                            type="button"
                                            onClick={() => setDay1SubStep(sub.id)}
                                            className={`px-5 py-3 rounded-2xl text-sm sm:text-base font-black cursor-pointer ${
                                                day1SubStep === sub.id
                                                    ? 'bg-[#0F172A] text-white'
                                                    : 'bg-[#FFFAF5] text-slate-700 border border-slate-200'
                                            }`}
                                        >
                                            {sub.label}
                                        </button>
                                    ))}
                                </div>

                                {day1SubStep === 'video' && (
                                    <div className="grid grid-cols-1 md:landscape:grid-cols-12 lg:grid-cols-12 gap-5 items-start">
                                        <div className="md:landscape:col-span-7 lg:col-span-7 bg-white rounded-3xl border-2 border-slate-200 p-4 sm:p-5 space-y-4">
                                            {stationVideos.length > 1 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {stationVideos.map((v) => (
                                                        <button
                                                            key={v.slug}
                                                            type="button"
                                                            onClick={() =>
                                                                setSelectedVideoSlug(v.slug)
                                                            }
                                                            className={`px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-black border-2 cursor-pointer ${
                                                                v.slug === currentVideo.slug
                                                                    ? 'bg-[#DA291C] text-white border-[#DA291C]'
                                                                    : 'bg-[#FFFAF5] text-slate-800 border-slate-200'
                                                            }`}
                                                        >
                                                            {lang === 'en'
                                                                ? v.titleEn
                                                                : v.titleEs}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {/* REPRODUCTOR DE VIDEO 100% LIMPIO (Sin barra de progreso, sin controles cuando autoPausedForVoice === true) */}
                                            <div
                                                ref={videoContainerRef}
                                                className="relative rounded-2xl overflow-hidden bg-black aspect-video select-none"
                                            >
                                                <video
                                                    key={
                                                        currentVideo.videoUrl || currentVideo.slug
                                                    }
                                                    ref={videoRef}
                                                    src={currentVideo.videoUrl || ''}
                                                    muted
                                                    onLoadedMetadata={(e) => {
                                                        e.currentTarget.muted = true;
                                                        e.currentTarget.volume = 0;
                                                    }}
                                                    onTimeUpdate={handleTimeUpdate}
                                                    onPlay={(e) => {
                                                        e.currentTarget.muted = true;
                                                        e.currentTarget.volume = 0;
                                                        setIsPlaying(true);
                                                    }}
                                                    onPause={() => setIsPlaying(false)}
                                                    onClick={togglePlayVideo}
                                                    playsInline
                                                    controls={false}
                                                    disablePictureInPicture
                                                    controlsList="nodownload noplaybackrate noremoteplayback"
                                                    className="w-full h-full object-contain cursor-pointer"
                                                />

                                                {/* Banner cuando el video se pausa automáticamente por explicación de paso IA (CERO controles del reproductor visibles) */}
                                                {autoPausedForVoice && currentStep && (
                                                    <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-[#0F172A]/90 text-white p-4 border-2 border-[#FFC72C] shadow-xl pointer-events-none">
                                                        <div className="flex items-center gap-2 text-xs font-black uppercase text-[#FFC72C] mb-1">
                                                            <Volume2 className="w-4 h-4 animate-pulse" />
                                                            {t('training.player_explaining_step')} (Paso{' '}
                                                            {currentStep.stepNumber})
                                                        </div>
                                                        <p className="text-sm sm:text-base font-bold leading-snug">
                                                            “
                                                            {lang === 'en'
                                                                ? currentStep.narrationEn
                                                                : currentStep.narrationEs}
                                                            ”
                                                        </p>
                                                    </div>
                                                )}

                                                {/* Controles limpios (Solo Pausa/Reproducir + Fullscreen) ocultos durante explicación de voz IA */}
                                                {!autoPausedForVoice && (
                                                    <div className="absolute bottom-3 right-3 flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={togglePlayVideo}
                                                            className="px-4 py-2.5 rounded-xl bg-[#DA291C]/95 hover:bg-[#DA291C] text-white text-xs sm:text-sm font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
                                                        >
                                                            {isPlaying ? (
                                                                <>
                                                                    <Pause className="w-4 h-4 fill-current" />
                                                                    {t('training.big_pause_btn')}
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Play className="w-4 h-4 fill-current" />
                                                                    {t('training.big_play_btn')}
                                                                </>
                                                            )}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={toggleFullscreenVideo}
                                                            className="p-2.5 rounded-xl bg-[#0F172A]/90 hover:bg-[#0F172A] text-white shadow-lg cursor-pointer"
                                                            title={t('training.player_fullscreen')}
                                                        >
                                                            <Maximize2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {!autoPausedForVoice && (
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                                    <button
                                                        type="button"
                                                        onClick={togglePlayVideo}
                                                        className="py-3.5 px-4 rounded-2xl bg-[#DA291C] text-white text-sm sm:text-base font-black flex items-center justify-center gap-2 cursor-pointer"
                                                    >
                                                        {isPlaying ? (
                                                            <>
                                                                <Pause className="w-5 h-5 fill-current" />
                                                                {t('training.big_pause_btn')}
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Play className="w-5 h-5 fill-current" />
                                                                {t('training.big_play_btn')}
                                                            </>
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (currentStep) jumpToStep(currentStep);
                                                        }}
                                                        className="py-3.5 px-4 rounded-2xl bg-[#FFF8E7] border-2 border-[#FFC72C] text-[#0F172A] text-sm sm:text-base font-black flex items-center justify-center gap-2 cursor-pointer"
                                                    >
                                                        <RotateCcw className="w-4 h-4 text-[#DA291C]" />
                                                        {t('training.listen_again_btn')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={toggleFullscreenVideo}
                                                        className="py-3.5 px-4 rounded-2xl bg-[#0F172A] text-white text-sm sm:text-base font-black flex items-center justify-center gap-2 cursor-pointer"
                                                    >
                                                        <Maximize2 className="w-4 h-4 text-[#FFC72C]" />
                                                        {t('training.player_fullscreen')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="md:landscape:col-span-5 lg:col-span-5 bg-white rounded-3xl border-2 border-[#FFC72C] p-5 sm:p-6 space-y-5">
                                            {currentStep && (
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <span className="px-3 py-1 rounded-full bg-[#DA291C] text-white text-xs font-black uppercase">
                                                            Paso {currentStep.stepNumber} de{' '}
                                                            {currentVideo.steps.length}
                                                        </span>
                                                        <span className="text-xs font-extrabold text-emerald-700 flex items-center gap-1">
                                                            <Sparkles className="w-3.5 h-3.5" />
                                                            Voz IA Orus
                                                        </span>
                                                    </div>
                                                    <h3 className="text-xl font-black text-[#0F172A]">
                                                        {lang === 'en'
                                                            ? currentStep.titleEn
                                                            : currentStep.titleEs}
                                                    </h3>
                                                    <p className="text-base font-bold text-slate-800 bg-[#FFFAF5] p-4 rounded-2xl border border-[#FED7AA]">
                                                        “
                                                        {lang === 'en'
                                                            ? currentStep.narrationEn
                                                            : currentStep.narrationEs}
                                                        ”
                                                    </p>
                                                    {currentStep.keyPortionEs && (
                                                        <div className="p-3 rounded-2xl bg-[#FFF8E7] border border-[#FFC72C] font-black text-sm text-[#0F172A] flex items-center gap-2">
                                                            <Scale className="w-5 h-5 text-[#DA291C]" />
                                                            {lang === 'en'
                                                                ? currentStep.keyPortionEn
                                                                : currentStep.keyPortionEs}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <div className="grid grid-cols-2 gap-3">
                                                <button
                                                    type="button"
                                                    disabled={currentStepIndex <= 0}
                                                    onClick={() => {
                                                        const prev =
                                                            currentVideo.steps[
                                                                currentStepIndex - 1
                                                            ];
                                                        if (prev) jumpToStep(prev);
                                                    }}
                                                    className="py-3.5 px-4 rounded-2xl border-2 border-slate-200 bg-[#FFFAF5] disabled:opacity-40 text-sm font-black text-[#0F172A] flex items-center justify-center gap-1 cursor-pointer"
                                                >
                                                    <ChevronLeft className="w-4 h-4" />
                                                    {t('training.prev_step_btn')}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={
                                                        currentStepIndex >=
                                                        currentVideo.steps.length - 1
                                                    }
                                                    onClick={() => {
                                                        const next =
                                                            currentVideo.steps[
                                                                currentStepIndex + 1
                                                            ];
                                                        if (next) jumpToStep(next);
                                                    }}
                                                    className="py-3.5 px-4 rounded-2xl bg-[#0F172A] disabled:opacity-40 text-sm font-black text-white flex items-center justify-center gap-1 cursor-pointer"
                                                >
                                                    {t('training.next_step_btn')}
                                                    <ChevronRight className="w-4 h-4" />
                                                </button>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setDay1SubStep('portions')}
                                                className="w-full py-4 rounded-2xl bg-emerald-600 text-white text-base font-black cursor-pointer"
                                            >
                                                {t('training.next_go_to_portions')} →
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {day1SubStep === 'portions' && (
                                    <div className="space-y-5">
                                        <div className="bg-white rounded-3xl border-2 border-[#FFC72C] p-6 space-y-5">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <h3 className="text-xl font-black text-[#0F172A]">
                                                    {t('training.recipe_specs_title')}
                                                </h3>
                                                <button
                                                    type="button"
                                                    onClick={() => setDay1SubStep('quiz')}
                                                    className="px-6 py-3 rounded-2xl bg-emerald-600 text-white text-sm sm:text-base font-black cursor-pointer"
                                                >
                                                    {t('training.next_go_to_quiz')} →
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {currentVideo.recipeSpecs.map((sp, i) => (
                                                    <div
                                                        key={i}
                                                        className="p-5 rounded-3xl bg-[#FFFAF5] border-2 border-[#FED7AA] flex items-center justify-between gap-3"
                                                    >
                                                        <div>
                                                            <div className="text-base font-black text-[#0F172A]">
                                                                {lang === 'en'
                                                                    ? sp.itemEn
                                                                    : sp.itemEs}
                                                            </div>
                                                            <div className="text-xs font-bold text-slate-600">
                                                                {lang === 'en'
                                                                    ? sp.utensilEn
                                                                    : sp.utensilEs}
                                                            </div>
                                                        </div>
                                                        <span className="px-3.5 py-1.5 rounded-2xl bg-[#DA291C] text-white text-base font-black">
                                                            {sp.quantity} {sp.unit}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* PRODUCTOS CON RECETA QUE SE ELABORAN EN ESTA ESTACIÓN DE TRABAJO */}
                                        <div className="bg-white rounded-3xl border-2 border-[#FED7AA] p-5 sm:p-6 shadow-xs space-y-4">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-xs font-extrabold uppercase text-[#DA291C]">
                                                        Estación Actual:{' '}
                                                        {lang === 'en'
                                                            ? assignedPosition?.labelEn
                                                            : assignedPosition?.labelEs}
                                                    </div>
                                                    <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
                                                        Categorías Base (Carne Asada) de esta Estación (
                                                        {stationRecipeProducts.length})
                                                    </h3>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
                                                {stationRecipeProducts.map((prod) => (
                                                    <div
                                                        key={prod.guid}
                                                        className="p-3.5 rounded-2xl bg-[#FFFAF5] border border-slate-200 flex flex-col justify-between gap-2.5"
                                                    >
                                                        <div>
                                                            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-[#FFF5EB] text-[#DA291C] border border-[#FED7AA]">
                                                                {prod.category}
                                                            </span>
                                                            <h4 className="text-sm font-black text-[#0F172A] mt-1">
                                                                {prod.name}
                                                            </h4>
                                                            <div className="mt-1.5 flex flex-wrap gap-1">
                                                                {prod.ingredients
                                                                    .slice(0, 4)
                                                                    .map((ing, idx) => (
                                                                        <span
                                                                            key={idx}
                                                                            className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700"
                                                                        >
                                                                            {ing.name}:{' '}
                                                                            <strong>
                                                                                {ing.quantity} {ing.unit}
                                                                            </strong>
                                                                        </span>
                                                                    ))}
                                                            </div>
                                                            {prod.variantsIncluded && prod.variantsIncluded.length > 1 && (
                                                                <div className="mt-2 p-2 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] text-[10px] font-bold text-slate-700 leading-snug">
                                                                    <span className="text-[#DA291C] font-black">
                                                                        Cubre {prod.variantCount || prod.variantsIncluded.length} variantes:
                                                                    </span>{' '}
                                                                    {prod.variantsIncluded.join(', ')}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {prod.hasVideo && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setSelectedVideoSlug(prod.slug);
                                                                    setDay1SubStep('video');
                                                                }}
                                                                className="w-full py-2 px-3 rounded-xl bg-[#DA291C] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
                                                            >
                                                                <Play className="w-3.5 h-3.5 fill-current" />
                                                                {t('training.product_watch_video')}
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {day1SubStep === 'quiz' && (
                                    <div className="bg-white rounded-3xl border-2 border-[#FFC72C] p-6 space-y-5">
                                        <h3 className="text-xl font-black text-[#0F172A]">
                                            {t('training.quiz_day1_title')}
                                        </h3>
                                        <div className="space-y-4">
                                            {currentVideo.quiz.map((q, idx) => (
                                                <div
                                                    key={q.id}
                                                    className="p-5 rounded-3xl bg-[#FFFAF5] border border-slate-200 space-y-3"
                                                >
                                                    <div className="text-base font-black text-[#0F172A]">
                                                        {idx + 1}.{' '}
                                                        {lang === 'en'
                                                            ? q.questionEn
                                                            : q.questionEs}
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                        {(lang === 'en'
                                                            ? q.optionsEn
                                                            : q.optionsEs
                                                        ).map((opt, oIdx) => {
                                                            const selected =
                                                                quizAnswers[q.id] === oIdx;
                                                            return (
                                                                <button
                                                                    key={oIdx}
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setQuizAnswers((prev) => ({
                                                                            ...prev,
                                                                            [q.id]: oIdx,
                                                                        }))
                                                                    }
                                                                    className={`text-left p-4 rounded-2xl border-2 text-sm font-bold cursor-pointer ${
                                                                        selected
                                                                            ? 'bg-[#DA291C] text-white border-[#DA291C]'
                                                                            : 'bg-white text-slate-800 border-slate-200'
                                                                    }`}
                                                                >
                                                                    {opt}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={submitDay1Quiz}
                                            className="px-8 py-4 rounded-2xl bg-[#DA291C] text-white text-base font-black cursor-pointer"
                                        >
                                            ✅ {t('training.quiz_submit_btn')}
                                        </button>
                                        {quizResult && (
                                            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-base font-black">
                                                Calificación: {quizResult.score}%
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeDayTab > 1 && (
                            <div className="space-y-6">
                                {enrollment.day4_completed ? (
                                    <OfficialCertificateView
                                        employeeName={enrollment.employee_name}
                                        storeName={enrollment.store_name || 'Tacos Gavilan'}
                                        jobRoleTitle={
                                            authenticatedEmployee
                                                ? lang === 'en'
                                                    ? authenticatedEmployee.job_role_title_en
                                                    : authenticatedEmployee.job_role_title_es
                                                : 'COCINERO (6 Estaciones de Cocina)'
                                        }
                                        certifiedStations={roleRequiredStations}
                                        stationName={enrollment.position_key}
                                        folio={enrollment.certificate_folio || 'TG-CERT-2026'}
                                        issuedDate={
                                            enrollment.certified_at
                                                ? enrollment.certified_at.slice(0, 10)
                                                : new Date().toISOString().slice(0, 10)
                                        }
                                        score={enrollment.final_exam_score || 100}
                                        managerName={enrollment.trainer_name || 'Gerente de Tienda'}
                                        supervisorName={
                                            selectedStore?.supervisor_name ||
                                            'Supervisión Operativa'
                                        }
                                        lang={lang}
                                    />
                                ) : (
                                    <div className="bg-white rounded-3xl border-2 border-[#FFC72C] p-8 text-center space-y-3">
                                        <h3 className="text-2xl font-black text-[#0F172A]">
                                            Día {activeDayTab}: Práctica en Línea con tu Entrenador
                                        </h3>
                                        <p className="text-base text-slate-600 max-w-xl mx-auto">
                                            Para el Día {activeDayTab}, acércate a tu estación{' '}
                                            <strong>{enrollment.position_key}</strong> con tu
                                            Entrenador o Manager ({enrollment.trainer_name}) para
                                            registrar tus platillos y velocidad.
                                        </p>
                                    </div>
                                )}
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
                <div
                    className="min-h-screen flex items-center justify-center text-[#0F172A] font-black"
                    style={{ backgroundColor: '#FFFAF5' }}
                >
                    Cargando Entrenamiento Tacos Gavilan...
                </div>
            }
        >
            <TraineePortalInner />
        </Suspense>
    );
}
