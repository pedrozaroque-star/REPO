'use server'

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export async function uploadImageNewAction(
    formData: FormData,
    sortOrder: number,
    screenNumber: number,
    isUniversal: boolean,
    storeAssignments: string[]
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

    const { error: dbError } = await supabaseAdmin
        .from('tv_images')
        .insert([{
            storage_path: publicUrl,
            sort_order: sortOrder,
            duration_seconds: 15,
            screen_number: screenNumber,
            is_universal: isUniversal,
            store_assignments: storeAssignments
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

export async function updateImageStoresAction(id: string, storeAssignments: string[]) {
    const { error } = await supabaseAdmin
        .from('tv_images')
        .update({ store_assignments: storeAssignments })
        .eq('id', id)

    if (error) {
        throw new Error(error.message)
    }
    return true
}
