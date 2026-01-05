import { useState, useEffect, useCallback } from 'react'
import { getSupabaseClient } from '@/lib/supabase'

export interface Question {
    id: string
    section_id: string
    text: string
    type: string
    order_index: number
    required_photo?: boolean
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

    const fetchTemplate = useCallback(async () => {
        try {
            // 0. Cache-First Strategy
            // Try to load from local storage immediately to unblock UI
            const cacheKey = `${CACHE_PREFIX}${templateCode}`
            if (typeof window !== 'undefined') {
                const cached = localStorage.getItem(cacheKey)
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached)
                        setData(parsed)
                        setIsCached(true)
                        setLoading(false) // Data is ready, no need to show spinner
                        console.log(`📦 Loaded ${templateCode} from cache`)
                    } catch (e) {
                        console.error('Error parsing cache:', e)
                    }
                }
            }

            // Only show spinner if we didn't find anything in cache
            if (!data) setLoading(true)

            // 1. Fetch Fresh Data (Background Update)
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

            // C. Get Questions (if there are sections)
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

            // D. Assemble Data (Nest questions into sections)
            const assembledSections: Section[] = (sectionsData || []).map(section => ({
                ...section,
                questions: allQuestions.filter(q => q.section_id === section.id)
            }))

            const finalData = {
                ...templateData,
                sections: assembledSections
            }

            // Update State & Cache
            setData(finalData)
            setIsCached(false) // Data is now fresh from network
            setError(null)

            if (typeof window !== 'undefined') {
                localStorage.setItem(cacheKey, JSON.stringify(finalData))
                console.log(`🔄 Updated cache for ${templateCode}`)
            }

        } catch (err: any) {
            console.error('Error fetching dynamic checklist:', err)

            // If we have data (from cache), don't break the UI with an error, just log/warn
            if (data) {
                console.warn('⚠️ Network failed, using cached data.')
                setIsCached(true) // Confirmed running on cache
            } else {
                setError(err.message || 'Error desconocido al cargar la plantilla')
            }
        } finally {
            setLoading(false)
        }
    }, [templateCode]) // Fixed: Removed 'data' from dependency to avoid infinite loop

    useEffect(() => {
        if (templateCode) {
            fetchTemplate()
        }
    }, [templateCode, fetchTemplate])

    return { data, loading, error, isCached, refresh: fetchTemplate }
}
