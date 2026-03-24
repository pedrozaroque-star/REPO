import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic';

export default async function TvViewerPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }> | { [key: string]: string | string[] | undefined }
}) {
  // Soportar Next.js 14 (Objeto) y Next.js 15+ (Promesa)
  const resolvedParams = await Promise.resolve(searchParams);

  const STORE_CODES: Record<string, string> = {
    "AZ": "AZUSA", "BE": "BELL", "DO": "DOWNEY", "HO": "HOLLYWOOD",
    "HP": "HUNTINGTON PARK", "BW": "LA BROADWAY", "CE": "LA CENTRAL",
    "LP": "LA PUENTE", "LY": "LYNWOOD", "NO": "NORWALK", "RI": "RIALTO",
    "SA": "SANTA ANA", "SL": "SLAUSON", "SG": "SOUTH GATE", "WC": "WEST COVINA"
  }

  const rawStore = typeof resolvedParams.store === 'string' ? resolvedParams.store.toUpperCase() : 'ALL'
  const storeParam = STORE_CODES[rawStore] || rawStore
  const screenParam = parseInt(typeof resolvedParams.screen === 'string' ? resolvedParams.screen : '1', 10) || 1

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  // Usamos el SERVICE_KEY para brincarnos cualquier regla estructural en el Server Component y asegurar la lectura
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  let activeImage = null
  let errorStatus = null

  try {
    const { data: imgs, error: imgsError } = await supabase
      .from('tv_images')
      .select('*')
      .eq('screen_number', screenParam)
      .order('sort_order', { ascending: true })

    if (imgsError) throw imgsError

    if (!imgs || imgs.length === 0) {
      errorStatus = 'No hay imágenes configuradas para la pantalla ' + screenParam
    } else {
      // Regla 1: Hay una imagen de "Variación" asignada específicamente a ESTA tienda
      const variationImages = imgs.filter(img =>
        img.is_universal === false &&
        Array.isArray(img.store_assignments) &&
        img.store_assignments.includes(storeParam)
      )

      // Regla 2: Toma la Primera imagen Universal
      const universalImages = imgs.filter(img => img.is_universal === true)

      if (variationImages.length > 0) {
        // Siempre usamos la primera que encuentre, ignorando rotaciones porque la tele es estática
        activeImage = variationImages[0]
      } else if (universalImages.length > 0) {
        activeImage = universalImages[0]
      } else {
        errorStatus = 'Menú no asignado para esta tienda.'
      }
    }
  } catch (err) {
    console.error('Error fetching TV menu:', err)
    errorStatus = 'Error de conexión a la base de datos'
  }

  return (
    <div 
            style={{ 
                position: 'fixed', 
                top: 0, left: 0, right: 0, bottom: 0, 
                width: '100vw', height: '100vh', 
                backgroundColor: '#000000', 
                margin: 0, padding: 0, 
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999
            }}
        >
            <style dangerouslySetInnerHTML={{__html: `
                body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; height: 100% !important; background-color: #000000 !important; overflow: hidden !important; }
            `}} />

      {/* BOTON BRUTO Y AUTO-UPDATER */}
      {activeImage ? (
        <>
          <div dangerouslySetInnerHTML={{
            __html: `
              <button id="fs-btn" onclick="
                var doc = document.documentElement;
                var req = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullscreen || doc.msRequestFullscreen;
                if (req) {
                    req.call(doc).catch(function(err){ console.log(err); });
                }
                this.style.display = 'none';
                
                if (!window.tvSilentUpdateStarted) {
                    window.tvSilentUpdateStarted = true;
                    setInterval(function() {
                        fetch(window.location.href, { cache: 'no-store' })
                            .then(function(res) { return res.text(); })
                            .then(function(html) {
                                var match = html.match(/id=\\"tv-image\\".*?src=\\"([^\\"]+)\\"/);
                                if (match && match[1]) {
                                    var img = document.getElementById('tv-image');
                                    if (img && img.src !== match[1]) {
                                        img.src = match[1];
                                    }
                                }
                            })
                            .catch(function(e) { console.log('Update err', e); });
                    }, 60000);
                }
              " style="position: absolute; z-index: 10000; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 1.5rem 3rem; font-size: 2rem; font-weight: bold; background: #4F46E5; color: #fff; border: none; border-radius: 1rem; cursor: pointer; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
                  Iniciar Pantalla Completa
                  <div style="font-size: 1rem; margin-top: 10px; opacity: 0.8">Oprima el botón 'OK' en el control remoto para remover la barra</div>
              </button>
            `
          }} />

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
              id="tv-image"
              src={activeImage.storage_path}
              alt="Menu TV"
              style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
          />
        </>
      ) : (
        <div className="p-8 text-center" style={{zIndex: 9999}}>
          <h1 className="text-4xl font-black mb-4 text-red-500">
            Error en TV {screenParam} / Sucursal {storeParam}
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl">{errorStatus}</p>
        </div>
      )}
    </div>
  )
}
