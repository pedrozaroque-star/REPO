/**
 * @module admin/compras/viele/print-sheet
 * @description Hoja imprimible de conteo fisico y pedido semanal para insumos de Viele & Sons.
 *              Formato calibrado estrictamente para 2 paginas tamano Carta (Letter Portrait: 8.5 x 11 in).
 *              Incluye vista previa realista en pantalla con margenes de papel y salto de pagina exacto.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente, nunca Tacos El Gavilan).
 * - Cero emojis en encabezados, botones, tablas y textos.
 * - Papel: Carta (Letter 8.5 x 11 pulgadas / 215.9 x 279.4 mm).
 * - Exactamente 2 paginas sin desbordes ni renglones huerfanos.
 * - Formula oficial: PEDIDO = MAX(0, PAR - SOBRANTE).
 * - Distribucion balanceada: Pagina 1 (articulos 1 a 44), Pagina 2 (articulos 45 a 87/88).
 *
 * @dataFlow
 * - /api/viele/catalog?storeId=X -> catalogo activo de la sucursal (87 u 88 SKUs).
 * - /api/viele/pars?storeId=X -> niveles de PAR vigentes de la sucursal.
 *
 * @notes
 * - [2026-09-27] Rediseno integral de impresion: estructura en contenedores independientes .sheet-page
 *   con altura acotada a 950px para garantizar que NUNCA desborde los 1010px imprimibles de Letter.
 * - Eliminados todos los emojis del encabezado y la barra de herramientas.
 * - Vista previa en pantalla renderiza hojas Carta con sombras de papel reales y divisor visual.
 */

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute';
import { VIELE_PUBLIC_STORES, formatUsDate, formatUsFullDate } from '@/lib/viele-stores-public';

interface CatalogItem {
  item_code: string;
  description: string;
  uom: string;
  unit_price: number;
  category: string;
  image_file: string;
  sort_order: number;
}

function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null;
  return {
    ...extraHeaders,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
}

function PrintSheetContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const userRole = (user?.role || '').toLowerCase();
  const isManager = userRole === 'manager' || userRole === 'gerente' || userRole === 'asistente';
  const userStoreId = user?.store_id ? String(user.store_id) : null;

  const targetStoreId = isManager && userStoreId ? userStoreId : (searchParams.get('storeId') || '14');
  const [storeId, setStoreId] = useState<string>(targetStoreId);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [pars, setPars] = useState<Record<string, number>>({});
  const [storeName, setStoreName] = useState<string>('Lynwood #14');
  const [loading, setLoading] = useState<boolean>(true);

  // Auto-sincronizar storeId cuando el usuario carga asincronamente
  useEffect(() => {
    if (isManager && userStoreId && storeId !== userStoreId) {
      setStoreId(userStoreId);
    }
  }, [isManager, userStoreId, storeId]);

  // Cargar catalogo e informacion de la tienda
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const catRes = await fetch(`/api/viele/catalog?storeId=${storeId}`, {
          headers: getAuthHeaders()
        });
        const catJson = await catRes.json();

        const parRes = await fetch(`/api/viele/pars?storeId=${storeId}`, {
          headers: getAuthHeaders()
        });
        const parJson = await parRes.json();
        const storePars = parJson.success ? parJson.pars || {} : {};
        setPars(storePars);

        if (catJson.success && catJson.data) {
          setItems(catJson.data);
        }

        const account = VIELE_PUBLIC_STORES[parseInt(storeId)];
        if (account) {
          setStoreName(`${account.storeName} #${account.storeId}`);
        } else {
          setStoreName(`Tienda #${storeId}`);
        }
      } catch (err) {
        console.error('Error cargando datos de impresion:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [storeId]);

  // Dividir los articulos exactamente en 2 paginas
  const midpoint = Math.ceil(items.length / 2);
  const page1Items = items.slice(0, midpoint);
  const page2Items = items.slice(midpoint);

  // Fecha de conteo en formato USA estandar (MM/DD/YYYY) en zona horaria America/Los_Angeles
  const laIsoDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const todayUsFormatted = `${formatUsDate(laIsoDate)} (${formatUsFullDate(laIsoDate, 'en-US')})`;

  return (
    <>
      <style>{`
        /* =========================================================
           REGLAS DE IMPRESION CARTA (LETTER PORTRAIT)
           ========================================================= */
        @page {
          size: letter portrait;
          margin: 6mm 7mm;
        }

        @media print {
          html, body {
            background: #ffffff !important;
            margin: 0 !important;
            padding: 0 !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .no-print {
            display: none !important;
          }

          .print-workspace {
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
          }

          .sheet-page {
            width: 100% !important;
            height: 100% !important;
            max-height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            overflow: hidden !important;
          }

          .sheet-page:last-child {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }

          .screen-page-divider {
            display: none !important;
          }
        }

        /* =========================================================
           VISTA PREVIA EN PANTALLA (SCREEN PREVIEW)
           ========================================================= */
        @media screen {
          body {
            background: #0f172a;
            margin: 0;
            padding: 0;
            color: #1e293b;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          }

          .print-workspace {
            padding: 68px 16px 40px 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
          }

          .sheet-page {
            width: 8.5in;
            height: 11in;
            max-height: 11in;
            background: #ffffff;
            margin: 0 auto;
            padding: 6mm 7mm;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
            border-radius: 4px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
            overflow: hidden;
          }

          .screen-page-divider {
            width: 8.5in;
            margin: 20px auto;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            color: #94a3b8;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
          }

          .screen-page-divider::before,
          .screen-page-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: #334155;
          }
        }

        /* =========================================================
           ESTILOS COMUNES DE MAQUETACION
           ========================================================= */
        .sheet-content-top {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .header-box {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 3px;
          margin-bottom: 4px;
        }

        .header-title-main {
          font-size: 13.5px;
          font-weight: 900;
          letter-spacing: -0.2px;
          text-transform: uppercase;
          color: #0f172a;
          line-height: 1.15;
        }

        .header-subtitle {
          font-size: 8.5px;
          font-weight: 700;
          color: #475569;
          margin-top: 1px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .header-meta {
          text-align: right;
          font-size: 8px;
          color: #334155;
          line-height: 1.25;
        }

        .header-meta strong {
          color: #0f172a;
        }

        .excel-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 8.5px;
        }

        .excel-table th, .excel-table td {
          border: 1px solid #334155;
          padding: 0 2px;
          vertical-align: middle;
          height: 19.5px;
          box-sizing: border-box;
        }

        .th-main {
          background-color: #0f172a !important;
          color: #ffffff !important;
          font-weight: 800;
          text-align: center;
          font-size: 8px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          height: 18px;
        }

        .th-num { width: 3.2%; }
        .th-img { width: 3.2%; }
        .th-sku { width: 10.5%; }
        .th-desc { width: 51.1%; }
        .th-par { width: 8%; background-color: #fef08a !important; color: #000000 !important; }
        .th-sobra { width: 12%; background-color: #e2e8f0 !important; color: #000000 !important; }
        .th-order { width: 12%; background-color: #bbf7d0 !important; color: #000000 !important; }

        .td-num {
          text-align: center;
          font-weight: 700;
          font-size: 8px;
          color: #475569;
        }

        .td-img {
          text-align: center;
          padding: 0 !important;
        }

        .product-thumb {
          width: 15px;
          height: 15px;
          object-fit: contain;
          border-radius: 2px;
          display: block;
          margin: 0 auto;
          background: #ffffff;
        }

        .td-sku {
          font-weight: 800;
          font-size: 8.5px;
          text-align: center;
          color: #0f172a;
          letter-spacing: -0.2px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }

        .td-desc {
          text-align: left;
          font-weight: 700;
          font-size: 8.8px;
          padding-left: 4px !important;
          padding-right: 2px !important;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.1;
          color: #000000;
        }

        .desc-uom {
          display: inline-block;
          margin-left: 4px;
          font-size: 7.5px;
          font-weight: 800;
          color: #475569;
          text-transform: uppercase;
        }

        .td-par {
          text-align: center;
          font-weight: 900;
          font-size: 9.5px;
          background-color: #fef9c3 !important;
          color: #000000;
        }

        .td-sobra {
          text-align: center;
          background-color: #ffffff !important;
        }

        .td-order {
          text-align: center;
          background-color: #f0fdf4 !important;
        }

        .sobra-box {
          display: inline-block;
          width: 100%;
          height: 15px;
        }

        .sheet-footer {
          margin-top: 3px;
          border-top: 1px solid #cbd5e1;
          padding-top: 2px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 7.5px;
          color: #64748b;
          font-weight: 600;
        }

        .sheet-footer strong {
          color: #0f172a;
        }
      `}</style>

      {/* Barra de herramientas fija superior (solo en pantalla) */}
      <div className="no-print" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#1e293b', color: '#f8fafc', padding: '10px 24px',
        display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)', borderBottom: '1px solid #334155'
      }}>
        <button
          onClick={() => router.push(`/admin/compras/viele?storeId=${storeId}`)}
          style={{
            background: '#334155', color: '#f8fafc', border: '1px solid #475569',
            padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
            fontWeight: '700', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6
          }}>
          Volver al Pedido
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: '700', color: '#94a3b8' }}>Sucursal:</span>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            style={{
              background: '#0f172a', color: '#f8fafc', border: '1px solid #475569',
              padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: '700', cursor: 'pointer'
            }}>
            {Object.values(VIELE_PUBLIC_STORES).map(acc => (
              <option key={acc.storeId} value={acc.storeId}>
                {acc.storeName} (#{acc.storeId})
              </option>
            ))}
          </select>
        </div>

        <span style={{ fontSize: 13, fontWeight: '800', color: '#f8fafc', letterSpacing: '0.3px' }}>
          Hoja de Conteo Fisico — Viele & Sons (Formato Carta Oficial)
        </span>

        <span style={{ flex: 1 }} />

        <button
          onClick={() => window.print()}
          style={{
            background: '#059669', color: '#ffffff', border: 'none',
            padding: '9px 22px', borderRadius: 8, cursor: 'pointer',
            fontWeight: '900', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 2px 10px rgba(5,150,105,0.4)'
          }}>
          Imprimir Hoja (2 Paginas Carta)
        </button>
      </div>

      {/* Espacio de trabajo de impresion */}
      <div className="print-workspace">
        {loading ? (
          <div style={{ padding: '80px 0', textAlign: 'center', color: '#94a3b8' }}>
            <p style={{ fontSize: 15, fontWeight: '700' }}>Cargando catalogo e inventario de Viele & Sons...</p>
          </div>
        ) : (
          <>
            {/* =========================================================
                HOJA 1 DE 2 (PAGINA 1)
                ========================================================= */}
            <div className="sheet-page">
              <div className="sheet-content-top">
                <div className="header-box">
                  <div>
                    <div className="header-title-main">
                      TACOS GAVILAN — {storeName}
                    </div>
                    <div className="header-subtitle">
                      HOJA DE CONTEO FISICO Y PEDIDO SEMANAL — PROVEEDOR: VIELE & SONS
                    </div>
                  </div>
                  <div className="header-meta">
                    <div>Date (Fecha): <strong>{todayUsFormatted}</strong></div>
                    <div>Delivery (Entrega): <strong>Tuesday (Martes)</strong></div>
                    <div>Formula: <strong>ORDER = MAX(0, PAR − LEFTOVER)</strong></div>
                  </div>
                </div>

                <table className="excel-table">
                  <thead>
                    <tr>
                      <th className="th-main th-num">#</th>
                      <th className="th-main th-img">IMG</th>
                      <th className="th-main th-sku">SKU</th>
                      <th className="th-main th-desc">DESCRIPCION DEL PRODUCTO</th>
                      <th className="th-main th-par">PAR</th>
                      <th className="th-main th-sobra">SOBRANTE</th>
                      <th className="th-main th-order">PEDIDO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page1Items.map((item, idx) => {
                      const parVal = pars[item.item_code] ?? 0;
                      return (
                        <tr key={item.item_code}>
                          <td className="td-num">{idx + 1}</td>
                          <td className="td-img">
                            <img
                              src={item.image_file}
                              alt={item.item_code}
                              className="product-thumb"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/images/viele/placeholder.png';
                              }}
                            />
                          </td>
                          <td className="td-sku">{item.item_code}</td>
                          <td className="td-desc">
                            {item.description}
                            <span className="desc-uom">({item.uom})</span>
                          </td>
                          <td className="td-par">{parVal > 0 ? parVal : '-'}</td>
                          <td className="td-sobra"><div className="sobra-box"></div></td>
                          <td className="td-order"><div className="sobra-box"></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sheet-footer">
                <div>Tacos Gavilan — Documento Operativo de Almacen</div>
                <div><strong>Pagina 1 de 2</strong> ({page1Items.length} articulos)</div>
                <div>Soporte: Carlos Velazquez (424-319-5019)</div>
              </div>
            </div>

            {/* Separador visual para modo pantalla */}
            <div className="screen-page-divider">
              Salto de Pagina — Hoja 2 de 2 Tamano Carta
            </div>

            {/* =========================================================
                HOJA 2 DE 2 (PAGINA 2)
                ========================================================= */}
            <div className="sheet-page">
              <div className="sheet-content-top">
                <div className="header-box">
                  <div>
                    <div className="header-title-main">
                      TACOS GAVILAN — {storeName}
                    </div>
                    <div className="header-subtitle">
                      HOJA DE CONTEO FISICO — PROVEEDOR: VIELE & SONS (PAGINA 2)
                    </div>
                  </div>
                  <div className="header-meta">
                    <div>Date (Fecha): <strong>{todayUsFormatted}</strong></div>
                    <div>Delivery (Entrega): <strong>Tuesday (Martes)</strong></div>
                    <div>Formula: <strong>ORDER = MAX(0, PAR − LEFTOVER)</strong></div>
                  </div>
                </div>

                <table className="excel-table">
                  <thead>
                    <tr>
                      <th className="th-main th-num">#</th>
                      <th className="th-main th-img">IMG</th>
                      <th className="th-main th-sku">SKU</th>
                      <th className="th-main th-desc">DESCRIPCION DEL PRODUCTO</th>
                      <th className="th-main th-par">PAR</th>
                      <th className="th-main th-sobra">SOBRANTE</th>
                      <th className="th-main th-order">PEDIDO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page2Items.map((item, idx) => {
                      const parVal = pars[item.item_code] ?? 0;
                      return (
                        <tr key={item.item_code}>
                          <td className="td-num">{midpoint + idx + 1}</td>
                          <td className="td-img">
                            <img
                              src={item.image_file}
                              alt={item.item_code}
                              className="product-thumb"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/images/viele/placeholder.png';
                              }}
                            />
                          </td>
                          <td className="td-sku">{item.item_code}</td>
                          <td className="td-desc">
                            {item.description}
                            <span className="desc-uom">({item.uom})</span>
                          </td>
                          <td className="td-par">{parVal > 0 ? parVal : '-'}</td>
                          <td className="td-sobra"><div className="sobra-box"></div></td>
                          <td className="td-order"><div className="sobra-box"></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sheet-footer">
                <div>Tacos Gavilan — Documento Operativo de Almacen</div>
                <div><strong>Pagina 2 de 2</strong> ({page2Items.length} articulos)</div>
                <div>Soporte: Carlos Velazquez (424-319-5019)</div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function VielePrintSheetPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager', 'asistente']}>
      <Suspense fallback={
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#ffffff', fontFamily: 'sans-serif', background: '#0f172a' }}>
          Generando formato de impresion...
        </div>
      }>
        <PrintSheetContent />
      </Suspense>
    </ProtectedRoute>
  );
}
