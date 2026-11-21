/**
 * @module app/t/[screen]/[store]/page
 * @description Ruta corta pública para televisores de comedor (`/t/[screen]/[store]`) que delega a `TvViewerPage` tras sanitizar estrictamente los parámetros de URL.
 * @businessRules
 * - Sanitiza `screen` y `store` con `/^[a-zA-Z0-9_-]{1,36}$/` para impedir XSS reflejado por comillas simples o caracteres especiales.
 * @dataFlow
 * - URL `/t/[screen]/[store]` -> sanitización estricta -> `TvViewerPage`.
 */

import TvViewerPage from '@/app/tv/page'

export const dynamic = 'force-dynamic'

const SAFE_PARAM_REGEX = /^[a-zA-Z0-9_-]{1,36}$/

export default async function ShortTvViewer({
    params
}: {
    params: Promise<{ screen: string; store: string }> | { screen: string; store: string }
}) {
    const resolvedParams = await Promise.resolve(params)

    const rawScreen = typeof resolvedParams.screen === 'string' ? resolvedParams.screen.trim() : '1'
    const rawStore = typeof resolvedParams.store === 'string' ? resolvedParams.store.trim() : 'ALL'

    const safeScreen = SAFE_PARAM_REGEX.test(rawScreen) && /^[0-9]{1,2}$/.test(rawScreen) ? rawScreen : '1'
    const safeStore = SAFE_PARAM_REGEX.test(rawStore) ? rawStore : 'ALL'

    const mockSearchParams = Promise.resolve({
        screen: safeScreen,
        store: safeStore
    })

    return <TvViewerPage searchParams={mockSearchParams} />
}
