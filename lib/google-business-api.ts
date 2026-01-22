import { createClient } from '@supabase/supabase-js'

// Tipos para la respuesta de Google
interface GoogleReview {
    reviewId: string
    reviewer: {
        displayName: string
        profilePhotoUrl?: string
    }
    starRating: string // "FIVE", "FOUR", etc. old API style or number? New API uses number usually but Enum strings sometimes.
    comment?: string
    createTime: string
    updateTime?: string
    name: string // resource name
}

// Mapeo de estrellas
const STAR_RATING_MAP: Record<string, number> = {
    'STAR_RATING_UNSPECIFIED': 0,
    'ONE': 1,
    'TWO': 2,
    'THREE': 3,
    'FOUR': 4,
    'FIVE': 5
}

/**
 * Función central para sincronizar reseñas (Mock logic por ahora hasta tener credenciales)
 * Se diseñará para ser invocada por un Cron Job.
 */
export async function syncGoogleReviews(storeId: string, googlePlaceId: string, accessToken: string) {
    console.log(`🔄 Iniciando sincronización para Tienda ${storeId} (Place: ${googlePlaceId})`)

    // 1. Obtener reseñas de la API de Google
    // const reviews = await fetchGoogleReviews(googlePlaceId, accessToken) 

    // MOCK DATA para probar la estructura
    const mockReviews: GoogleReview[] = [
        {
            reviewId: `g_review_${Date.now()}`,
            reviewer: { displayName: "Cliente Google Test", profilePhotoUrl: "" },
            starRating: "FIVE",
            comment: "Excelente servicio, muy rápido.",
            createTime: new Date().toISOString(),
            name: `accounts/x/locations/${googlePlaceId}/reviews/123`
        }
    ]

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY! // Necesitamos Service Role para escribir sin RLS a veces
    )

    let count = 0
    for (const review of mockReviews) {
        const rating = STAR_RATING_MAP[review.starRating] || 5

        // Conversión a NPS aproximado: 5->10, 4->8, 3->5, 2->0, 1->0
        // O simplemente guardamos el rating y validamos en UI.
        const npsEquivalent = rating === 5 ? 10 : rating === 4 ? 8 : rating === 3 ? 5 : 0

        const { error } = await supabase.from('customer_feedback').upsert({
            store_id: storeId,
            source: 'google',
            external_id: review.reviewId,
            nps_score: npsEquivalent,
            rating: rating,
            comments: review.comment,
            customer_name: review.reviewer.displayName,
            submission_date: review.createTime,
            status: 'pending'
        }, { onConflict: 'external_id' })

        if (!error) count++
        else console.error('Error insertando review:', error)
    }

    return { success: true, synced: count }
}
