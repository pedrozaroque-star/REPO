'use server'

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export async function uploadImageNewAction(
    formData: FormData,
    sortOrder: number,
    screenNumber: number,
    isAlways: boolean,
    startTime: string | null,
    endTime: string | null,
    customSchedules: any[]
) {
    const file = formData.get('file') as File
    if (!file) throw new Error("No file provided")

    const fileExt = file.name.split('.').pop()
    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`
    const filePath = `screen_${screenNumber}/${fileName}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabaseAdmin.storage
        .from('tv_menus')
        .upload(filePath, buffer, {
            contentType: file.type,
            upsert: false
        })

    if (uploadError) {
        throw new Error(uploadError.message)
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
        .from('tv_menus')
        .getPublicUrl(filePath)

    // Convert empty schedules array to valid JSON array
    const cleanSchedules = customSchedules || []

    const { error: dbError } = await supabaseAdmin
        .from('tv_images')
        .insert([{
            storage_path: publicUrl,
            sort_order: sortOrder,
            duration_seconds: 15,
            screen_number: screenNumber,
            is_always: isAlways,
            start_time: startTime || null,
            end_time: endTime || null,
            custom_schedules: cleanSchedules
        }])

    if (dbError) {
        console.error("Action Error uploadImageNewAction:", dbError)
        throw new Error(dbError.message)
    }

    return true
}

export async function deleteImageNewAction(id: string, storagePath: string) {
    const { error: dbError } = await supabaseAdmin
        .from('tv_images')
        .delete()
        .eq('id', id)

    if (dbError) throw new Error(dbError.message)

    try {
        const urlParts = storagePath.split('/tv_menus/')
        if (urlParts.length > 1) {
            const path = urlParts[1]
            await supabaseAdmin.storage.from('tv_menus').remove([path])
        }
    } catch (e) {
        console.error("Error removing from storage, ignoring...", e)
    }

    return true
}

export async function updateImageSchedulesAction(id: string, customSchedules: any[]) {
    const { error } = await supabaseAdmin
        .from('tv_images')
        .update({ custom_schedules: customSchedules })
        .eq('id', id)

    if (error) {
        console.error("Action Error updateImageSchedulesAction:", error)
        throw new Error(error.message)
    }
    return true
}
