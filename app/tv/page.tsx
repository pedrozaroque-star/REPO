/**
 * @module app/tv/page
 * @description Visor de menú digital en pantalla completa para televisores de comedor de Tacos Gavilan (`/tv`).
 * @businessRules
 * - Resuelve códigos cortos de sucursal (`AZ`, `LY`, `SL`, etc.) y selecciona la imagen de variación específica o la imagen universal por `screen`.
 * - Tras activar pantalla completa, consulta silenciosamente `/api/tv-update` cada 5 minutos para actualizar menús sin recargar la TV.
 * @dataFlow
 * - SSR (`app/tv/page.tsx`) -> Supabase (`tv_images`) -> HTML + auto-updater cliente -> GET `/api/tv-update` (`cache: "no-cache"`, Edge CDN `s-maxage=300`).
 * @notes
 * - [2026-11-19] Actualizado a revalidación `cache: "no-cache"` con intervalo de 5 min (`300000`) para aprovechar Vercel Edge CDN (`s-maxage=300`) sin sacrificar actualizaciones de menú.
 */

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

  const rawStoreInput = typeof resolvedParams.store === 'string' ? resolvedParams.store.trim().toUpperCase() : 'ALL'
  const knownStoreNames = new Set(Object.values(STORE_CODES))
  const sanitizedStoreToken = knownStoreNames.has(rawStoreInput)
    ? rawStoreInput
    : /^[A-Z0-9_-]{1,36}$/.test(rawStoreInput)
      ? rawStoreInput
      : 'ALL'
  const storeParam = STORE_CODES[sanitizedStoreToken] || sanitizedStoreToken
  const safeStoreQuery = encodeURIComponent(storeParam).replace(/'/g, '%27')

  const rawScreenInput = typeof resolvedParams.screen === 'string' ? resolvedParams.screen.trim() : '1'
  const screenParam = /^[0-9]{1,2}$/.test(rawScreenInput)
    ? Math.min(Math.max(parseInt(rawScreenInput, 10) || 1, 1), 20)
    : 1

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
                body.hide-cursor, body.hide-cursor * { cursor: none !important; }
            `}} />

      {/* BOTON BRUTO Y AUTO-UPDATER */}
      {activeImage ? (
        <>
          <div dangerouslySetInnerHTML={{
            __html: `
              <button id="fs-btn" onclick='
                var doc = document.documentElement;
                var req = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullscreen || doc.msRequestFullscreen;
                try {
                    if (req) {
                        var p = req.call(doc);
                        if (p && typeof p.catch === "function") {
                            p.catch(function(err){});
                        }
                    }
                } catch(e) {}
                this.style.display = "none";
                document.body.classList.add("hide-cursor");
                document.documentElement.style.cursor = "none";
                
                if (!window.tvFullscreenListener) {
                    window.tvFullscreenListener = true;
                    var exitHandler = function() {
                        if (!document.fullscreenElement && !document.webkitIsFullScreen && !document.mozFullScreen && !document.msFullscreenElement) {
                            document.body.classList.remove("hide-cursor");
                            document.documentElement.style.cursor = "auto";
                            var btn = document.getElementById("fs-btn");
                            if (btn) btn.style.display = "block";
                        }
                    };
                    document.addEventListener("fullscreenchange", exitHandler);
                    document.addEventListener("webkitfullscreenchange", exitHandler);
                    document.addEventListener("mozfullscreenchange", exitHandler);
                    document.addEventListener("MSFullscreenChange", exitHandler);
                }
                
                if (!window.tvSilentUpdateStarted) {
                    window.tvSilentUpdateStarted = true;
                    setInterval(function() {
                        try {
                            fetch("/api/tv-update?screen=" + ${screenParam} + "&store=${safeStoreQuery}", { cache: "no-cache", keepalive: true })
                                .then(function(res) { return res.json(); })
                                .then(function(data) {
                                    if (data && data.url) {
                                        var img = document.getElementById("tv-image");
                                        if (img && img.src !== data.url) {
                                            img.src = data.url;
                                        }
                                    }
                                })
                                .catch(function(e) {});
                        } catch(e) {}
                    }, 300000); // Check cada 5 minutos aprovechando Vercel Edge CDN (s-maxage=300)
                }
              ' style="position: absolute; z-index: 10000; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 1.5rem 3rem; font-size: 2rem; font-weight: bold; background: #4F46E5; color: #fff; border: none; border-radius: 1rem; cursor: pointer; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
                  Start Fullscreen Mode
                  <div style="font-size: 1rem; margin-top: 10px; opacity: 0.8">Click this button to remove the browser bar</div>
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

          {/* Overlay y modo mantenimiento gobernado remotamente desde /admin/control-remoto */}
          <div
              id="tv-remote-blackout"
              style={{
                  display: 'none',
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: '#000000',
                  color: '#ffffff',
                  zIndex: 10050,
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '3rem',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
          >
              <div id="tv-remote-blackout-text" style={{ fontSize: '3rem', fontWeight: 800, maxWidth: '80vw' }} />
          </div>
          <div
              id="tv-remote-overlay"
              style={{
                  display: 'none',
                  position: 'fixed',
                  bottom: '2.5rem',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'rgba(15, 23, 42, 0.94)',
                  color: '#ffffff',
                  padding: '1.25rem 2.5rem',
                  borderRadius: '1.25rem',
                  border: '2px solid rgba(251, 191, 36, 0.7)',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)',
                  zIndex: 10040,
                  maxWidth: '88vw',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: '2rem',
                  fontWeight: 800,
                  textAlign: 'center',
              }}
          />

          <script
              dangerouslySetInnerHTML={{
                  __html: `(function(){
                    if (window.__tegTvBridgeInit) return;
                    window.__tegTvBridgeInit = true;
                    var storeParam = ${JSON.stringify(storeParam)};
                    var screenNum = ${screenParam};
                    var safeStoreQuery = ${JSON.stringify(safeStoreQuery)};
                    var doneIds = {};

                    function applyRemoteState(state) {
                      if (!state) return;
                      var blackoutEl = document.getElementById('tv-remote-blackout');
                      var blackoutTxt = document.getElementById('tv-remote-blackout-text');
                      var overlayEl = document.getElementById('tv-remote-overlay');
                      if (blackoutEl && blackoutTxt) {
                        if (state.blackoutMode) {
                          blackoutTxt.textContent = state.overlayMessage || '';
                          blackoutEl.style.display = 'flex';
                        } else {
                          blackoutEl.style.display = 'none';
                        }
                      }
                      if (overlayEl) {
                        if (!state.blackoutMode && state.overlayMessage) {
                          overlayEl.textContent = state.overlayMessage;
                          overlayEl.style.display = 'block';
                        } else {
                          overlayEl.style.display = 'none';
                        }
                      }
                    }

                    function ackTv(cmdId, status, output, errorMessage) {
                      try {
                        fetch('/api/remote-control/tv-bridge', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          keepalive: true,
                          body: JSON.stringify({
                            action: 'ack',
                            storeCode: storeParam,
                            screenNumber: screenNum,
                            commandId: cmdId,
                            status: status,
                            output: output || '',
                            errorMessage: errorMessage || null
                          })
                        }).catch(function(){});
                      } catch(e) {}
                    }

                    function runTvCommand(cmd) {
                      if (!cmd || !cmd.id || doneIds[cmd.id]) return;
                      doneIds[cmd.id] = true;
                      var t = cmd.command_type;
                      var p = cmd.payload || {};
                      if (t === 'reload_page') {
                        ackTv(cmd.id, 'succeeded', 'Recargando pantalla TV');
                        setTimeout(function(){ window.location.reload(); }, 250);
                        return;
                      }
                      if (t === 'refresh_menu') {
                        fetch('/api/tv-update?screen=' + screenNum + '&store=' + safeStoreQuery + '&_t=' + Date.now(), { cache: 'no-store' })
                          .then(function(r){ return r.json(); })
                          .then(function(d){
                            var img = document.getElementById('tv-image');
                            if (d && d.url && img) {
                              img.src = d.url + (d.url.indexOf('?') === -1 ? '?v=' : '&v=') + Date.now();
                              ackTv(cmd.id, 'succeeded', 'Menú TV actualizado al instante');
                            } else {
                              ackTv(cmd.id, 'failed', '', 'No se encontró imagen asignada');
                            }
                          })
                          .catch(function(err){ ackTv(cmd.id, 'failed', '', String(err)); });
                        return;
                      }
                      if (t === 'switch_screen') {
                        var nextSc = parseInt(p.screenNumber, 10);
                        if (nextSc >= 1 && nextSc <= 20) {
                          ackTv(cmd.id, 'succeeded', 'Cambiando TV a pantalla ' + nextSc);
                          setTimeout(function(){
                            window.location.assign('/tv?screen=' + nextSc + '&store=' + safeStoreQuery);
                          }, 250);
                        } else {
                          ackTv(cmd.id, 'failed', '', 'Número de pantalla inválido');
                        }
                        return;
                      }
                      if (t === 'set_blackout') {
                        applyRemoteState({ blackoutMode: !!p.blackout, overlayMessage: p.message || '' });
                        ackTv(cmd.id, 'succeeded', p.blackout ? 'Modo pantalla negra activado' : 'Modo pantalla negra desactivado');
                        return;
                      }
                      if (t === 'show_overlay') {
                        applyRemoteState({ blackoutMode: false, overlayMessage: p.message || '' });
                        ackTv(cmd.id, 'succeeded', 'Aviso mostrado en TV');
                        return;
                      }
                      if (t === 'clear_overlay') {
                        applyRemoteState({ blackoutMode: false, overlayMessage: null });
                        ackTv(cmd.id, 'succeeded', 'Aviso limpiado en TV');
                        return;
                      }
                    }

                    function pollTvBridge() {
                      try {
                        var img = document.getElementById('tv-image');
                        fetch('/api/remote-control/tv-bridge', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          cache: 'no-store',
                          body: JSON.stringify({
                            action: 'sync',
                            storeCode: storeParam,
                            screenNumber: screenNum,
                            telemetry: {
                              screenNumber: screenNum,
                              activeImageUrl: img ? img.src : null,
                              isFullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement),
                              screenResolution: (window.screen ? window.screen.width : window.innerWidth) + 'x' + (window.screen ? window.screen.height : window.innerHeight),
                              userAgent: (navigator.userAgent || '').slice(0, 220)
                            }
                          })
                        })
                        .then(function(r){ return r.ok ? r.json() : null; })
                        .then(function(data){
                          if (!data || !data.success) return;
                          if (data.state) applyRemoteState(data.state);
                          if (Array.isArray(data.commands)) {
                            for (var i = 0; i < data.commands.length; i++) {
                              runTvCommand(data.commands[i]);
                            }
                          }
                        })
                        .catch(function(){});
                      } catch(e) {}
                    }

                    setTimeout(pollTvBridge, 3500);
                    setInterval(pollTvBridge, 60000);
                  })();`
              }}
          />
        </>
      ) : (
        <div className="p-8 text-center" style={{zIndex: 9999}}>
          <h1 className="text-4xl font-black mb-4 text-red-500">
            TV Menu Error {screenParam} / Store {storeParam}
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl">{errorStatus}</p>
        </div>
      )}
    </div>
  )
}
