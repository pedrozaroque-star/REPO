'use client';

/**
 * @module TrainingAcademyPage
 * @description Módulo insignia de Entrenamiento Operativo en 4 Días (Academia SOP Tacos Gavilan)
 * inspirado en Subway University. Integra los 9 videos reales de cocina con locutor de voz masculina
 * neural (Orus vía Gemini 3.8 TTS), tabla oficial de gramajes en onzas (oz), actividades reales de
 * Apertura/Regular/Cierre de todas las posiciones de tienda, cronómetro de velocidad SOP en vivo,
 * generador de códigos de acceso temporal por 4 días (TG-XXXX) y certificado oficial imprimible.
 * @businessRules
 * - Metodología de Micro-Certificación por Estación en 4 Días:
 *   * Día 1: Observación interactiva de videos SOP con voz masculina + estudio de gramajes (oz) + Quiz Teórico (>= 80%).
 *   * Día 2: Práctica guiada con supervisión directa del Entrenador/Manager + contador de repeticiones + firma del entrenador.
 *   * Día 3: Ejecución autónoma ("lo hace solo") con Cronómetro de Velocidad SOP en vivo + Checklist de Apertura, Regular y Cierre.
 *   * Día 4: Examen Final + Auditoría Práctica Ciega del Manager (>= 90%) -> Emisión de Certificado Oficial con folio TG-CERT-2026-XXXX.
 * - Estricto Light Mode Corporativo Tacos Gavilan (#FFFAF5 fondo cálido, #FFFFFF tarjetas, #DA291C rojo oficial,
 *   #FFC72C dorado, #FE5000 naranja cálido, #0F172A texto carbón). Prohibido usar Dark Mode.
 * - Reglas críticas de porcionado: Burrito Asada (6 oz carne, 4 oz frijol, 6 oz arroz; Super agrega 2.1 oz queso,
 *   2.3 oz aguacate, 1.5 oz crema), Torta (6 oz carne, 0.6 oz mayonesa, 1.5 oz frijol, 2.3 oz aguacate, ¡SIN CREMA!),
 *   Mulita (1.5 oz carne), Plato (6 oz carne, 4 oz arroz, 4 oz frijol, 2.0 oz aguacate). Plancha a 250°F.
 * @dataFlow
 * - GET /api/training/catalog -> Carga videos SOP con audioUrlEs/audioUrlEn (Orus), posiciones enriquecidas con position_activities y operating_procedures.
 * - GET/POST/PUT/DELETE /api/training/enrollments -> Gestión de aprendices, códigos temporales de 4 días (TG-XXXX) y progreso Días 1-4.
 * - POST /api/training/tts -> Síntesis de voz masculina neural (Orus) y refinamiento de guiones con IA (mode: 'ai-explain').
 * @notes
 * - Sincronización inteligente video/audio: Atenúa el ruido crudo de cocina al 8% mientras habla el narrador masculino Orus
 *   y pausa automáticamente el video al final del paso si la locución aún no termina ("Auto-Pausa Inteligente por Paso").
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import type {
    TrainingSopModuleSpec,
    TrainingVideoStep,
    StationPositionMeta,
} from '@/lib/training-sop-catalog';
import {
    Play,
    Pause,
    RotateCcw,
    Volume2,
    VolumeX,
    CheckCircle2,
    Clock,
    Award,
    Sparkles,
    UserPlus,
    KeyRound,
    ShieldCheck,
    Scale,
    Thermometer,
    ChefHat,
    Users,
    Car,
    Crown,
    Timer,
    Printer,
    Wand2,
    Copy,
    Check,
    ExternalLink,
    AlertTriangle,
    BookOpen,
    ChevronRight,
    Plus,
    Minus,
    Trash2,
    CalendarClock,
    HelpCircle,
    Layers,
} from 'lucide-react';

interface EnrichedPosition extends StationPositionMeta {
    activities?: {
        id: string | number;
        activity: string;
        shiftType: string;
        shift: string;
        frequency: string;
        description: string;
        durationMinutes: number;
    }[];
}

interface TrainingEnrollment {
    id: string;
    access_code: string;
    employee_name: string;
    employee_phone: string | null;
    store_id: number;
    store_name: string;
    position_key: string;
    trainer_name: string;
    current_day: number;
    status: string;
    day1_completed: boolean;
    day1_quiz_score: number | null;
    day1_videos_watched: string[];
    day2_completed: boolean;
    day2_supervised_reps: number;
    day2_checklist_json: Record<string, boolean>;
    day2_approved_by: string | null;
    day2_supervisor_notes: string | null;
    day3_completed: boolean;
    day3_solo_reps: number;
    day3_best_time_seconds: number | null;
    day3_checklist_json: Record<string, boolean>;
    day3_approved_by: string | null;
    day4_completed: boolean;
    day4_exam_score: number | null;
    day4_practical_score: number | null;
    day4_final_score: number | null;
    day4_certified_by: string | null;
    day4_completed_at: string | null;
    certificate_folio: string | null;
    expires_at: string;
    created_at: string;
}

const STORES_LIST = [
    { id: 1, name: 'South Gate #1' },
    { id: 2, name: 'Huntington Park #2' },
    { id: 3, name: 'Downtown LA #3' },
    { id: 4, name: 'Bell Gardens #4' },
    { id: 5, name: 'Maywood #5' },
    { id: 6, name: 'Compton #6' },
    { id: 7, name: 'Paramount #7' },
    { id: 8, name: 'Norwalk #8' },
    { id: 9, name: 'Van Nuys #9' },
    { id: 10, name: 'West Covina #10' },
    { id: 11, name: 'Fontana #11' },
    { id: 12, name: 'Santa Ana #12' },
    { id: 13, name: 'Azusa #13' },
    { id: 14, name: 'Lynwood #14' },
    { id: 15, name: 'Downey #15' },
];

function formatSeconds(sec: number): string {
    const safe = Math.max(0, Math.floor(sec));
    const mins = Math.floor(safe / 60);
    const rem = safe % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function getRemainingTimeInfo(expiresAtIso: string, lang: 'es' | 'en') {
    const now = Date.now();
    const exp = new Date(expiresAtIso).getTime();
    if (Number.isNaN(exp)) {
        return { expired: false, label: lang === 'es' ? '4 días activos' : '4 days active' };
    }
    const diffMs = exp - now;
    if (diffMs <= 0) {
        return { expired: true, label: lang === 'es' ? 'Expirado' : 'Expired' };
    }
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return {
        expired: false,
        label: lang === 'es' ? `Vence en ${days}d ${hours}h` : `Expires in ${days}d ${hours}h`,
    };
}

export default function TrainingAcademyPage() {
    const { language, setLanguage, t } = useLanguage();
    const lang = language === 'en' ? 'en' : 'es';

    // Data state
    const [videos, setVideos] = useState<TrainingSopModuleSpec[]>([]);
    const [positions, setPositions] = useState<EnrichedPosition[]>([]);
    const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);

    // Selection state
    const [viewMode, setViewMode] = useState<'admin' | 'trainee'>('admin');
    const [selectedGroup, setSelectedGroup] = useState<'cocina' | 'salon' | 'drive_thru' | 'liderazgo'>('cocina');
    const [selectedPositionKey, setSelectedPositionKey] = useState<string>('BURRITOS');
    const [selectedVideoSlug, setSelectedVideoSlug] = useState<string>('burrito-ok');
    const [activeTab, setActiveTab] = useState<'day1' | 'day2' | 'day3' | 'day4' | 'trainees'>('day1');
    const [activeTraineeId, setActiveTraineeId] = useState<string | null>(null);

    // Video & Orus Neural Male Voice Player state
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const lastSpokenStepIdRef = useRef<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [autoPausePerStep, setAutoPausePerStep] = useState(true);
    const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(false);
    const [autoPausedForVoice, setAutoPausedForVoice] = useState(false);
    const [showAllVideosInSelector, setShowAllVideosInSelector] = useState(false);

    // Day 1 Quiz state
    const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
    const [quizSubmittedResult, setQuizSubmittedResult] = useState<{ score: number; passed: boolean } | null>(null);

    // Day 2 Supervised Practice state
    const [day2Rubric, setDay2Rubric] = useState<Record<string, boolean>>({});
    const [day2Reps, setDay2Reps] = useState<number>(0);
    const [day2TrainerName, setDay2TrainerName] = useState<string>('Carlos');
    const [day2TrainerNotes, setDay2TrainerNotes] = useState<string>('');
    const [day2SavedBanner, setDay2SavedBanner] = useState<boolean>(false);

    // Day 3 Solo Execution + Stopwatch state
    const [stopwatchRunning, setStopwatchRunning] = useState<boolean>(false);
    const [stopwatchElapsedDeci, setStopwatchElapsedDeci] = useState<number>(0);
    const [day3BestTimeSec, setDay3BestTimeSec] = useState<number | null>(null);
    const [day3SoloReps, setDay3SoloReps] = useState<number>(0);
    const [day3ActivitiesChecked, setDay3ActivitiesChecked] = useState<Record<string, boolean>>({});
    const [day3TrainerSignoff, setDay3TrainerSignoff] = useState<string>('Carlos');

    // Day 4 Final Certification state
    const [day4ExamAnswers, setDay4ExamAnswers] = useState<Record<string, number>>({});
    const [day4AuditChecks, setDay4AuditChecks] = useState<Record<string, boolean>>({
        scale_accuracy: true,
        assembly_technique: true,
        speed_benchmark: true,
        temp_food_safety: true,
        autonomous_routines: true,
    });
    const [day4CertifiedBy, setDay4CertifiedBy] = useState<string>('Carlos — General Manager');
    const [certificationResult, setCertificationResult] = useState<{
        passed: boolean;
        combinedScore: number;
        examScore: number;
        practicalScore: number;
        folio: string | null;
    } | null>(null);

    // Enroll Trainee Modal state
    const [showEnrollModal, setShowEnrollModal] = useState<boolean>(false);
    const [enrollName, setEnrollName] = useState<string>('');
    const [enrollPhone, setEnrollPhone] = useState<string>('');
    const [enrollStoreName, setEnrollStoreName] = useState<string>('Lynwood #14');
    const [enrollPositionKey, setEnrollPositionKey] = useState<string>('BURRITOS');
    const [enrollTrainerName, setEnrollTrainerName] = useState<string>('Carlos');
    const [enrollingBusy, setEnrollingBusy] = useState<boolean>(false);
    const [newlyCreatedEnrollment, setNewlyCreatedEnrollment] = useState<TrainingEnrollment | null>(null);
    const [copiedCode, setCopiedCode] = useState<string | null>(null);

    // AI Step & Voice Editor Modal state
    const [showStepEditorModal, setShowStepEditorModal] = useState<boolean>(false);
    const [editableSteps, setEditableSteps] = useState<TrainingVideoStep[]>([]);
    const [aiGeneratingStepIdx, setAiGeneratingStepIdx] = useState<number | null>(null);
    const [savingStepsBusy, setSavingStepsBusy] = useState<boolean>(false);

    // Load catalog + enrollments
    const loadTrainingData = useCallback(async () => {
        try {
            const [catRes, enrRes] = await Promise.all([
                fetch('/api/training/catalog'),
                fetch('/api/training/enrollments'),
            ]);
            const catJson = await catRes.json();
            const enrJson = await enrRes.json();

            if (catJson.ok) {
                setVideos(catJson.modules || []);
                setPositions(catJson.positions || []);
            }
            if (enrJson.ok) {
                const list: TrainingEnrollment[] = enrJson.enrollments || [];
                setEnrollments(list);
                if (list.length > 0 && activeTraineeId === null) {
                    setActiveTraineeId(list[0].id);
                }
            }
        } catch (err) {
            console.error('[TrainingAcademyPage] Error loading data:', err);
        }
    }, [activeTraineeId]);

    useEffect(() => {
        loadTrainingData();
    }, [loadTrainingData]);

    const activeTrainee = useMemo(
        () => enrollments.find((e) => e.id === activeTraineeId) || null,
        [enrollments, activeTraineeId]
    );

    const currentPosition = useMemo(
        () =>
            positions.find((p) => p.positionKey === selectedPositionKey) ||
            positions[0] ||
            null,
        [positions, selectedPositionKey]
    );

    const groupPositions = useMemo(
        () => positions.filter((p) => p.groupKey === selectedGroup),
        [positions, selectedGroup]
    );

    const stationVideos = useMemo(() => {
        if (!currentPosition) return videos;
        if (showAllVideosInSelector) return videos;
        const matched = videos.filter(
            (v) =>
                currentPosition.primaryVideoSlugs.includes(v.slug) ||
                v.positionKey === currentPosition.positionKey
        );
        return matched.length > 0 ? matched : videos;
    }, [videos, currentPosition, showAllVideosInSelector]);

    const currentVideo = useMemo(() => {
        return (
            videos.find((v) => v.slug === selectedVideoSlug) ||
            stationVideos[0] ||
            videos[0] ||
            null
        );
    }, [videos, stationVideos, selectedVideoSlug]);

    useEffect(() => {
        if (stationVideos.length > 0 && !stationVideos.some((v) => v.slug === selectedVideoSlug)) {
            setSelectedVideoSlug(stationVideos[0].slug);
        }
    }, [stationVideos, selectedVideoSlug]);

    useEffect(() => {
        if (!activeTrainee) return;
        setDay2Reps(activeTrainee.day2_supervised_reps || 0);
        setDay2Rubric(activeTrainee.day2_checklist_json || {});
        if (activeTrainee.day2_approved_by) setDay2TrainerName(activeTrainee.day2_approved_by);
        if (activeTrainee.day2_supervisor_notes) setDay2TrainerNotes(activeTrainee.day2_supervisor_notes);
        setDay3SoloReps(activeTrainee.day3_solo_reps || 0);
        setDay3BestTimeSec(activeTrainee.day3_best_time_seconds);
        setDay3ActivitiesChecked(activeTrainee.day3_checklist_json || {});
        if (activeTrainee.day3_approved_by) setDay3TrainerSignoff(activeTrainee.day3_approved_by);
    }, [activeTrainee]);

    const currentStep = useMemo(() => {
        if (!currentVideo || !currentVideo.steps.length) return null;
        const found = currentVideo.steps.find(
            (s) => currentTime >= s.startSec && currentTime < s.endSec
        );
        return found || currentVideo.steps[currentVideo.steps.length - 1];
    }, [currentVideo, currentTime]);

    const playStepVoiceover = useCallback(
        (step: TrainingVideoStep) => {
            if (!voiceEnabled) return;
            const audioEl = audioRef.current;
            if (!audioEl) return;

            const textToSpeak = lang === 'en' ? step.narrationEn : step.narrationEs;
            const srcUrl =
                lang === 'en' && step.audioUrlEn
                    ? step.audioUrlEn
                    : lang === 'es' && step.audioUrlEs
                    ? step.audioUrlEs
                    : `/api/training/tts?text=${encodeURIComponent(textToSpeak)}&voice=Orus&lang=${lang}`;

            if (videoRef.current) {
                videoRef.current.volume = 0.08;
            }

            audioEl.src = srcUrl;
            setIsVoiceSpeaking(true);
            audioEl.play().catch(() => {
                setIsVoiceSpeaking(false);
            });
        },
        [voiceEnabled, lang]
    );

    const handleAudioEnded = useCallback(() => {
        setIsVoiceSpeaking(false);
        if (videoRef.current) {
            videoRef.current.volume = 0.25;
            if (autoPausedForVoice) {
                setAutoPausedForVoice(false);
                videoRef.current.play().catch(() => {});
            }
        }
    }, [autoPausedForVoice]);

    const handleVideoTimeUpdate = useCallback(() => {
        const vid = videoRef.current;
        if (!vid || !currentVideo) return;
        const nowSec = vid.currentTime;
        setCurrentTime(nowSec);

        const activeStep = currentVideo.steps.find(
            (s) => nowSec >= s.startSec && nowSec < s.endSec
        );

        if (activeStep) {
            if (!vid.paused && lastSpokenStepIdRef.current !== activeStep.id) {
                lastSpokenStepIdRef.current = activeStep.id;
                playStepVoiceover(activeStep);
            }

            if (
                autoPausePerStep &&
                voiceEnabled &&
                isVoiceSpeaking &&
                !vid.paused &&
                nowSec >= activeStep.endSec - 0.35
            ) {
                vid.pause();
                setAutoPausedForVoice(true);
            }
        }
    }, [
        currentVideo,
        playStepVoiceover,
        autoPausePerStep,
        voiceEnabled,
        isVoiceSpeaking,
    ]);

    const jumpToStep = (step: TrainingVideoStep) => {
        const vid = videoRef.current;
        if (!vid) return;
        setAutoPausedForVoice(false);
        lastSpokenStepIdRef.current = step.id;
        vid.currentTime = step.startSec;
        setCurrentTime(step.startSec);
        vid.play()
            .then(() => {
                setIsPlaying(true);
                playStepVoiceover(step);
            })
            .catch(() => {});
    };

    const togglePlayVideo = () => {
        const vid = videoRef.current;
        if (!vid) return;
        if (vid.paused) {
            if (vid.currentTime < 0.3 && currentVideo?.steps[0]) {
                lastSpokenStepIdRef.current = currentVideo.steps[0].id;
                playStepVoiceover(currentVideo.steps[0]);
            }
            vid.play().then(() => setIsPlaying(true)).catch(() => {});
        } else {
            vid.pause();
            if (audioRef.current) audioRef.current.pause();
            setIsPlaying(false);
            setIsVoiceSpeaking(false);
        }
    };

    useEffect(() => {
        if (!stopwatchRunning) return;
        const timer = setInterval(() => {
            setStopwatchElapsedDeci((prev) => prev + 1);
        }, 100);
        return () => clearInterval(timer);
    }, [stopwatchRunning]);

    const saveTraineeProgress = async (action: string, payload: Record<string, any>) => {
        if (!activeTrainee) return;
        try {
            const res = await fetch('/api/training/enrollments', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: activeTrainee.id,
                    action,
                    ...payload,
                }),
            });
            const data = await res.json();
            if (data.ok && data.enrollment) {
                setEnrollments((prev) =>
                    prev.map((e) => (e.id === data.enrollment.id ? data.enrollment : e))
                );
            }
        } catch (err) {
            console.error('[TrainingAcademyPage] Error saving progress:', err);
        }
    };

    const handleGradeDay1Quiz = async () => {
        if (!currentVideo) return;
        const questions = currentVideo.quiz;
        if (!questions.length) return;
        let correctCount = 0;
        for (const q of questions) {
            if (quizAnswers[q.id] === q.correctIndex) {
                correctCount++;
            }
        }
        const score = Math.round((correctCount / questions.length) * 100);
        const passed = score >= 80;
        setQuizSubmittedResult({ score, passed });

        if (activeTrainee && passed) {
            const watched = Array.from(
                new Set([...(activeTrainee.day1_videos_watched || []), currentVideo.slug])
            );
            await saveTraineeProgress('complete_day1', {
                quizScore: score,
                videosWatched: watched,
            });
        }
    };

    const handleCompleteDay2 = async () => {
        setDay2SavedBanner(true);
        setTimeout(() => setDay2SavedBanner(false), 4500);
        if (activeTrainee) {
            await saveTraineeProgress('complete_day2', {
                supervisedReps: day2Reps,
                checklistJson: day2Rubric,
                approvedBy: day2TrainerName,
                supervisorNotes: day2TrainerNotes,
            });
        }
        setActiveTab('day3');
    };

    const handleStopAndRecordStopwatch = async () => {
        setStopwatchRunning(false);
        const recordedSec = Math.max(1, Math.round(stopwatchElapsedDeci / 10));
        const newBest =
            day3BestTimeSec === null ? recordedSec : Math.min(day3BestTimeSec, recordedSec);
        const newReps = day3SoloReps + 1;
        setDay3BestTimeSec(newBest);
        setDay3SoloReps(newReps);

        if (activeTrainee) {
            await saveTraineeProgress('update_progress', {
                day3SoloReps: newReps,
                day3BestTimeSeconds: newBest,
                day3ChecklistJson: day3ActivitiesChecked,
            });
        }
    };

    const handleCompleteDay3 = async () => {
        if (activeTrainee) {
            await saveTraineeProgress('complete_day3', {
                soloReps: day3SoloReps,
                bestTimeSeconds: day3BestTimeSec,
                checklistJson: day3ActivitiesChecked,
                approvedBy: day3TrainerSignoff,
            });
        }
        setActiveTab('day4');
    };

    const handleIssueDay4Certification = async () => {
        if (!currentVideo) return;
        const questions = currentVideo.quiz;
        let correct = 0;
        for (const q of questions) {
            if (day4ExamAnswers[q.id] === q.correctIndex) correct++;
        }
        const examScore = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 100;

        const weights: Record<string, number> = {
            scale_accuracy: 25,
            assembly_technique: 25,
            speed_benchmark: 20,
            temp_food_safety: 15,
            autonomous_routines: 15,
        };
        let practicalScore = 0;
        for (const [k, pts] of Object.entries(weights)) {
            if (day4AuditChecks[k]) practicalScore += pts;
        }

        const combinedScore = Math.round((examScore + practicalScore) / 2);
        const passed = combinedScore >= 90;
        const fallbackFolio = passed
            ? `TG-CERT-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`
            : null;

        setCertificationResult({
            passed,
            combinedScore,
            examScore,
            practicalScore,
            folio: activeTrainee?.certificate_folio || fallbackFolio,
        });

        if (activeTrainee) {
            await saveTraineeProgress('certify_day4', {
                examScore,
                practicalScore,
                certifiedBy: day4CertifiedBy,
            });
        }
    };

    const handleCreateEnrollment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!enrollName.trim()) return;
        setEnrollingBusy(true);
        try {
            const matchedStore = STORES_LIST.find((s) => s.name === enrollStoreName);
            const res = await fetch('/api/training/enrollments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeName: enrollName.trim(),
                    employeePhone: enrollPhone.trim(),
                    storeId: matchedStore?.id || 14,
                    storeName: enrollStoreName,
                    positionKey: enrollPositionKey,
                    trainerName: enrollTrainerName.trim() || 'Manager',
                    durationDays: 4,
                }),
            });
            const data = await res.json();
            if (data.ok && data.enrollment) {
                setEnrollments((prev) => [data.enrollment, ...prev]);
                setActiveTraineeId(data.enrollment.id);
                setNewlyCreatedEnrollment(data.enrollment);
                setEnrollName('');
                setEnrollPhone('');
            }
        } catch (err) {
            console.error('[TrainingAcademyPage] Error creating enrollment:', err);
        } finally {
            setEnrollingBusy(false);
        }
    };

    const handleExtendAccess = async (enrollmentId: string) => {
        try {
            const res = await fetch('/api/training/enrollments', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: enrollmentId,
                    action: 'extend_access',
                    extraDays: 4,
                }),
            });
            const data = await res.json();
            if (data.ok && data.enrollment) {
                setEnrollments((prev) =>
                    prev.map((e) => (e.id === data.enrollment.id ? data.enrollment : e))
                );
            }
        } catch (err) {
            console.error('[TrainingAcademyPage] Error extending access:', err);
        }
    };

    const handleDeleteEnrollment = async (enrollmentId: string) => {
        try {
            const res = await fetch(`/api/training/enrollments?id=${enrollmentId}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.ok) {
                setEnrollments((prev) => prev.filter((e) => e.id !== enrollmentId));
                if (activeTraineeId === enrollmentId) {
                    setActiveTraineeId(null);
                }
            }
        } catch (err) {
            console.error('[TrainingAcademyPage] Error deleting enrollment:', err);
        }
    };

    const openStepEditor = () => {
        if (!currentVideo) return;
        setEditableSteps(JSON.parse(JSON.stringify(currentVideo.steps)));
        setShowStepEditorModal(true);
    };

    const handleAiRefineStep = async (idx: number) => {
        if (!currentVideo) return;
        const step = editableSteps[idx];
        if (!step) return;
        setAiGeneratingStepIdx(idx);
        try {
            const res = await fetch('/api/training/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'ai-explain',
                    dishTitle: lang === 'en' ? currentVideo.titleEn : currentVideo.titleEs,
                    stepTitle: lang === 'en' ? step.titleEn : step.titleEs,
                    rawHint: lang === 'en' ? step.narrationEn : step.narrationEs,
                    stepNumber: step.stepNumber,
                    voice: 'Orus',
                }),
            });
            const data = await res.json();
            if (data.ok) {
                setEditableSteps((prev) => {
                    const next = [...prev];
                    next[idx] = {
                        ...next[idx],
                        narrationEs: data.narrationEs || next[idx].narrationEs,
                        narrationEn: data.narrationEn || next[idx].narrationEn,
                        keyPortionEs: data.keyPortionEs || next[idx].keyPortionEs,
                        keyPortionEn: data.keyPortionEn || next[idx].keyPortionEn,
                        audioUrlEs: data.audioUrlEs || next[idx].audioUrlEs,
                        audioUrlEn: data.audioUrlEn || next[idx].audioUrlEn,
                    };
                    return next;
                });
            }
        } catch (err) {
            console.error('[TrainingAcademyPage] AI refine error:', err);
        } finally {
            setAiGeneratingStepIdx(null);
        }
    };

    const handleSaveEditedSteps = async () => {
        if (!currentVideo) return;
        setSavingStepsBusy(true);
        try {
            const res = await fetch('/api/training/catalog', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slug: currentVideo.slug,
                    steps: editableSteps,
                    regenerateVoice: true,
                }),
            });
            const data = await res.json();
            if (data.ok && data.steps) {
                setVideos((prev) =>
                    prev.map((v) =>
                        v.slug === currentVideo.slug ? { ...v, steps: data.steps } : v
                    )
                );
                setShowStepEditorModal(false);
            }
        } catch (err) {
            console.error('[TrainingAcademyPage] Save steps error:', err);
        } finally {
            setSavingStepsBusy(false);
        }
    };

    const copyAccessCode = (code: string) => {
        navigator.clipboard.writeText(code);
        setCopiedCode(code);
        setTimeout(() => setCopiedCode(null), 2500);
    };

    const groupedActivities = useMemo(() => {
        const live = currentPosition?.activities || [];
        const groups: Record<'Apertura' | 'Regular' | 'Cierre', { id: string; name: string; time?: string }[]> = {
            Apertura: [],
            Regular: [],
            Cierre: [],
        };

        if (live.length > 0) {
            for (const act of live) {
                const rawType = (act.shiftType || 'Regular').toLowerCase();
                const key: 'Apertura' | 'Regular' | 'Cierre' = rawType.includes('aper')
                    ? 'Apertura'
                    : rawType.includes('cier')
                    ? 'Cierre'
                    : 'Regular';
                groups[key].push({
                    id: `live-${act.id}`,
                    name: act.activity,
                    time: `${act.durationMinutes || 15} min`,
                });
            }
        } else if (currentPosition) {
            groups.Apertura = [
                {
                    id: 'f-ap-1',
                    name:
                        lang === 'es'
                            ? `Verificar temperatura de equipo (${currentPosition.labelEs}) y sanitizar superficies con solución autorizada.`
                            : `Verify equipment temperature (${currentPosition.labelEn}) and sanitize surfaces with approved solution.`,
                    time: '06:00 - 06:30',
                },
                {
                    id: 'f-ap-2',
                    name:
                        lang === 'es'
                            ? 'Abastecer insertos, utensilios medidores y verificar báscula digital en cero (0.0 oz).'
                            : 'Stock pans, measuring scoops, and verify digital portion scale is zeroed (0.0 oz).',
                    time: '06:30 - 07:00',
                },
            ];
            groups.Regular = (lang === 'es'
                ? currentPosition.keyRulesEs
                : currentPosition.keyRulesEn
            ).map((rule, idx) => ({
                id: `f-reg-${idx}`,
                name: rule,
                time: 'Turno Activo',
            }));
            groups.Cierre = [
                {
                    id: 'f-ci-1',
                    name:
                        lang === 'es'
                            ? 'Envolver, etiquetar con fecha (FIFO) y refrigerar insumos restantes según protocolo.'
                            : 'Wrap, date-label (FIFO), and refrigerate remaining items per protocol.',
                    time: 'Cierre',
                },
                {
                    id: 'f-ci-2',
                    name:
                        lang === 'es'
                            ? 'Lavado profundo de estación, desengrasado y secado completo para apertura 6:00 AM.'
                            : 'Deep station wash, degreasing, and full drying ready for 6:00 AM opening.',
                    time: 'Cierre',
                },
            ];
        }
        return groups;
    }, [currentPosition, lang]);

    const certifiedCount = useMemo(
        () => enrollments.filter((e) => e.status === 'CERTIFIED' || e.day4_completed).length,
        [enrollments]
    );

    return (
        <div
            className="min-h-screen w-full text-[#0F172A] selection:bg-[#DA291C] selection:text-white"
            style={{
                backgroundColor: '#FFFAF5',
                colorScheme: 'light',
            }}
        >
            <audio
                ref={audioRef}
                onEnded={handleAudioEnded}
                onError={() => setIsVoiceSpeaking(false)}
                className="hidden"
            />

            {/* TOP CORPORATE HEADER — TACOS GAVILAN BRAND LIGHT MODE */}
            <header className="sticky top-0 z-30 border-b-2 border-[#DA291C]/15 bg-white/95 backdrop-blur-md shadow-sm print:hidden">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-[#FFF5EB] border-2 border-[#FFC72C] flex items-center justify-center p-1.5 shadow-sm">
                            <img
                                src="/logo.png"
                                alt="Tacos Gavilan"
                                className="w-full h-full object-contain"
                            />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold tracking-wider uppercase bg-[#DA291C] text-white shadow-xs">
                                    <Sparkles className="w-3 h-3 text-[#FFC72C]" />
                                    {t('training.badge_flagship')}
                                </span>
                                <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FFF8E7] text-[#B45309] border border-[#FFC72C]">
                                    <Volume2 className="w-3 h-3 text-[#DA291C]" />
                                    Voz Neural Masculina (Orus)
                                </span>
                            </div>
                            <h1 className="text-lg sm:text-xl font-black text-[#0F172A] tracking-tight mt-0.5">
                                {t('training.title')}
                            </h1>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                        {/* Active Trainee Selector */}
                        <div className="flex items-center gap-2 bg-[#FFF9F2] border border-[#FED7AA] rounded-xl px-3 py-1.5">
                            <KeyRound className="w-4 h-4 text-[#DA291C]" />
                            <select
                                value={activeTraineeId ?? ''}
                                onChange={(e) =>
                                    setActiveTraineeId(e.target.value ? e.target.value : null)
                                }
                                className="bg-transparent text-xs font-bold text-[#0F172A] focus:outline-none cursor-pointer"
                            >
                                <option value="">
                                    {lang === 'es'
                                        ? 'Modo Demostración / Sin Aprendiz'
                                        : 'Demo Mode / No Trainee Selected'}
                                </option>
                                {enrollments.map((enr) => (
                                    <option key={enr.id} value={enr.id}>
                                        {enr.employee_name} ({enr.access_code} • {enr.position_key}{' '}
                                        • Día {enr.current_day}/4)
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Admin vs Trainee View Switcher */}
                        <div className="inline-flex rounded-xl bg-[#F8FAFC] p-1 border border-slate-200">
                            <button
                                type="button"
                                onClick={() => setViewMode('admin')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                                    viewMode === 'admin'
                                        ? 'bg-[#DA291C] text-white shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                {t('training.mode_admin')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('trainee')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                                    viewMode === 'trainee'
                                        ? 'bg-[#FE5000] text-white shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                {t('training.mode_trainee')}
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                setNewlyCreatedEnrollment(null);
                                setEnrollPositionKey(selectedPositionKey);
                                setShowEnrollModal(true);
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#FFC72C] hover:bg-[#F5B800] text-[#0F172A] border border-[#E5A800] shadow-xs transition-all cursor-pointer"
                        >
                            <UserPlus className="w-4 h-4 text-[#DA291C]" />
                            {t('training.btn_enroll_trainee')}
                        </button>

                        <Link
                            href={
                                activeTrainee
                                    ? `/training/portal?code=${activeTrainee.access_code}`
                                    : '/training/portal'
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-[#FFF5EB] text-[#DA291C] border border-[#DA291C]/30 transition-all"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {t('training.btn_open_portal')}
                        </Link>

                        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
                            <button
                                type="button"
                                onClick={() => setLanguage('es')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-black ${
                                    lang === 'es'
                                        ? 'bg-[#DA291C] text-white'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                ES
                            </button>
                            <button
                                type="button"
                                onClick={() => setLanguage('en')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-black ${
                                    lang === 'en'
                                        ? 'bg-[#DA291C] text-white'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                EN
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6 print:p-0">
                {/* HERO BANNER + ANSWER TO "IS IT POSSIBLE IN ONLY 4 DAYS?" */}
                <section className="rounded-3xl bg-gradient-to-r from-[#DA291C] via-[#B91C1C] to-[#991B1B] text-white p-6 sm:p-7 shadow-lg border-2 border-[#FFC72C]/40 relative overflow-hidden print:hidden">
                    <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                        <div className="max-w-3xl space-y-2">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-xs text-[#FFC72C] text-xs font-black tracking-wide uppercase">
                                <Award className="w-4 h-4" />
                                Inspirado en Subway University & Estándar Oficial Tacos Gavilan
                            </div>
                            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                                {t('training.boss_question_title')}
                            </h2>
                            <p className="text-sm sm:text-base text-white/95 leading-relaxed font-medium">
                                {t('training.boss_question_desc')}
                            </p>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
                            <div className="bg-white text-[#0F172A] rounded-2xl p-3.5 border-b-4 border-[#FFC72C] shadow-sm">
                                <div className="text-[11px] font-extrabold uppercase text-slate-500">
                                    {t('training.kpi_videos')}
                                </div>
                                <div className="text-2xl font-black text-[#DA291C] mt-0.5">
                                    {videos.length || 9}
                                </div>
                                <div className="text-[11px] font-semibold text-emerald-700">
                                    100% Con Voz Orus
                                </div>
                            </div>
                            <div className="bg-white text-[#0F172A] rounded-2xl p-3.5 border-b-4 border-[#FE5000] shadow-sm">
                                <div className="text-[11px] font-extrabold uppercase text-slate-500">
                                    {t('training.kpi_positions')}
                                </div>
                                <div className="text-2xl font-black text-[#0F172A] mt-0.5">
                                    {positions.length || 21}
                                </div>
                                <div className="text-[11px] font-semibold text-slate-600">
                                    4 Áreas Operativas
                                </div>
                            </div>
                            <div className="bg-white text-[#0F172A] rounded-2xl p-3.5 border-b-4 border-emerald-500 shadow-sm">
                                <div className="text-[11px] font-extrabold uppercase text-slate-500">
                                    {t('training.kpi_active_trainees')}
                                </div>
                                <div className="text-2xl font-black text-emerald-700 mt-0.5">
                                    {enrollments.length}
                                </div>
                                <div className="text-[11px] font-semibold text-slate-600">
                                    Código 4 Días Activo
                                </div>
                            </div>
                            <div className="bg-white text-[#0F172A] rounded-2xl p-3.5 border-b-4 border-[#DA291C] shadow-sm">
                                <div className="text-[11px] font-extrabold uppercase text-slate-500">
                                    {t('training.kpi_certified')}
                                </div>
                                <div className="text-2xl font-black text-[#DA291C] mt-0.5">
                                    {certifiedCount}
                                </div>
                                <div className="text-[11px] font-semibold text-amber-700">
                                    Estándar &gt;= 90%
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 4-Day Methodology Strip */}
                    <div className="mt-5 pt-5 border-t border-white/20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            {
                                day: 1,
                                badge: lang === 'es' ? 'DÍA 1 • 100% VISUAL Y GRAMAJES' : 'DAY 1 • WATCH & LEARN',
                                title: lang === 'es' ? 'Ve los Videos SOP + Onzas (oz)' : 'SOP Videos + Exact oz Specs',
                                desc:
                                    lang === 'es'
                                        ? 'Aprende cada paso con el locutor masculino (Orus), estudia las onzas exactas y aprueba el Quiz de Día 1 (>=80%).'
                                        : 'Watch timestamped kitchen videos with male voiceover (Orus), memorize exact oz specs, and pass Day 1 Quiz (>=80%).',
                            },
                            {
                                day: 2,
                                badge: lang === 'es' ? 'DÍA 2 • CON SUPERVISIÓN' : 'DAY 2 • SUPERVISED PRACTICE',
                                title: lang === 'es' ? 'Lo Hace con el Entrenador' : 'Hands-On with Trainer',
                                desc:
                                    lang === 'es'
                                        ? 'Prepara los platillos en línea con el Entrenador a su lado corrigiendo cuchara, doblez, báscula y plancha a 250°F.'
                                        : 'Prepares dishes on the line with Trainer right beside them coaching scoop technique, folding, scale weight, and 250°F grill.',
                            },
                            {
                                day: 3,
                                badge: lang === 'es' ? 'DÍA 3 • LO HACE SOLO' : 'DAY 3 • SOLO EXECUTION',
                                title: lang === 'es' ? 'Ejecución Autónoma + Cronómetro' : 'Solo Speed Benchmark + Checklist',
                                desc:
                                    lang === 'es'
                                        ? 'Opera la estación solo midiendo su velocidad con el Cronómetro SOP en vivo y completa Apertura, Regular y Cierre.'
                                        : 'Operates station solo timing dishes with the live SOP Stopwatch and completes Opening, Regular, and Closing checklists.',
                            },
                            {
                                day: 4,
                                badge: lang === 'es' ? 'DÍA 4 • CERTIFICACIÓN OFICIAL' : 'DAY 4 • OFFICIAL CERTIFICATION',
                                title: lang === 'es' ? 'Auditoría Ciega + Certificado' : 'Blind Audit + Certificate',
                                desc:
                                    lang === 'es'
                                        ? 'Examen Final + Auditoría Práctica Ciega del Manager (>=90%) para emitir su Certificado Oficial Tacos Gavilan.'
                                        : 'Final Exam + Manager Blind Practical Audit (>=90%) to earn the printable Official Tacos Gavilan Station Certificate.',
                            },
                        ].map((m) => (
                            <button
                                key={m.day}
                                type="button"
                                onClick={() =>
                                    setActiveTab(`day${m.day}` as 'day1' | 'day2' | 'day3' | 'day4')
                                }
                                className={`text-left rounded-2xl p-3.5 transition-all cursor-pointer border ${
                                    activeTab === `day${m.day}`
                                        ? 'bg-white text-[#0F172A] border-[#FFC72C] shadow-md scale-[1.01]'
                                        : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span
                                        className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase ${
                                            activeTab === `day${m.day}`
                                                ? 'bg-[#DA291C] text-white'
                                                : 'bg-[#FFC72C] text-[#0F172A]'
                                        }`}
                                    >
                                        {m.badge}
                                    </span>
                                    <ChevronRight className="w-4 h-4 opacity-75" />
                                </div>
                                <div className="font-extrabold text-sm mt-1.5">{m.title}</div>
                                <p
                                    className={`text-xs mt-1 leading-snug ${
                                        activeTab === `day${m.day}`
                                            ? 'text-slate-600'
                                            : 'text-white/85'
                                    }`}
                                >
                                    {m.desc}
                                </p>
                            </button>
                        ))}
                    </div>
                </section>

                {/* DEPARTMENT & POSITION SELECTOR (ALL POSITIONS FROM ACTIVIDADES) */}
                <section className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs space-y-4 print:hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <Layers className="w-5 h-5 text-[#DA291C]" />
                            <h3 className="text-base font-black text-[#0F172A]">
                                {t('training.section_groups_title')}
                            </h3>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {[
                                {
                                    id: 'cocina' as const,
                                    label: t('training.group_cocina'),
                                    icon: ChefHat,
                                    count: positions.filter((p) => p.groupKey === 'cocina').length,
                                },
                                {
                                    id: 'salon' as const,
                                    label: t('training.group_salon'),
                                    icon: Users,
                                    count: positions.filter((p) => p.groupKey === 'salon').length,
                                },
                                {
                                    id: 'drive_thru' as const,
                                    label: t('training.group_drive_thru'),
                                    icon: Car,
                                    count: positions.filter((p) => p.groupKey === 'drive_thru').length,
                                },
                                {
                                    id: 'liderazgo' as const,
                                    label: t('training.group_liderazgo'),
                                    icon: Crown,
                                    count: positions.filter((p) => p.groupKey === 'liderazgo').length,
                                },
                            ].map((grp) => {
                                const Icon = grp.icon;
                                const isSelected = selectedGroup === grp.id;
                                return (
                                    <button
                                        key={grp.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedGroup(grp.id);
                                            const firstInGroup = positions.find(
                                                (p) => p.groupKey === grp.id
                                            );
                                            if (firstInGroup) {
                                                setSelectedPositionKey(firstInGroup.positionKey);
                                            }
                                        }}
                                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer border ${
                                            isSelected
                                                ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-xs'
                                                : 'bg-[#FFF9F5] hover:bg-[#FFF0E5] text-[#0F172A] border-[#FED7AA]'
                                        }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        {grp.label}
                                        <span
                                            className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                                                isSelected
                                                    ? 'bg-white/20 text-white'
                                                    : 'bg-[#FFC72C]/40 text-[#0F172A]'
                                            }`}
                                        >
                                            {grp.count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                        {groupPositions.map((pos) => {
                            const isSelected = pos.positionKey === selectedPositionKey;
                            const hasDirectVideos =
                                pos.primaryVideoSlugs && pos.primaryVideoSlugs.length > 0;
                            return (
                                <button
                                    key={pos.positionKey}
                                    type="button"
                                    onClick={() => {
                                        setSelectedPositionKey(pos.positionKey);
                                        setQuizSubmittedResult(null);
                                    }}
                                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer border ${
                                        isSelected
                                            ? 'bg-[#0F172A] text-white border-[#0F172A] ring-2 ring-[#FFC72C]'
                                            : 'bg-white hover:bg-[#FFF8F0] text-slate-800 border-slate-200'
                                    }`}
                                >
                                    <span>{lang === 'en' ? pos.labelEn : pos.labelEs}</span>
                                    {hasDirectVideos && (
                                        <span
                                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
                                                isSelected
                                                    ? 'bg-[#FFC72C] text-[#0F172A]'
                                                    : 'bg-[#FFF0E5] text-[#DA291C]'
                                            }`}
                                        >
                                            {pos.primaryVideoSlugs.length} Video
                                            {pos.primaryVideoSlugs.length > 1 ? 's' : ''}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {currentPosition && (
                        <div className="rounded-2xl bg-[#FFF9F2] border border-[#FED7AA] p-3.5 flex flex-wrap items-center justify-between gap-4">
                            <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-md bg-[#DA291C] text-white text-[11px] font-black uppercase">
                                        {currentPosition.positionKey}
                                    </span>
                                    <span className="text-sm font-black text-[#0F172A]">
                                        {lang === 'en'
                                            ? currentPosition.labelEn
                                            : currentPosition.labelEs}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-600 font-medium">
                                    {lang === 'en'
                                        ? currentPosition.shortDescEn
                                        : currentPosition.shortDescEs}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                                <div className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 font-bold">
                                    <span className="text-slate-500">Benchmark Día 3: </span>
                                    <span className="text-[#DA291C] font-black">
                                        &lt;= {currentPosition.targetTicketSeconds}s
                                    </span>
                                </div>
                                <div className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 font-bold">
                                    <span className="text-slate-500">Meta Día 2: </span>
                                    <span className="text-[#0F172A] font-black">
                                        {currentPosition.day2TargetReps} reps supervisadas
                                    </span>
                                </div>
                                <div className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 font-bold">
                                    <span className="text-slate-500">Meta Día 3: </span>
                                    <span className="text-emerald-700 font-black">
                                        {currentPosition.day3TargetReps} reps solo
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                {/* NAVIGATION TABS: DAY 1, DAY 2, DAY 3, DAY 4, & TEMPORARY PASSES */}
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 print:hidden">
                    {[
                        {
                            id: 'day1' as const,
                            label: t('training.day_1_tab'),
                            done: activeTrainee?.day1_completed,
                        },
                        {
                            id: 'day2' as const,
                            label: t('training.day_2_tab'),
                            done: activeTrainee?.day2_completed,
                        },
                        {
                            id: 'day3' as const,
                            label: t('training.day_3_tab'),
                            done: activeTrainee?.day3_completed,
                        },
                        {
                            id: 'day4' as const,
                            label: t('training.day_4_tab'),
                            done: activeTrainee?.day4_completed,
                        },
                        ...(viewMode === 'admin'
                            ? [
                                  {
                                      id: 'trainees' as const,
                                      label: `${t('training.trainees_tab')} (${enrollments.length})`,
                                      done: false,
                                  },
                              ]
                            : []),
                    ].map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer border ${
                                    isActive
                                        ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-sm'
                                        : 'bg-white hover:bg-[#FFF5EB] text-[#0F172A] border-slate-200'
                                }`}
                            >
                                {tab.done ? (
                                    <CheckCircle2
                                        className={`w-4 h-4 ${
                                            isActive ? 'text-[#FFC72C]' : 'text-emerald-600'
                                        }`}
                                    />
                                ) : (
                                    <Clock className="w-4 h-4 opacity-70" />
                                )}
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* =====================================================================
                    TAB DÍA 1: VE Y APRENDE (VIDEOS SOP + LOCUTOR ORUS + GRAMAJES OZ + QUIZ)
                   ===================================================================== */}
                {activeTab === 'day1' && currentVideo && (
                    <div className="space-y-6">
                        <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <Play className="w-4 h-4 text-[#DA291C] fill-[#DA291C]" />
                                    <span className="text-xs font-black uppercase tracking-wider text-slate-600">
                                        {t('training.station_videos_label')} (
                                        {stationVideos.length})
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowAllVideosInSelector((prev) => !prev)
                                    }
                                    className="text-xs font-bold text-[#DA291C] hover:underline cursor-pointer"
                                >
                                    {showAllVideosInSelector
                                        ? lang === 'es'
                                            ? 'Mostrar solo videos de esta estación'
                                            : 'Show only this station’s videos'
                                        : lang === 'es'
                                        ? 'Ver biblioteca completa (9 videos reales de cocina)'
                                        : 'View full library (All 9 real kitchen videos)'}
                                </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {stationVideos.map((vid) => {
                                    const isCurrent = vid.slug === currentVideo.slug;
                                    return (
                                        <button
                                            key={vid.slug}
                                            type="button"
                                            onClick={() => {
                                                setSelectedVideoSlug(vid.slug);
                                                setIsPlaying(false);
                                                setCurrentTime(0);
                                                lastSpokenStepIdRef.current = null;
                                                if (audioRef.current) audioRef.current.pause();
                                            }}
                                            className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                                                isCurrent
                                                    ? 'bg-[#FFF5EB] border-2 border-[#DA291C] shadow-xs'
                                                    : 'bg-[#FFFAF5] hover:bg-white border-slate-200'
                                            }`}
                                        >
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="px-2 py-0.5 rounded-md bg-[#DA291C] text-white text-[10px] font-black">
                                                        {vid.positionKey}
                                                    </span>
                                                    <span className="text-[11px] font-bold text-slate-500">
                                                        {formatSeconds(vid.durationSeconds)} •{' '}
                                                        {vid.steps.length} pasos
                                                    </span>
                                                </div>
                                                <div className="text-xs sm:text-sm font-extrabold text-[#0F172A] line-clamp-1">
                                                    {lang === 'en' ? vid.titleEn : vid.titleEs}
                                                </div>
                                            </div>
                                            <div
                                                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                                    isCurrent
                                                        ? 'bg-[#DA291C] text-white'
                                                        : 'bg-slate-100 text-slate-600'
                                                }`}
                                            >
                                                <Play className="w-4 h-4 fill-current" />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* MAIN VIDEO PLAYER + INTERACTIVE TIMELINE STEPS */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                            <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <span className="text-[11px] font-black uppercase text-[#DA291C]">
                                            VIDEO SOP OFICIAL • {currentVideo.positionKey}
                                        </span>
                                        <h3 className="text-lg font-black text-[#0F172A]">
                                            {lang === 'en'
                                                ? currentVideo.titleEn
                                                : currentVideo.titleEs}
                                        </h3>
                                    </div>
                                    {viewMode === 'admin' && (
                                        <button
                                            type="button"
                                            onClick={openStepEditor}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold bg-[#FFF8E7] hover:bg-[#FFC72C]/30 text-[#B45309] border border-[#FFC72C] cursor-pointer"
                                        >
                                            <Wand2 className="w-3.5 h-3.5 text-[#DA291C]" />
                                            {t('training.btn_edit_steps_ai')}
                                        </button>
                                    )}
                                </div>

                                <div className="relative rounded-2xl overflow-hidden bg-slate-900 border-2 border-[#DA291C]/20 aspect-video">
                                    <video
                                        key={currentVideo.videoUrl || currentVideo.slug}
                                        ref={videoRef}
                                        src={currentVideo.videoUrl || ''}
                                        onTimeUpdate={handleVideoTimeUpdate}
                                        onPlay={() => setIsPlaying(true)}
                                        onPause={() => setIsPlaying(false)}
                                        playsInline
                                        controls
                                        className="w-full h-full object-contain bg-black"
                                    />

                                    <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
                                        {currentStep && (
                                            <div className="px-3 py-1 rounded-full bg-white/95 text-[#0F172A] text-xs font-black shadow-md border border-[#FFC72C] flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-[#DA291C] animate-pulse" />
                                                Paso {currentStep.stepNumber}/{currentVideo.steps.length}:{' '}
                                                {lang === 'en'
                                                    ? currentStep.titleEn
                                                    : currentStep.titleEs}
                                            </div>
                                        )}

                                        <div className="flex items-center gap-1.5">
                                            {currentStep?.keyPortionEs && (
                                                <span className="px-3 py-1 rounded-full bg-[#FFC72C] text-[#0F172A] text-xs font-black shadow-md flex items-center gap-1">
                                                    <Scale className="w-3.5 h-3.5 text-[#DA291C]" />
                                                    {lang === 'en'
                                                        ? currentStep.keyPortionEn
                                                        : currentStep.keyPortionEs}
                                                </span>
                                            )}
                                            {currentVideo.grillTempFahrenheit && (
                                                <span className="px-3 py-1 rounded-full bg-[#DA291C] text-white text-xs font-black shadow-md flex items-center gap-1">
                                                    <Thermometer className="w-3.5 h-3.5 text-[#FFC72C]" />
                                                    {currentVideo.grillTempFahrenheit}°F
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Synchronized Voice Controls Bar */}
                                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FFF9F2] border border-[#FED7AA] rounded-2xl p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={togglePlayVideo}
                                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#DA291C] hover:bg-[#B91C1C] text-white shadow-xs cursor-pointer"
                                        >
                                            {isPlaying ? (
                                                <>
                                                    <Pause className="w-3.5 h-3.5" />
                                                    {lang === 'es' ? 'Pausar' : 'Pause'}
                                                </>
                                            ) : (
                                                <>
                                                    <Play className="w-3.5 h-3.5 fill-current" />
                                                    {lang === 'es'
                                                        ? 'Reproducir con Narrador'
                                                        : 'Play with Narrator'}
                                                </>
                                            )}
                                        </button>

                                        {currentStep && (
                                            <button
                                               type="button"
                                                onClick={() => jumpToStep(currentStep)}
                                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-[#FFF5EB] text-[#0F172A] border border-slate-200 cursor-pointer"
                                            >
                                                <RotateCcw className="w-3.5 h-3.5 text-[#DA291C]" />
                                                {t('training.player_repeat_step')}
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = !voiceEnabled;
                                                setVoiceEnabled(next);
                                                if (!next && audioRef.current) {
                                                    audioRef.current.pause();
                                                    setIsVoiceSpeaking(false);
                                                }
                                            }}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold border cursor-pointer ${
                                                voiceEnabled
                                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                                    : 'bg-slate-100 text-slate-600 border-slate-300'
                                            }`}
                                        >
                                            {voiceEnabled ? (
                                                <Volume2 className="w-4 h-4 text-emerald-600" />
                                            ) : (
                                                <VolumeX className="w-4 h-4 text-slate-500" />
                                            )}
                                            {voiceEnabled
                                                ? t('training.player_voice_active')
                                                : t('training.player_voice_muted')}
                                        </button>

                                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white border border-slate-200 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={autoPausePerStep}
                                                onChange={(e) =>
                                                    setAutoPausePerStep(e.target.checked)
                                                }
                                                className="accent-[#DA291C] rounded"
                                            />
                                            {t('training.player_auto_pause')}
                                        </label>
                                    </div>
                                </div>

                                {currentStep && (
                                    <div className="rounded-2xl bg-[#FFFDF9] border-2 border-[#FFC72C] p-4 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black uppercase text-[#DA291C] flex items-center gap-1.5">
                                                <Volume2
                                                    className={`w-4 h-4 ${
                                                        isVoiceSpeaking ? 'animate-bounce' : ''
                                                    }`}
                                                />
                                                Narración en Vivo — Paso {currentStep.stepNumber} (
                                                {currentStep.timestampLabel})
                                            </span>
                                            {autoPausedForVoice && (
                                                <span className="px-2 py-0.5 rounded-md bg-[#FEF3C7] text-[#B45309] text-[11px] font-bold">
                                                    Completando explicación de voz...
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm sm:text-base font-bold text-[#0F172A] leading-relaxed">
                                            “
                                            {lang === 'en'
                                                ? currentStep.narrationEn
                                                : currentStep.narrationEs}
                                            ”
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Right 5 cols: Step-by-Step Interactive Timeline */}
                            <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-base font-black text-[#0F172A] flex items-center gap-2">
                                            <BookOpen className="w-4 h-4 text-[#DA291C]" />
                                            {lang === 'es'
                                                ? 'Guía Interactiva Paso a Paso (Clic para Escuchar)'
                                                : 'Interactive Step-by-Step Guide (Click to Listen)'}
                                        </h4>
                                        <span className="text-xs font-bold text-slate-500">
                                            {currentVideo.steps.length} pasos
                                        </span>
                                    </div>

                                    <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                                        {currentVideo.steps.map((step) => {
                                            const isStepActive = currentStep?.id === step.id;
                                            return (
                                                <button
                                                    key={step.id}
                                                    type="button"
                                                    onClick={() => jumpToStep(step)}
                                                    className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
                                                        isStepActive
                                                            ? 'bg-[#FFF5EB] border-2 border-[#DA291C] shadow-xs'
                                                            : 'bg-[#FFFAF5] hover:bg-white border-slate-200'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <span
                                                                className={`w-6 h-6 rounded-lg text-xs font-black flex items-center justify-center ${
                                                                    isStepActive
                                                                        ? 'bg-[#DA291C] text-white'
                                                                        : 'bg-[#FFC72C]/40 text-[#0F172A]'
                                                                }`}
                                                            >
                                                                {step.stepNumber}
                                                            </span>
                                                            <span className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
                                                                {lang === 'en'
                                                                    ? step.titleEn
                                                                    : step.titleEs}
                                                            </span>
                                                        </div>
                                                        <span className="text-[11px] font-bold text-slate-500 shrink-0">
                                                            {step.timestampLabel}
                                                        </span>
                                                    </div>

                                                    <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">
                                                        {lang === 'en'
                                                            ? step.narrationEn
                                                            : step.narrationEs}
                                                    </p>

                                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                                        {step.keyPortionEs && (
                                                            <span className="px-2 py-0.5 rounded-md bg-[#FFC72C]/35 text-[#0F172A] text-[11px] font-extrabold">
                                                                ⚖️{' '}
                                                                {lang === 'en'
                                                                    ? step.keyPortionEn
                                                                    : step.keyPortionEs}
                                                            </span>
                                                        )}
                                                        {step.utensilEs && (
                                                            <span className="px-2 py-0.5 rounded-md bg-orange-100 text-[#B45309] text-[11px] font-extrabold">
                                                                🥄{' '}
                                                                {lang === 'en'
                                                                    ? step.utensilEn
                                                                    : step.utensilEs}
                                                            </span>
                                                        )}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {currentPosition && (
                                    <div className="rounded-2xl bg-[#FFF5F5] border border-[#FECACA] p-3.5 space-y-2">
                                        <div className="text-xs font-black uppercase text-[#DA291C] flex items-center gap-1.5">
                                            <ShieldCheck className="w-4 h-4" />
                                            {t('training.critical_rules_title')}
                                        </div>
                                        <ul className="space-y-1 text-xs font-semibold text-slate-800">
                                            {(lang === 'en'
                                                ? currentPosition.keyRulesEn
                                                : currentPosition.keyRulesEs
                                            ).map((rule, idx) => (
                                                <li key={idx} className="flex items-start gap-1.5">
                                                    <span className="text-[#DA291C] font-black">
                                                        •
                                                    </span>
                                                    <span>{rule}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* OFFICIAL RECIPE PORTION SPEC TABLE (OZ & UTENSILS) */}
                        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Scale className="w-5 h-5 text-[#DA291C]" />
                                    <h3 className="text-base font-black text-[#0F172A]">
                                        {t('training.recipe_specs_title')} —{' '}
                                        {lang === 'en'
                                            ? currentVideo.titleEn
                                            : currentVideo.titleEs}
                                    </h3>
                                </div>
                                <span className="px-3 py-1 rounded-full bg-[#FFF8E7] border border-[#FFC72C] text-xs font-extrabold text-[#B45309]">
                                    Estándar Oficial de Recetas Tacos Gavilan
                                </span>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b-2 border-slate-200 bg-[#FFFAF5] text-[11px] font-black uppercase text-slate-600">
                                            <th className="py-3 px-4">
                                                {t('training.recipe_col_ingredient')}
                                            </th>
                                            <th className="py-3 px-4">
                                                {t('training.recipe_col_regular')}
                                            </th>
                                            <th className="py-3 px-4">
                                                {t('training.recipe_col_utensil')}
                                            </th>
                                            <th className="py-3 px-4">
                                                {t('training.recipe_col_notes')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                                        {currentVideo.recipeSpecs.map((spec, idx) => (
                                            <tr
                                                key={idx}
                                                className="hover:bg-[#FFF9F2] transition-colors"
                                            >
                                                <td className="py-3 px-4 font-extrabold text-[#0F172A]">
                                                    {lang === 'en' ? spec.itemEn : spec.itemEs}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <span className="px-2.5 py-1 rounded-lg bg-[#FFF0E5] text-[#DA291C] font-black">
                                                        {spec.quantity} {spec.unit}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 font-semibold text-slate-700">
                                                    {lang === 'en'
                                                        ? spec.utensilEn
                                                        : spec.utensilEs}
                                                </td>
                                                <td className="py-3 px-4 text-xs font-bold text-[#B45309]">
                                                    {(lang === 'en'
                                                        ? spec.notesEn
                                                        : spec.notesEs) || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* DAY 1 KNOWLEDGE QUIZ (UNLOCKS DAY 2) */}
                        <div className="bg-white rounded-3xl border-2 border-[#FFC72C] p-6 shadow-xs space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <HelpCircle className="w-5 h-5 text-[#DA291C]" />
                                    <h3 className="text-base sm:text-lg font-black text-[#0F172A]">
                                        {t('training.quiz_day1_title')}
                                    </h3>
                                </div>
                                <span className="text-xs font-extrabold text-slate-500">
                                    Mínimo 80% para aprobar Día 1
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {currentVideo.quiz.map((q, qIdx) => (
                                    <div
                                        key={q.id}
                                        className="rounded-2xl bg-[#FFFAF5] border border-slate-200 p-4 space-y-3"
                                    >
                                        <div className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
                                            {qIdx + 1}.{' '}
                                            {lang === 'en' ? q.questionEn : q.questionEs}
                                        </div>
                                        <div className="space-y-2">
                                            {(lang === 'en' ? q.optionsEn : q.optionsEs).map(
                                                (opt, optIdx) => {
                                                    const selected =
                                                        quizAnswers[q.id] === optIdx;
                                                    return (
                                                        <label
                                                            key={optIdx}
                                                            className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                                                                selected
                                                                    ? 'bg-[#FFF0E5] border-[#DA291C] text-[#DA291C]'
                                                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                                            }`}
                                                        >
                                                            <input
                                                                type="radio"
                                                                name={`day1-${q.id}`}
                                                                checked={selected}
                                                                onChange={() =>
                                                                    setQuizAnswers((prev) => ({
                                                                        ...prev,
                                                                        [q.id]: optIdx,
                                                                    }))
                                                                }
                                                                className="accent-[#DA291C]"
                                                            />
                                                            <span>{opt}</span>
                                                        </label>
                                                    );
                                                }
                                            )}
                                        </div>
                                        {quizSubmittedResult && (
                                            <div className="text-xs font-semibold text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200">
                                                💡{' '}
                                                {lang === 'en'
                                                    ? q.explanationEn
                                                    : q.explanationEs}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                                <button
                                    type="button"
                                    onClick={handleGradeDay1Quiz}
                                    className="px-6 py-3 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-black shadow-sm cursor-pointer transition-all"
                                >
                                    {t('training.quiz_submit_btn')}
                                </button>

                                {quizSubmittedResult && (
                                    <div
                                        className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-xs sm:text-sm font-extrabold ${
                                            quizSubmittedResult.passed
                                                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                                : 'bg-red-50 border-red-300 text-red-800'
                                        }`}
                                    >
                                        {quizSubmittedResult.passed ? (
                                            <>
                                                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                                                <span>
                                                    {t('training.quiz_passed_msg', {
                                                        score: quizSubmittedResult.score,
                                                    })}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setActiveTab('day2')}
                                                    className="ml-2 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black cursor-pointer"
                                                >
                                                    Ir al Día 2 →
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                                                <span>
                                                    {t('training.quiz_failed_msg', {
                                                        score: quizSubmittedResult.score,
                                                    })}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* =====================================================================
                    TAB DÍA 2: PRÁCTICA GUIADA CON SUPERVISIÓN DIRECTA
                   ===================================================================== */}
                {activeTab === 'day2' && currentPosition && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-5">
                            <div>
                                <span className="px-2.5 py-1 rounded-full bg-[#FFF0E5] text-[#DA291C] text-xs font-black uppercase">
                                    DÍA 2 DE 4 • CON SUPERVISIÓN DEL ENTRENADOR
                                </span>
                                <h3 className="text-xl font-black text-[#0F172A] mt-2">
                                    {t('training.day2_title')}
                                </h3>
                                <p className="text-xs sm:text-sm text-slate-600 mt-1">
                                    {t('training.day2_subtitle')}
                                </p>
                            </div>

                            <div className="space-y-2.5">
                                <h4 className="text-sm font-black text-[#0F172A]">
                                    {t('training.day2_rubric_title')} ({currentPosition.positionKey})
                                </h4>
                                {currentVideo?.steps.map((st) => {
                                    const key = `step-${st.id}`;
                                    const checked = !!day2Rubric[key];
                                    return (
                                        <label
                                            key={key}
                                            className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                                                checked
                                                    ? 'bg-emerald-50/70 border-emerald-300'
                                                    : 'bg-[#FFFAF5] border-slate-200 hover:bg-white'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) =>
                                                    setDay2Rubric((prev) => ({
                                                        ...prev,
                                                        [key]: e.target.checked,
                                                    }))
                                                }
                                                className="mt-1 w-4 h-4 accent-[#DA291C]"
                                            />
                                            <div className="text-xs sm:text-sm">
                                                <div className="font-extrabold text-[#0F172A]">
                                                    Paso {st.stepNumber}:{' '}
                                                    {lang === 'en' ? st.titleEn : st.titleEs}
                                                </div>
                                                <div className="text-xs text-slate-600 mt-0.5">
                                                    {lang === 'en'
                                                        ? st.narrationEn
                                                        : st.narrationEs}
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="lg:col-span-5 space-y-6">
                            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
                                <h4 className="text-base font-black text-[#0F172A]">
                                    {t('training.day2_reps_title')}
                                </h4>
                                <div className="flex items-center justify-between bg-[#FFF9F2] border border-[#FED7AA] rounded-2xl p-4">
                                    <div>
                                        <div className="text-xs font-bold text-slate-500">
                                            Platillos / Rutinas Supervisadas Aprobadas
                                        </div>
                                        <div className="text-3xl font-black text-[#DA291C]">
                                            {day2Reps}{' '}
                                            <span className="text-base text-slate-500">
                                                / {currentPosition.day2TargetReps} meta
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setDay2Reps((r) => Math.max(0, r - 1))
                                            }
                                            className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 cursor-pointer"
                                        >
                                            <Minus className="w-4 h-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDay2Reps((r) => r + 1)}
                                            className="px-4 h-10 rounded-xl bg-[#DA291C] text-white font-black text-xs flex items-center gap-1 hover:bg-[#B91C1C] cursor-pointer shadow-xs"
                                        >
                                            <Plus className="w-4 h-4" /> +1 Aprobado
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white rounded-3xl border-2 border-[#FFC72C] p-6 shadow-xs space-y-4">
                                <h4 className="text-base font-black text-[#0F172A]">
                                    {t('training.day2_signoff_title')}
                                </h4>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-1">
                                            Entrenador / Manager Responsable
                                        </label>
                                        <input
                                            type="text"
                                            value={day2TrainerName}
                                            onChange={(e) => setDay2TrainerName(e.target.value)}
                                            placeholder={t(
                                                'training.day2_trainer_name_placeholder'
                                            )}
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold bg-[#FFFAF5]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-1">
                                            Observaciones de Supervisión (Día 2)
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={day2TrainerNotes}
                                            onChange={(e) => setDay2TrainerNotes(e.target.value)}
                                            placeholder={t('training.day2_notes_placeholder')}
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium bg-[#FFFAF5]"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCompleteDay2}
                                        className="w-full py-3 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-black shadow-sm cursor-pointer transition-all"
                                    >
                                        {t('training.day2_complete_btn')}
                                    </button>
                                    {day2SavedBanner && (
                                        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold text-center">
                                            ✅ Día 2 guardado exitosamente. Avanzando al Día 3.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* =====================================================================
                    TAB DÍA 3: LO HACE SOLO (CRONÓMETRO DE VELOCIDAD SOP + ACTIVIDADES REALES)
                   ===================================================================== */}
                {activeTab === 'day3' && currentPosition && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-5 bg-white rounded-3xl border-2 border-[#FFC72C] p-6 shadow-xs space-y-5">
                            <div>
                                <span className="px-2.5 py-1 rounded-full bg-[#FFF8E7] text-[#B45309] text-xs font-black uppercase">
                                    DÍA 3 DE 4 • EJECUCIÓN AUTÓNOMA (&quot;LO HACE SOLO&quot;)
                                </span>
                                <h3 className="text-xl font-black text-[#0F172A] mt-2 flex items-center gap-2">
                                    <Timer className="w-5 h-5 text-[#DA291C]" />
                                    {t('training.day3_stopwatch_title')}
                                </h3>
                                <p className="text-xs text-slate-600 mt-1">
                                    {t('training.day3_subtitle')}
                                </p>
                            </div>

                            <div className="rounded-3xl bg-[#FFF9F2] border-2 border-[#FED7AA] p-6 text-center space-y-3">
                                <div className="text-xs font-black uppercase text-slate-500">
                                    Tiempo de Preparación Actual
                                </div>
                                <div className="text-5xl font-black tracking-tight text-[#0F172A] font-mono">
                                    {formatSeconds(Math.floor(stopwatchElapsedDeci / 10))}
                                    <span className="text-2xl text-[#DA291C]">
                                        .{stopwatchElapsedDeci % 10}s
                                    </span>
                                </div>
                                <div className="flex justify-center gap-4 text-xs font-bold">
                                    <span className="px-3 py-1 rounded-lg bg-white border border-slate-200">
                                        {t('training.day3_target_time')}:{' '}
                                        <strong className="text-[#DA291C]">
                                            &lt;= {currentPosition.targetTicketSeconds}s
                                        </strong>
                                    </span>
                                    <span className="px-3 py-1 rounded-lg bg-white border border-slate-200">
                                        {t('training.day3_best_time')}:{' '}
                                        <strong className="text-emerald-700">
                                            {day3BestTimeSec !== null
                                                ? `${day3BestTimeSec}s`
                                                : '—'}
                                        </strong>
                                    </span>
                                </div>

                                <div className="flex flex-wrap justify-center gap-2 pt-2">
                                    {!stopwatchRunning ? (
                                        <button
                                            type="button"
                                            onClick={() => setStopwatchRunning(true)}
                                            className="px-5 py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs font-black cursor-pointer shadow-xs"
                                        >
                                            ▶ {t('training.day3_start_timer')}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleStopAndRecordStopwatch}
                                            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black cursor-pointer shadow-xs"
                                        >
                                            ⏹ {t('training.day3_stop_record')}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setStopwatchRunning(false);
                                            setStopwatchElapsedDeci(0);
                                        }}
                                        className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                                    >
                                        {t('training.day3_reset_timer')}
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-2xl bg-[#FFFAF5] border border-slate-200">
                                <div>
                                    <div className="text-xs font-bold text-slate-500">
                                        Repeticiones Autónomas Completadas (Día 3)
                                    </div>
                                    <div className="text-2xl font-black text-[#0F172A]">
                                        {day3SoloReps} / {currentPosition.day3TargetReps}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setDay3SoloReps((r) => r + 1)}
                                    className="px-4 py-2 rounded-xl bg-[#FFC72C] text-[#0F172A] text-xs font-black cursor-pointer"
                                >
                                    +1 Repetición Solo
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={handleCompleteDay3}
                                className="w-full py-3.5 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-black shadow-sm cursor-pointer"
                            >
                                {t('training.day3_complete_btn')}
                            </button>
                        </div>

                        <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-5">
                            <div className="flex items-center justify-between">
                                <h4 className="text-base sm:text-lg font-black text-[#0F172A]">
                                    {t('training.day3_activities_title')} —{' '}
                                    {currentPosition.positionKey}
                                </h4>
                                <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200">
                                    Sincronizado con Módulo Actividades
                                </span>
                            </div>

                            {(['Apertura', 'Regular', 'Cierre'] as const).map((shift) => (
                                <div key={shift} className="space-y-2">
                                    <div className="text-xs font-black uppercase tracking-wider text-[#DA291C] bg-[#FFF5EB] px-3 py-1.5 rounded-lg inline-block">
                                        Rutinas de {shift} ({groupedActivities[shift].length})
                                    </div>
                                    <div className="space-y-2">
                                        {groupedActivities[shift].map((act) => {
                                            const checked = !!day3ActivitiesChecked[act.id];
                                            return (
                                                <label
                                                    key={act.id}
                                                    className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                                                        checked
                                                            ? 'bg-emerald-50/70 border-emerald-300'
                                                            : 'bg-[#FFFAF5] border-slate-200 hover:bg-white'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold text-[#0F172A]">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(e) =>
                                                                setDay3ActivitiesChecked(
                                                                    (prev) => ({
                                                                        ...prev,
                                                                        [act.id]:
                                                                            e.target.checked,
                                                                    })
                                                                )
                                                            }
                                                            className="w-4 h-4 accent-[#DA291C]"
                                                        />
                                                        <span>{act.name}</span>
                                                    </div>
                                                    {act.time && (
                                                        <span className="text-[11px] font-bold text-slate-500 shrink-0">
                                                            {act.time}
                                                        </span>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* =====================================================================
                    TAB DÍA 4: AUDITORÍA CIEGA Y CERTIFICACIÓN OFICIAL IMPRIMIBLE
                   ===================================================================== */}
                {activeTab === 'day4' && currentPosition && currentVideo && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:hidden">
                            <div className="lg:col-span-6 bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
                                <span className="px-2.5 py-1 rounded-full bg-[#FFF0E5] text-[#DA291C] text-xs font-black uppercase">
                                    DÍA 4 DE 4 • PARTE A: EXAMEN TEÓRICO FINAL
                                </span>
                                <h3 className="text-lg font-black text-[#0F172A]">
                                    Examen Final de Estación ({currentPosition.positionKey})
                                </h3>
                                <div className="space-y-3">
                                    {currentVideo.quiz.map((q, idx) => (
                                        <div
                                            key={q.id}
                                            className="p-3.5 rounded-2xl bg-[#FFFAF5] border border-slate-200 space-y-2"
                                        >
                                            <div className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
                                                {idx + 1}.{' '}
                                                {lang === 'en' ? q.questionEn : q.questionEs}
                                            </div>
                                            <div className="space-y-1.5">
                                                {(lang === 'en'
                                                    ? q.optionsEn
                                                    : q.optionsEs
                                                ).map((opt, oIdx) => (
                                                    <label
                                                        key={oIdx}
                                                        className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer"
                                                    >
                                                        <input
                                                            type="radio"
                                                            name={`day4-${q.id}`}
                                                            checked={
                                                                day4ExamAnswers[q.id] === oIdx
                                                            }
                                                            onChange={() =>
                                                                setDay4ExamAnswers((prev) => ({
                                                                    ...prev,
                                                                    [q.id]: oIdx,
                                                                }))
                                                            }
                                                            className="accent-[#DA291C]"
                                                        />
                                                        <span>{opt}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="lg:col-span-6 bg-white rounded-3xl border-2 border-[#FFC72C] p-6 shadow-xs space-y-4">
                                <span className="px-2.5 py-1 rounded-full bg-[#FFF8E7] text-[#B45309] text-xs font-black uppercase">
                                    DÍA 4 DE 4 • PARTE B: AUDITORÍA PRÁCTICA CIEGA
                                </span>
                                <h3 className="text-lg font-black text-[#0F172A]">
                                    {t('training.day4_practical_title')}
                                </h3>
                                <div className="space-y-2.5">
                                    {[
                                        {
                                            id: 'scale_accuracy',
                                            label: 'Exactitud de Gramaje en Báscula Digital (oz exactas sin merma)',
                                            pts: 25,
                                        },
                                        {
                                            id: 'assembly_technique',
                                            label: 'Técnica de Armado, Dorso de Cuchara y Envoltura Firme SOP',
                                            pts: 25,
                                        },
                                        {
                                            id: 'speed_benchmark',
                                            label: `Velocidad en Línea dentro del Benchmark (<= ${currentPosition.targetTicketSeconds}s)`,
                                            pts: 20,
                                        },
                                        {
                                            id: 'temp_food_safety',
                                            label: 'Temperatura Oficial (Plancha 250°F / Vaporera) e Higiene',
                                            pts: 15,
                                        },
                                        {
                                            id: 'autonomous_routines',
                                            label: 'Dominio Autónomo de Apertura, Regular y Cierre de la Estación',
                                            pts: 15,
                                        },
                                    ].map((crit) => (
                                        <label
                                            key={crit.id}
                                            className="flex items-center justify-between p-3.5 rounded-2xl bg-[#FFFAF5] border border-slate-200 cursor-pointer"
                                        >
                                            <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold text-[#0F172A]">
                                                <input
                                                    type="checkbox"
                                                    checked={!!day4AuditChecks[crit.id]}
                                                    onChange={(e) =>
                                                        setDay4AuditChecks((prev) => ({
                                                            ...prev,
                                                            [crit.id]: e.target.checked,
                                                        }))
                                                    }
                                                    className="w-4 h-4 accent-[#DA291C]"
                                                />
                                                <span>{crit.label}</span>
                                            </div>
                                            <span className="px-2 py-0.5 rounded-md bg-[#FFC72C]/40 text-[#0F172A] text-xs font-black">
                                                {crit.pts} pts
                                            </span>
                                        </label>
                                    ))}
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">
                                        Manager / Supervisor Certificador
                                    </label>
                                    <input
                                        type="text"
                                        value={day4CertifiedBy}
                                        onChange={(e) => setDay4CertifiedBy(e.target.value)}
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold bg-[#FFFAF5]"
                                    />
                                </div>

                                <button
                                    type="button"
                                    onClick={handleIssueDay4Certification}
                                    className="w-full py-3.5 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-black shadow-sm cursor-pointer flex items-center justify-center gap-2"
                                >
                                    <Award className="w-5 h-5 text-[#FFC72C]" />
                                    {t('training.day4_certify_btn')}
                                </button>
                            </div>
                        </div>

                        {(certificationResult?.passed || activeTrainee?.day4_completed) && (
                            <div className="bg-white rounded-3xl border-4 border-[#DA291C] p-8 sm:p-10 shadow-xl relative overflow-hidden">
                                <div className="border-2 border-[#FFC72C] rounded-2xl p-6 sm:p-8 text-center space-y-4">
                                    <div className="flex justify-center">
                                        <img
                                            src="/logo.png"
                                            alt="Tacos Gavilan"
                                            className="w-20 h-20 object-contain"
                                        />
                                    </div>
                                    <div className="text-xs font-black tracking-widest uppercase text-[#DA291C]">
                                        {t('training.certificate_subtitle')}
                                    </div>
                                    <h2 className="text-2xl sm:text-3xl font-black text-[#0F172A]">
                                        {t('training.certificate_title')}
                                    </h2>
                                    <p className="text-sm text-slate-600 max-w-xl mx-auto">
                                        Se otorga el presente certificado oficial por haber completado y aprobado satisfactoriamente el programa intensivo de 4 días en la estación:
                                    </p>
                                    <div className="text-2xl sm:text-3xl font-black text-[#DA291C]">
                                        {activeTrainee?.employee_name || 'Nuevo Colaborador Certificado'}
                                    </div>
                                    <div className="inline-flex flex-wrap items-center justify-center gap-3 px-5 py-2 rounded-2xl bg-[#FFF8E7] border border-[#FFC72C] text-sm font-black text-[#0F172A]">
                                        <span>
                                            Estación: {currentPosition.positionKey} (
                                            {lang === 'en'
                                                ? currentPosition.labelEn
                                                : currentPosition.labelEs}
                                            )
                                        </span>
                                        <span>•</span>
                                        <span>
                                            Promedio Final:{' '}
                                            {certificationResult?.combinedScore ||
                                                activeTrainee?.day4_final_score ||
                                                activeTrainee?.day4_practical_score ||
                                                96}
                                            %
                                        </span>
                                        <span>•</span>
                                        <span>
                                            Folio:{' '}
                                            {certificationResult?.folio ||
                                                activeTrainee?.certificate_folio ||
                                                'TG-CERT-2026-0001'}
                                        </span>
                                    </div>
                                    <div className="pt-4 flex flex-wrap items-center justify-around gap-6 text-xs font-bold text-slate-600">
                                        <div>
                                            <div className="font-black text-[#0F172A]">
                                                {day4CertifiedBy}
                                            </div>
                                            <div className="border-t border-slate-300 mt-1 pt-1">
                                                Firma del Certificador Oficial
                                            </div>
                                        </div>
                                        <div>
                                            <div className="font-black text-[#0F172A]">
                                                {activeTrainee?.store_name || 'Lynwood #14'}
                                            </div>
                                            <div className="border-t border-slate-300 mt-1 pt-1">
                                                Sucursal Tacos Gavilan
                                            </div>
                                        </div>
                                    </div>
                                    <div className="pt-4 print:hidden">
                                        <button
                                            type="button"
                                            onClick={() => window.print()}
                                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F172A] text-white text-xs font-black cursor-pointer"
                                        >
                                            <Printer className="w-4 h-4 text-[#FFC72C]" />
                                            {t('training.certificate_print_btn')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* =====================================================================
                    TAB ACCESOS TEMPORALES (4 DÍAS) Y PROGRESO DE APRENDICES
                   ===================================================================== */}
                {activeTab === 'trainees' && (
                    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-black text-[#0F172A]">
                                    Gestión de Pases Temporales (4 Días) y Avance por Aprendiz
                                </h3>
                                <p className="text-xs text-slate-600">
                                    Cada nuevo empleado recibe un código temporal único (TG-XXXX) válido por 4 días para ingresar desde cualquier tableta en `/training/portal`.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setNewlyCreatedEnrollment(null);
                                    setShowEnrollModal(true);
                                }}
                                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#DA291C] text-white text-xs font-black cursor-pointer"
                            >
                                <UserPlus className="w-4 h-4" />
                                {t('training.btn_enroll_trainee')}
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b-2 border-slate-200 bg-[#FFFAF5] text-[11px] font-black uppercase text-slate-600">
                                        <th className="py-3 px-4">Aprendiz / Sucursal</th>
                                        <th className="py-3 px-4">Código Temporal (4 Días)</th>
                                        <th className="py-3 px-4">Estación</th>
                                        <th className="py-3 px-4">Progreso 4 Días</th>
                                        <th className="py-3 px-4">Vigencia</th>
                                        <th className="py-3 px-4 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                                    {enrollments.map((enr) => {
                                        const expInfo = getRemainingTimeInfo(
                                            enr.expires_at,
                                            lang
                                        );
                                        return (
                                            <tr
                                                key={enr.id}
                                                className="hover:bg-[#FFF9F2] transition-colors"
                                            >
                                                <td className="py-3.5 px-4">
                                                    <div className="font-extrabold text-[#0F172A]">
                                                        {enr.employee_name}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {enr.store_name} • Entrenador:{' '}
                                                        {enr.trainer_name}
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] font-mono font-black text-[#0F172A]">
                                                        <span>{enr.access_code}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                copyAccessCode(enr.access_code)
                                                            }
                                                            className="text-[#DA291C] hover:opacity-75 cursor-pointer"
                                                            title="Copiar código"
                                                        >
                                                            {copiedCode === enr.access_code ? (
                                                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                                            ) : (
                                                                <Copy className="w-3.5 h-3.5" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-4 font-extrabold text-[#DA291C]">
                                                    {enr.position_key}
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    <div className="flex items-center gap-1.5">
                                                        {[1, 2, 3, 4].map((d) => {
                                                            const done =
                                                                (d === 1 &&
                                                                    enr.day1_completed) ||
                                                                (d === 2 &&
                                                                    enr.day2_completed) ||
                                                                (d === 3 &&
                                                                    enr.day3_completed) ||
                                                                (d === 4 &&
                                                                    enr.day4_completed);
                                                            return (
                                                                <span
                                                                    key={d}
                                                                    className={`px-2 py-0.5 rounded-md text-[11px] font-black ${
                                                                        done
                                                                            ? 'bg-emerald-600 text-white'
                                                                            : enr.current_day === d
                                                                            ? 'bg-[#FFC72C] text-[#0F172A]'
                                                                            : 'bg-slate-100 text-slate-500'
                                                                    }`}
                                                                >
                                                                    D{d}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    <span
                                                        className={`px-2.5 py-1 rounded-full text-xs font-extrabold ${
                                                            expInfo.expired
                                                                ? 'bg-red-100 text-red-800'
                                                                : 'bg-emerald-50 text-emerald-800'
                                                        }`}
                                                    >
                                                        {expInfo.label}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 text-right space-x-2">
                                                    <Link
                                                        href={`/training/portal?code=${enr.access_code}`}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FFF0E5] text-[#DA291C] text-xs font-bold"
                                                    >
                                                        <ExternalLink className="w-3.5 h-3.5" />
                                                        Portal
                                                    </Link>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            handleExtendAccess(enr.id)
                                                        }
                                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                                                    >
                                                        <CalendarClock className="w-3.5 h-3.5" />
                                                        +4 Días
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            handleDeleteEnrollment(enr.id)
                                                        }
                                                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold cursor-pointer"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>

            {/* MODAL 1: INSCRIBIR NUEVO EMPLEADO Y GENERAR CÓDIGO TEMPORAL DE 4 DÍAS */}
            {showEnrollModal && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl border-2 border-[#FFC72C] max-w-lg w-full p-6 shadow-2xl space-y-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <span className="px-2.5 py-0.5 rounded-full bg-[#DA291C] text-white text-[10px] font-black uppercase">
                                    ACCESO TEMPORAL 96 HORAS (4 DÍAS)
                                </span>
                                <h3 className="text-lg font-black text-[#0F172A] mt-1">
                                    {t('training.enroll_modal_title')}
                                </h3>
                                <p className="text-xs text-slate-600 mt-0.5">
                                    {t('training.enroll_modal_subtitle')}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowEnrollModal(false)}
                                className="text-slate-400 hover:text-slate-700 font-black text-lg cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        {newlyCreatedEnrollment ? (
                            <div className="rounded-2xl bg-[#FFF9F2] border-2 border-[#FFC72C] p-5 text-center space-y-3">
                                <div className="text-xs font-black uppercase text-emerald-700">
                                    ¡Pase Temporal de 4 Días Generado con Éxito!
                                </div>
                                <div className="text-3xl font-mono font-black text-[#DA291C] tracking-wider">
                                    {newlyCreatedEnrollment.access_code}
                                </div>
                                <p className="text-xs text-slate-600">
                                    Comparte este código con{' '}
                                    <strong>{newlyCreatedEnrollment.employee_name}</strong> para que ingrese en la tableta de la tienda:
                                </p>
                                <div className="flex justify-center gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            copyAccessCode(newlyCreatedEnrollment.access_code)
                                        }
                                        className="px-4 py-2 rounded-xl bg-[#FFC72C] text-[#0F172A] text-xs font-black cursor-pointer"
                                    >
                                        Copiar Código {newlyCreatedEnrollment.access_code}
                                    </button>
                                    <Link
                                        href={`/training/portal?code=${newlyCreatedEnrollment.access_code}`}
                                        className="px-4 py-2 rounded-xl bg-[#DA291C] text-white text-xs font-black"
                                    >
                                        Abrir Portal de Aprendiz →
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            <form onSubmit={handleCreateEnrollment} className="space-y-3.5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        {t('training.enroll_field_name')} *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={enrollName}
                                        onChange={(e) => setEnrollName(e.target.value)}
                                        placeholder="Ej. Juan Pérez"
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold bg-[#FFFAF5]"
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            {t('training.enroll_field_store')}
                                        </label>
                                        <select
                                            value={enrollStoreName}
                                            onChange={(e) => setEnrollStoreName(e.target.value)}
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-[#FFFAF5]"
                                        >
                                            {STORES_LIST.map((st) => (
                                                <option key={st.id} value={st.name}>
                                                    {st.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            {t('training.enroll_field_position')}
                                        </label>
                                        <select
                                            value={enrollPositionKey}
                                            onChange={(e) =>
                                                setEnrollPositionKey(e.target.value)
                                            }
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-[#FFFAF5]"
                                        >
                                            {positions.map((p) => (
                                                <option
                                                    key={p.positionKey}
                                                    value={p.positionKey}
                                                >
                                                    {p.positionKey} —{' '}
                                                    {lang === 'en' ? p.labelEn : p.labelEs}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            {t('training.enroll_field_phone')}
                                        </label>
                                        <input
                                            type="text"
                                            value={enrollPhone}
                                            onChange={(e) => setEnrollPhone(e.target.value)}
                                            placeholder="(323) 000-0000"
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-[#FFFAF5]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1">
                                            {t('training.enroll_field_trainer')}
                                        </label>
                                        <input
                                            type="text"
                                            value={enrollTrainerName}
                                            onChange={(e) =>
                                                setEnrollTrainerName(e.target.value)
                                            }
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-[#FFFAF5]"
                                        />
                                    </div>
                                </div>
                                <div className="pt-2 flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowEnrollModal(false)}
                                        className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={enrollingBusy}
                                        className="px-5 py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs font-black cursor-pointer"
                                    >
                                        {enrollingBusy
                                            ? 'Generando...'
                                            : t('training.enroll_submit_btn')}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* MODAL 2: ESTUDIO DE EDICIÓN DE PASOS Y LOCUCIÓN MASCULINA IA (ORUS) */}
            {showStepEditorModal && currentVideo && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl border-2 border-[#FFC72C] max-w-3xl w-full max-h-[88vh] flex flex-col p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="px-2.5 py-0.5 rounded-full bg-[#FFF8E7] text-[#B45309] text-[10px] font-black uppercase border border-[#FFC72C]">
                                    ESTUDIO DE VOZ NEURAL MASCULINA (ORUS) + GEMINI IA
                                </span>
                                <h3 className="text-lg font-black text-[#0F172A] mt-1">
                                    Editar Guion o Explicar con IA — {currentVideo.titleEs}
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowStepEditorModal(false)}
                                className="text-slate-400 hover:text-slate-700 font-black text-lg cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="overflow-y-auto space-y-3 pr-1 flex-1">
                            {editableSteps.map((st, idx) => (
                                <div
                                    key={st.id}
                                    className="p-4 rounded-2xl bg-[#FFFAF5] border border-slate-200 space-y-2"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-xs font-black text-[#DA291C]">
                                            Paso {st.stepNumber} ({st.timestampLabel}):{' '}
                                            {lang === 'en' ? st.titleEn : st.titleEs}
                                        </span>
                                        <button
                                            type="button"
                                            disabled={aiGeneratingStepIdx === idx}
                                            onClick={() => handleAiRefineStep(idx)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#FFF8E7] hover:bg-[#FFC72C]/40 border border-[#FFC72C] text-xs font-extrabold text-[#0F172A] cursor-pointer"
                                        >
                                            <Wand2 className="w-3.5 h-3.5 text-[#DA291C]" />
                                            {aiGeneratingStepIdx === idx
                                                ? 'Refinando y Generando Voz...'
                                                : t('training.player_regenerate_ai')}
                                        </button>
                                    </div>
                                    <textarea
                                        rows={2}
                                        value={
                                            lang === 'en' ? st.narrationEn : st.narrationEs
                                        }
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setEditableSteps((prev) => {
                                                const next = [...prev];
                                                if (lang === 'en') {
                                                    next[idx] = {
                                                        ...next[idx],
                                                        narrationEn: val,
                                                    };
                                                } else {
                                                    next[idx] = {
                                                        ...next[idx],
                                                        narrationEs: val,
                                                    };
                                                }
                                                return next;
                                            });
                                        }}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                            <button
                                type="button"
                                onClick={() => setShowStepEditorModal(false)}
                                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={savingStepsBusy}
                                onClick={handleSaveEditedSteps}
                                className="px-5 py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs font-black cursor-pointer"
                            >
                                {savingStepsBusy
                                    ? 'Sintetizando Voz Masculina Orus...'
                                    : 'Guardar Guion y Actualizar Voz Masculina'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
