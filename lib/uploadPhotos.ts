export async function uploadPhotos(
  files: File[],
  bucket: 'feedback-photos' | 'staff-photos',
  prefix: string
): Promise<string[]> {
  const urls: string[] = []
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    console.error('Missing Supabase credentials')
    return []
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(7)
    const ext = file.name.split('.').pop() || 'jpg'
    const fileName = `${prefix}_${timestamp}_${randomStr}.${ext}`
    
    try {
      // Convert to base64
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1]) // Remove data:image/...;base64, prefix
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // Upload to Supabase Storage
      const uploadRes = await fetch(`${url}/storage/v1/object/${bucket}/${fileName}`, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': file.type,
          'x-upsert': 'false'
        },
        body: Buffer.from(base64, 'base64')
      })

      if (uploadRes.ok) {
        // Get public URL
        const publicURL = `${url}/storage/v1/object/public/${bucket}/${fileName}`
        urls.push(publicURL)
        console.log('✅ Photo uploaded:', publicURL)
      } else {
        const error = await uploadRes.text()
        console.error('❌ Upload failed:', error)
      }
    } catch (err) {
      console.error('Error uploading photo:', err)
    }
  }

  return urls
}