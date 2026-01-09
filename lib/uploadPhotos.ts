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
      // 1. Limpiar nombre de archivo y generar ID único
      const fileExt = file.name.split('.').pop()
      const cleanFileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

      // 1.5 Compresión de Imagen
      const options = {
        maxSizeMB: 0.8,          // Aim for under 1MB
        maxWidthOrHeight: 1920,  // Full HD is enough for evidence
        useWebWorker: true,
        initialQuality: 0.8
      }

      let fileToUpload = file
      try {
        // Only compress images
        if (file.type.startsWith('image/')) {
          // console.log(`Compressing ${file.name} (${file.size / 1024 / 1024} MB)...`)
          fileToUpload = await imageCompression(file, options)
          // console.log(`Compressed to ${fileToUpload.size / 1024 / 1024} MB`)
        }
      } catch (e) {
        console.warn('Compression failed, uploading original:', e)
      }

      // 2. Subir usando el cliente de Supabase
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(cleanFileName, fileToUpload, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      // 3. Obtener la URL pública
      const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(cleanFileName)

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