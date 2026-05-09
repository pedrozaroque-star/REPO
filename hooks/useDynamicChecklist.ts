import { useState, useEffect, useCallback, useMemo } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import { useLanguage } from '@/lib/i18n'
import { getTranslatedQuestion, getTranslatedSection, getTranslatedTemplate } from '@/lib/checklist-translations'
import { getTranslatedSupervisor } from '@/lib/supervisor-translations'

export interface Question {
    id: string
    section_id: string
    text: string
    original_text?: string
    type: string
    order_index: number
    required_photo?: boolean
    created_at?: string
}

export interface Section {
    id: string
    template_id: string
    title: string
    color_theme: string
    order_index: number
    questions: Question[]
}

export interface Template {
    id: string
    code: string
    title: string
    type: string
    sections: Section[]
}

const CACHE_PREFIX = 'checklist_template_v3_'

export function useDynamicChecklist(templateCode: string) {
    const { language } = useLanguage()
    const [data, setData] = useState<Template | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isCached, setIsCached] = useState(false)

    // Helper to log with prefix
    const log = (msg: string) => { } // console.log(`[useDynamicChecklist:${templateCode}] ${msg}`)

    const fetchTemplate = useCallback(async (isRefresh = false) => {
        if (!templateCode) return

        // Include language in cache key to support bilingual switching
        const cacheKey = `${CACHE_PREFIX}${templateCode}_${language}`

        if (!isRefresh) {
            // 0. Cache-First Strategy (Immediate)
            if (typeof window !== 'undefined') {
                const cached = localStorage.getItem(cacheKey)
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached)
                        setData(parsed)
                        setIsCached(true)
                        setLoading(false)
                        log('📦 Loaded from cache')
                    } catch (e) {
                        console.error('Error parsing cache:', e)
                    }
                }
            }
        }

        try {
            // Only show spinner if we don't have data yet
            // We use a functional query or just rely on the fact that setLoading(true) 
            // won't hurt if it's already true, but we want to avoid unnecessary flashes.
            setLoading(prev => data ? prev : true)

            const supabase = await getSupabaseClient()

            // A. Get Template
            const { data: templateData, error: templateError } = await supabase
                .from('templates')
                .select('*')
                .eq('code', templateCode)
                .single()

            if (templateError) throw templateError
            if (!templateData) throw new Error(`Plantilla no encontrada: ${templateCode}`)

            // B. Get Sections
            const { data: sectionsData, error: sectionsError } = await supabase
                .from('template_sections')
                .select('*')
                .eq('template_id', templateData.id)
                .order('order_index', { ascending: true })

            if (sectionsError) throw sectionsError

            // C. Get Questions
            let allQuestions: Question[] = []
            if (sectionsData && sectionsData.length > 0) {
                const sectionIds = sectionsData.map(s => s.id)
                const { data: questionsData, error: questionsError } = await supabase
                    .from('template_questions')
                    .select('*')
                    .in('section_id', sectionIds)
                    .order('order_index', { ascending: true })

                if (questionsError) throw questionsError
                allQuestions = questionsData || []
            }

            // D. Assemble (WITH TRANSLATION)
            const assembledSections: Section[] = (sectionsData || []).map(section => ({
                ...section,
                questions: allQuestions.filter(q => q.section_id === section.id).map(q => {
                    const translatedById = getTranslatedQuestion(q.id, q.text, language as 'es' | 'en')
                    const finalTranslation = translatedById === q.text ? getTranslatedSupervisor(q.text, language as 'es' | 'en') : translatedById

                    return {
                        ...q,
                        original_text: q.text, // Keep original for logic
                        text: finalTranslation // Translate for Display
                    }
                })
            })).map(s => {
                const translatedById = getTranslatedSection(s.id, s.title, language as 'es' | 'en')
                const finalTranslation = translatedById === s.title ? getTranslatedSupervisor(s.title, language as 'es' | 'en') : translatedById

                return {
                    ...s,
                    original_title: s.title, // Keep original for database lookup
                    title: finalTranslation
                }
            })

            const finalData = {
                ...templateData,
                title: getTranslatedTemplate(templateCode, templateData.title, language as 'es' | 'en'),
                sections: assembledSections
            }

            // Update State
            setData(finalData)
            setIsCached(false)
            setError(null)

            // Update Cache (Scoped by Language)
            if (typeof window !== 'undefined') {
                localStorage.setItem(cacheKey, JSON.stringify(finalData))
                log('🔄 Updated cache from network')
            }

        } catch (err: any) {
            console.error('Error fetching dynamic checklist:', err)
            // Error handling: if we have data (from cache), keep it but set error null to not show error UI
            // unless we strictly want to know the fetch failed.
            if (!data) {
                setError(err.message || 'Error al cargar la plantilla')
            }
        } finally {
            setLoading(false)
        }
    }, [templateCode, language]) // Added language dependency to re-fetch/re-translate

    // Effect to clear cache if VERSION changes (optional, but good practice) or force refresh logic
    // But for now, just relying on the new key structure.

    useEffect(() => {
        let isMounted = true
        if (templateCode) {
            fetchTemplate()
        }
        return () => { isMounted = false }
    }, [fetchTemplate]) // fetchTemplate changes when language changes due to dependency

    const refresh = useCallback(() => fetchTemplate(true), [fetchTemplate])

    return useMemo(() => ({
        data,
        loading,
        error,
        isCached,
        refresh
    }), [data, loading, error, isCached, refresh])
}
