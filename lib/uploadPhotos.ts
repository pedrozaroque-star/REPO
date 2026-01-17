import { supabase } from '@/lib/supabase'
import imageCompression from 'browser-image-compression'

export const uploadPhotos = async (
  files: File[],
  bucket: string, // Ej: 'checklist-photos'
  folder: string  // Ej: 'inspection'
) => {
  const urls: string[] = []

  for (const file of files) {
    try {
      // 1. Limpiar nombre de archivo base
      const fileExt = file.name.split('.').pop()
      const cleanFileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

      let finalFileName = cleanFileName
      let fileToUpload = file

      // 1.5 Súper Compresión de Imagen (Updated by Antigravity)
      const options = {
        maxSizeMB: 0.3,          // Aim for ~300KB
        maxWidthOrHeight: 1280,  // HD 720p is enough for evidence
        useWebWorker: true,
        fileType: 'image/webp',  // WebP saves ~30% more space
        initialQuality: 0.7
      }

      try {
        // Only compress images
        if (file.type.startsWith('image/')) {
          fileToUpload = await imageCompression(file, options)

          // Si se convirtió a WebP, actualizar la extensión
          if (fileToUpload.type === 'image/webp') {
            finalFileName = cleanFileName.replace(/\.[^/.]+$/, ".webp")
          }
        }
      } catch (e) {
        console.warn('Compression failed, uploading original:', e)
      }

      // 2. Subir usando el cliente de Supabase
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(finalFileName, fileToUpload, {
          contentType: fileToUpload.type,
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      // 3. Obtener la URL pública
      const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(finalFileName)

      if (data?.publicUrl) {
        urls.push(data.publicUrl)
      }

    } catch (error: any) {
      console.error('Error subiendo foto:', error.message)
      // No lanzamos error para que intente subir las siguientes fotos
    }
  }
  return urls
}