import { useState, useEffect, useCallback, useMemo } from 'react'
import { getSupabaseClient } from '@/lib/supabase'

export interface Question {
    id: string
    section_id: string
    text: string
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

const CACHE_PREFIX = 'checklist_template_'

export function useDynamicChecklist(templateCode: string) {
    const [data, setData] = useState<Template | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isCached, setIsCached] = useState(false)

    // Helper to log with prefix
    const log = (msg: string) => { } // console.log(`[useDynamicChecklist:${templateCode}] ${msg}`)

    const fetchTemplate = useCallback(async (isRefresh = false) => {
        if (!templateCode) return

        if (!isRefresh) {
            // 0. Cache-First Strategy (Immediate)
            const cacheKey = `${CACHE_PREFIX}${templateCode}`
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

            // D. Assemble
            const assembledSections: Section[] = (sectionsData || []).map(section => ({
                ...section,
                questions: allQuestions.filter(q => q.section_id === section.id)
            }))

            const finalData = {
                ...templateData,
                sections: assembledSections
            }

            // Update State
            setData(finalData)
            setIsCached(false)
            setError(null)

            // Update Cache
            if (typeof window !== 'undefined') {
                localStorage.setItem(`${CACHE_PREFIX}${templateCode}`, JSON.stringify(finalData))
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
    }, [templateCode]) // data removed to avoid identity change loop

    useEffect(() => {
        let isMounted = true
        if (templateCode) {
            fetchTemplate()
        }
        return () => { isMounted = false }
    }, [templateCode]) // fetchTemplate dependency removed to avoid identity-based infinite loops

    const refresh = useCallback(() => fetchTemplate(true), [fetchTemplate])

    return useMemo(() => ({
        data,
        loading,
        error,
        isCached,
        refresh
    }), [data, loading, error, isCached, refresh])
}
