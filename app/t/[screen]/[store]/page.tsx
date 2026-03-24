import TvViewerPage from '@/app/tv/page'

export const dynamic = 'force-dynamic';

export default async function ShortTvViewer({
    params
}: {
    params: Promise<{ screen: string; store: string }> | { screen: string; store: string }
}) {
    // Resolver `params` para soporte de Next.js 15+ y anteriores
    const resolvedParams = await Promise.resolve(params);
    
    // Convertir a formato de Query String (Mock)
    const mockSearchParams = Promise.resolve({
        screen: resolvedParams.screen,
        store: resolvedParams.store
    });

    // Inyectar al visor original
    return <TvViewerPage searchParams={mockSearchParams} />
}
