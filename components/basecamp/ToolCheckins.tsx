/**
 * @module ToolCheckins
 * @description Módulo de Preguntas Recurrentes Automáticas (Check-ins) para registrar reportes operativos diarios.
 *              Conecta directamente con Supabase (tablas bc_questionnaires, bc_questions, bc_answers)
 *              y realiza escrituras bidireccionales en Basecamp API a través de /api/basecamp/action.
 * @businessRules
 *   - Registro periódico voluntario/obligatorio de actividades.
 *   - Permite responder preguntas activas. Las respuestas se asocian al autor real de la sesión.
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id) y `currentUserName`.
 *   - Fetch: Obtiene preguntas del cuestionario del proyecto, y las respuestas para la pregunta seleccionada.
 *   - Escritura: Llama a `/api/basecamp/action` con `action: 'create_answer'`.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Standalone: Las respuestas persisten localmente en Supabase de forma autónoma.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { HelpCircle, Send, MessageSquare, User, Clock, Loader2, ChevronRight } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

interface ToolCheckinsProps {
    project: any
    currentUserName: string
}

export default function ToolCheckins({ project, currentUserName }: ToolCheckinsProps) {
    const supabase = getSupabaseWithAuth()
    const { t, language } = useLanguage()
    const [questions, setQuestions] = useState<any[]>([])
    const [selectedQuestion, setSelectedQuestion] = useState<any | null>(null)
    const [answers, setAnswers] = useState<any[]>([])
    const [inputText, setInputText] = useState('')
    const [loading, setLoading] = useState(true)
    const [answersLoading, setAnswersLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const [questionnaire, setQuestionnaire] = useState<{ id: string; bc_id: number } | null>(null)

    // Fetch questions
    const fetchQuestionsList = async () => {
        if (!project.db_id) return
        setLoading(true)
        try {
            // Get or create questionnaire container
            let { data: dbQuestionnaire } = await supabase
                .from('bc_questionnaires')
                .select('id, bc_id')
                .eq('project_id', project.db_id)
                .limit(1)
                .single()

            if (!dbQuestionnaire) {
                const tempBcId = Math.floor(Date.now() / 1000)
                const { data: newQuest, error: questErr } = await supabase
                    .from('bc_questionnaires')
                    .insert({
                        project_id: project.db_id,
                        bc_id: tempBcId
                    })
                    .select('id, bc_id')
                    .single()
                if (questErr) throw questErr
                dbQuestionnaire = newQuest
            }

            if (dbQuestionnaire) {
                setQuestionnaire({ id: dbQuestionnaire.id, bc_id: Number(dbQuestionnaire.bc_id) })

                // Fetch check-in questions
                let { data: dbQuestions, error: qErr } = await supabase
                    .from('bc_questions')
                    .select('*')
                    .eq('questionnaire_id', dbQuestionnaire.id)

                if (qErr) throw qErr

                // If no questions exist, seed a default one
                if (!dbQuestions || dbQuestions.length === 0) {
                    const tempBcId = Math.floor(Date.now() / 1000)
                    const { data: seededQ, error: seedErr } = await supabase
                        .from('bc_questions')
                        .insert({
                            project_id: project.db_id,
                            questionnaire_id: dbQuestionnaire.id,
                            bc_id: tempBcId,
                            title: '¿Qué trabajaste hoy? / What did you work on today?',
                            schedule_text: 'Todos los días a las 5:00 PM',
                            is_paused: false
                        })
                        .select('*')
                    if (seedErr) throw seedErr
                    dbQuestions = seededQ || []
                }

                setQuestions(dbQuestions || [])
                // Select first question by default
                if (dbQuestions && dbQuestions.length > 0) {
                    setSelectedQuestion(dbQuestions[0])
                }
            }
        } catch (err: any) {
            console.error('❌ [ToolCheckins FetchQ] Error:', err.message)
        } finally {
            setLoading(false)
        }
    }

    // Fetch answers for selected question
    const fetchQuestionAnswers = async (qId: string) => {
        setAnswersLoading(true)
        try {
            const { data: dbAnswers, error } = await supabase
                .from('bc_answers')
                .select(`
                    id, bc_id, content, created_at,
                    author:bc_people(name)
                `)
                .eq('question_id', qId)
                .order('created_at', { ascending: false })

            if (error) throw error
            setAnswers(dbAnswers || [])
        } catch (err: any) {
            console.error('❌ [ToolCheckins FetchA] Error:', err.message)
        } finally {
            setAnswersLoading(false)
        }
    }

    useEffect(() => {
        fetchQuestionsList()
    }, [project.id, project.db_id])

    // Load answers when selected question changes
    useEffect(() => {
        if (selectedQuestion) {
            fetchQuestionAnswers(selectedQuestion.id)
        } else {
            setAnswers([])
        }
    }, [selectedQuestion])

    // Send Answer
    const handleSendAnswer = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!inputText.trim() || !selectedQuestion || sending) return

        const contentToSend = inputText.trim()
        setInputText('')
        setSending(true)

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_answer',
                    projectId: project.id,
                    questionId: selectedQuestion.bc_id,
                    questionDbId: selectedQuestion.id,
                    content: contentToSend
                })
            })

            if (!res.ok) throw new Error(await res.text())
            await fetchQuestionAnswers(selectedQuestion.id)
        } catch (err: any) {
            console.error('❌ [ToolCheckins Send] Error posting answer:', err.message)
            setInputText(contentToSend)
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="flex-1 max-w-3xl mx-auto w-full flex flex-col gap-6">
            {/* Cabecera */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-700/10 text-amber-700 flex items-center justify-center border border-amber-600/20">
                        <HelpCircle size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-extrabold text-slate-850 dark:text-slate-100">
                            {t('basecamp.checkins')}
                        </h3>
                        <p className="text-[10px] text-slate-450 dark:text-slate-400 uppercase tracking-wider">
                            {t('basecamp.checkins_sub')}
                        </p>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Left Column: List of Questions */}
                    <div className="md:col-span-1 space-y-3">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">{t('basecamp.active_questions')}</h4>
                        {questions.map((q) => (
                            <div
                                key={q.id}
                                onClick={() => setSelectedQuestion(q)}
                                className={`p-3 rounded-xl border cursor-pointer transition-all text-xs flex justify-between items-center ${
                                    selectedQuestion?.id === q.id
                                        ? 'bg-amber-700 text-white border-amber-800 font-extrabold'
                                        : 'bg-[#fcfaf6] dark:bg-slate-850 border-slate-200/60 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-350'
                                }`}
                            >
                                <span className="line-clamp-2 leading-snug">
                                    {language === 'en' && q.title.split(' / ')[1] ? q.title.split(' / ')[1] : q.title.split(' / ')[0]}
                                </span>
                                <ChevronRight size={14} className="shrink-0 ml-1 opacity-70" />
                            </div>
                        ))}
                    </div>

                    {/* Right Column: Question Details & Answers */}
                    <div className="md:col-span-2 flex flex-col gap-6">
                        {selectedQuestion && (
                            <>
                                {/* Active Question Header */}
                                <div className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/65 dark:border-slate-800 p-5 rounded-2xl shadow-inner text-left">
                                    <h4 className="text-[9px] font-black text-amber-700 dark:text-amber-500 uppercase tracking-widest mb-1.5">
                                        Check-in
                                    </h4>
                                    <p className="text-sm font-extrabold text-slate-800 dark:text-slate-150">
                                        {language === 'en' && selectedQuestion.title.split(' / ')[1] ? selectedQuestion.title.split(' / ')[1] : selectedQuestion.title.split(' / ')[0]}
                                    </p>
                                    <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-semibold">
                                        {selectedQuestion.schedule_text
                                            ? selectedQuestion.schedule_text.replace('Todos los días', t('basecamp.every_day')).replace('a las', 'at')
                                            : t('basecamp.every_day')}
                                    </p>
                                </div>

                                {/* Answers feed */}
                                <div className="space-y-4">
                                    <h4 className="text-[10px] font-black text-slate-450 dark:text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-2">
                                        {t('basecamp.team_answers').replace('{count}', String(answers.length))}
                                    </h4>

                                    <div className="space-y-4">
                                        {answersLoading && answers.length === 0 ? (
                                            <div className="flex justify-center py-6">
                                                <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                            </div>
                                        ) : answers.length > 0 ? (
                                            answers.map((ans) => (
                                                <div
                                                    key={ans.id}
                                                    className="flex gap-4 p-4 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-2xl shadow-sm items-start text-left"
                                                >
                                                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold flex items-center justify-center text-xs shrink-0 uppercase">
                                                        {ans.author?.name ? ans.author.name[0] : (t('basecamp.anonymous_user')[0] || 'U')}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs font-black text-slate-800 dark:text-slate-100">
                                                                {ans.author?.name || t('basecamp.anonymous_user')}
                                                            </span>
                                                            <span className="text-[9px] text-slate-400 flex items-center gap-1">
                                                                <Clock size={10} />
                                                                {new Date(ans.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-slate-650 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
                                                            {ans.content}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-xs text-slate-400 italic text-center py-8">
                                                {t('basecamp.checkin_first_answer')}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Form to answer */}
                                <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
                                    <h4 className="text-xs font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider mb-3">
                                        {t('basecamp.your_answer_label')}
                                    </h4>
                                    <form onSubmit={handleSendAnswer} className="space-y-3">
                                        <textarea
                                            required
                                            value={inputText}
                                            onChange={(e) => setInputText(e.target.value)}
                                            disabled={sending}
                                            placeholder={t('basecamp.checkin_answer_placeholder')}
                                            className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-955 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs h-24 disabled:opacity-50"
                                        />
                                        <div className="flex justify-end">
                                            <button
                                                type="submit"
                                                disabled={sending || !inputText.trim()}
                                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm transition-all"
                                            >
                                                {sending ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <Send size={13} />
                                                )}
                                                <span>{t('basecamp.post_answer')}</span>
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
