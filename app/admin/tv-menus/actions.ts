'use server'

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export async function createFolderAction(name: string, start_time: string, end_time: string) {
    const { data, error } = await supabaseAdmin
        .from('tv_folders')
        .insert([{ name, start_time, end_time }])
        .select()

    if (error) {
        console.error("Action Error createFolder:", error)
        throw new Error(error.message)
    }
    return data[0]
}

export async function deleteFolderAction(id: string) {
    const { error } = await supabaseAdmin
        .from('tv_folders')
        .delete()
        .eq('id', id)

    if (error) {
        console.error("Action Error deleteFolder:", error)
        throw new Error(error.message)
    }
    return true
}

export async function uploadImageAction(folderId: string, formData: FormData, sortOrder: number, screenNumber: number) {
    const file = formData.get('file') as File
    if (!file) throw new Error("No file provided")

    const fileExt = file.name.split('.').pop()
    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`
    const filePath = `${folderId}/${fileName}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabaseAdmin.storage
        .from('tv_menus')
        .upload(filePath, buffer, {
            contentType: file.type,
            upsert: false
        })

    if (uploadError) {
        console.error("Action Error uploadImage Storage:", uploadError)
        throw new Error(uploadError.message)
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
        .from('tv_menus')
        .getPublicUrl(filePath)

    const { error: dbError } = await supabaseAdmin
        .from('tv_images')
        .insert([{
            folder_id: folderId,
            storage_path: publicUrl,
            sort_order: sortOrder,
            duration_seconds: 15,
            screen_number: screenNumber || 1
        }])

    if (dbError) {
        console.error("Action Error uploadImage DB:", dbError)
        throw new Error(dbError.message)
    }

    return true
}

export async function deleteImageAction(id: string, storagePath: string) {
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

export async function updateFolderSchedulesAction(id: string, schedules: any[]) {
    const { error } = await supabaseAdmin
        .from('tv_folders')
        .update({ custom_schedules: schedules })
        .eq('id', id)

    if (error) {
        console.error("Action Error updateFolderSchedules:", error)
        throw new Error(error.message)
    }
    return true
}
