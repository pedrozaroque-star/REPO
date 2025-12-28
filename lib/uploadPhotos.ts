import { supabase } from '@/lib/supabase'

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

      // 2. Subir usando el cliente de Supabase
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(cleanFileName, file, {
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
        console.log('✅ Foto subida:', data.publicUrl)
      }

    } catch (error: any) {
      console.error('Error subiendo foto:', error.message)
      // No lanzamos error para que intente subir las siguientes fotos
    }
  }
  return urls
}