/**
 * @module admin/compras/viele/print-sheet
 * @description Hoja imprimible de conteo físico y pedido semanal para insumos de Viele & Sons.
 *              Formato de 2 páginas: una tabla de columna completa por hoja, con imágenes grandes (36px)
 *              para identificación rápida del producto durante el conteo físico en bodega.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Orientación: Vertical (Portrait), 2 hojas separadas con page-break automático.
 * - Solo muestra productos que la tienda maneja (filtrados por viele_store_pars).
 * - Cada tienda carga sus propios PARs históricos extraídos de Viele & Sons.
 * - FÓRMULA DE PEDIDO: PEDIDO = MAX(0, PAR - SOBRANTE).
 *
 * @dataFlow
 * - /api/viele/catalog → lista de artículos ordenados por sort_order.
 * - /api/viele/pars?storeId=X → niveles de PAR específicos de la sucursal (también filtra el catálogo).
 */

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { VIELE_STORE_ACCOUNTS, formatUsDate, formatUsFullDate } from '@/lib/viele-api';

interface CatalogItem {
  item_code: string;
  description: string;
  uom: string;
  unit_price: number;
  category: string;
  image_file: string;
  sort_order: number;
}

function PrintSheetContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStoreId = searchParams.get('storeId') || '14'; // Default Lynwood #14

  const [storeId, setStoreId] = useState<string>(initialStoreId);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [pars, setPars] = useState<Record<string, number>>({});
  const [storeName, setStoreName] = useState<string>('Lynwood #14');
  const [loading, setLoading] = useState<boolean>(true);

  // Cargar catálogo e información de la tienda (con orden personalizado si existe)
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const catRes = await fetch(`/api/viele/catalog?storeId=${storeId}`);
        const catJson = await catRes.json();

        // 2. Cargar PARs de la tienda
        const parRes = await fetch(`/api/viele/pars?storeId=${storeId}`);
        const parJson = await parRes.json();
        const storePars = parJson.success ? parJson.pars || {} : {};
        setPars(storePars);

        // Filtrar: Solo mostrar productos que la tienda maneja (tienen PAR configurado)
        if (catJson.success && catJson.data) {
          const storeItems = catJson.data.filter(
            (item: CatalogItem) => item.item_code in storePars
          );
          setItems(storeItems);
        }

        // 3. Nombre de la tienda
        const account = VIELE_STORE_ACCOUNTS[parseInt(storeId)];
        if (account) {
          setStoreName(`${account.storeName} #${account.storeId}`);
        } else {
          setStoreName(`Tienda #${storeId}`);
        }
      } catch (err) {
        console.error('Error cargando datos de impresión:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [storeId]);

  // Dividir los artículos en 2 páginas equilibradas
  const midpoint = Math.ceil(items.length / 2);
  const page1Items = items.slice(0, midpoint);
  const page2Items = items.slice(midpoint);

  // Fecha de conteo en formato USA estándar (MM/DD/YYYY) y nombre completo en inglés
  const todayUsFormatted = `${formatUsDate(new Date().toISOString())} (${formatUsFullDate(new Date().toISOString(), 'en-US')})`;

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 0.2in 0.15in;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            margin: 0;
            padding: 0;
            background: white !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          }
          .no-print {
            display: none !important;
          }
          .print-container {
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            max-width: 100% !important;
            width: 100% !important;
          }
          .page-break {
            page-break-before: always;
          }
          tr {
            page-break-inside: avoid;
          }
          table {
            page-break-inside: auto;
          }
        }

        @media screen {
          body {
            background: #f1f5f9;
            margin: 0;
            padding-bottom: 40px;
          }
          .print-container {
            max-width: 8.5in;
            margin: 70px auto 20px auto;
            background: white;
            padding: 16px 20px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            border-radius: 8px;
            color: #000;
          }
        }

        .print-container {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          color: #000;
        }

        .header-box {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          border-bottom: 2px solid #000;
          padding-bottom: 4px;
          margin-bottom: 4px;
        }

        .header-title-main {
          font-size: 14px;
          font-weight: 900;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: #000;
        }

        .header-subtitle {
          font-size: 9px;
          font-weight: 700;
          color: #475569;
          margin-top: 1px;
        }

        .header-meta {
          text-align: right;
          font-size: 8.5px;
          color: #334155;
          line-height: 1.2;
        }

        .excel-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 9px;
        }

        .excel-table th, .excel-table td {
          border: 1px solid #1e293b;
          padding: 2px 3px;
          vertical-align: middle;
          height: 32px;
        }

        .th-main {
          background-color: #0f172a !important;
          color: #ffffff !important;
          font-weight: 800;
          text-align: center;
          font-size: 8.5px;
          text-transform: uppercase;
          height: 20px;
        }

        .th-num { width: 4%; }
        .th-img { width: 7%; }
        .th-sku { width: 12%; }
        .th-desc { width: 46%; }
        .th-par { width: 8%; background-color: #fef08a !important; color: #000 !important; }
        .th-sobra { width: 11.5%; background-color: #e2e8f0 !important; color: #000 !important; }
        .th-order { width: 11.5%; background-color: #bbf7d0 !important; color: #000 !important; }

        .td-num {
          text-align: center;
          font-weight: 700;
          font-size: 8px;
          color: #64748b;
        }

        .td-img {
          text-align: center;
          padding: 1px !important;
        }

        .product-thumb {
          width: 36px;
          height: 36px;
          object-fit: contain;
          border-radius: 3px;
          display: block;
          margin: 0 auto;
          background: #fff;
        }

        .td-sku {
          font-weight: 800;
          font-size: 8.5px;
          text-align: center;
          color: #000;
          letter-spacing: -0.2px;
        }

        .td-desc {
          text-align: left;
          font-weight: 600;
          font-size: 8.5px;
          padding-left: 4px !important;
          white-space: normal;
          line-height: 1.15;
          color: #0f172a;
        }

        .td-par {
          text-align: center;
          font-weight: 900;
          font-size: 10px;
          background-color: #fef9c3 !important;
          color: #000;
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
          height: 22px;
        }

        .page-label {
          text-align: right;
          font-size: 8px;
          color: #94a3b8;
          font-weight: 700;
          margin-top: 2px;
        }
      `}</style>

      {/* Barra de herramientas para pantalla */}
      <div className="no-print" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#ffffff', color: '#0f172a', padding: '10px 24px',
        display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0'
      }}>
        <button
          onClick={() => router.push(`/admin/compras/viele?storeId=${storeId}`)}
          style={{
            background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1',
            padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
            fontWeight: 'bold', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6
          }}>
          ← Volver al Módulo
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 'bold', color: '#64748b' }}>Sucursal:</span>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            style={{
              background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1',
              padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', cursor: 'pointer'
            }}>
            {Object.values(VIELE_STORE_ACCOUNTS).map(acc => (
              <option key={acc.storeId} value={acc.storeId}>
                {acc.storeName} (#{acc.storeId})
              </option>
            ))}
          </select>
        </div>

        <span style={{ fontSize: 14, fontWeight: '900', color: '#0f172a' }}>
          🖨️ Formato de Conteo Físico Viele & Sons (Doble Columna)
        </span>

        <span style={{ flex: 1 }} />

        <button
          onClick={() => window.print()}
          style={{
            background: '#059669', color: 'white', border: 'none',
            padding: '8px 22px', borderRadius: 8, cursor: 'pointer',
            fontWeight: '900', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 2px 8px rgba(5,150,105,0.3)'
          }}>
          🖨️ Imprimir Hoja
        </button>
      </div>

      {/* Contenedor Imprimible */}
      <div className="print-container">
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b' }}>
            <p style={{ fontSize: 16, fontWeight: 'bold' }}>Cargando catálogo e inventario de Viele & Sons...</p>
          </div>
        ) : (
          <>
            {/* Encabezado Corporativo */}
            <div className="header-box">
              <div>
                <div className="header-title-main">
                  🌮 TACOS GAVILAN — {storeName}
                </div>
                <div className="header-subtitle">
                  HOJA DE CONTEO FÍSICO Y PEDIDO SEMANAL — PROVEEDOR: VIELE & SONS
                </div>
              </div>
              <div className="header-meta">
                <div>Date (Fecha Conteo): <strong>{todayUsFormatted}</strong></div>
                <div>Delivery (Entrega): <strong>Tuesday (Martes)</strong></div>
                <div>Formula: <strong>ORDER = PAR − LEFTOVER</strong></div>
                <div>Total Items (Artículos): <strong>{items.length} SKUs</strong></div>
              </div>
            </div>

            {/* ═══════ PÁGINA 1 ═══════ */}
            <table className="excel-table">
              <thead>
                <tr>
                  <th className="th-main th-num">#</th>
                  <th className="th-main th-img">FOTO</th>
                  <th className="th-main th-sku">SKU</th>
                  <th className="th-main th-desc">DESCRIPCIÓN</th>
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
                      <td className="td-desc">{item.description}</td>
                      <td className="td-par">{parVal > 0 ? parVal : '-'}</td>
                      <td className="td-sobra"><div className="sobra-box"></div></td>
                      <td className="td-order"><div className="sobra-box"></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="page-label">Página 1 de 2 — {page1Items.length} artículos</div>

            {/* ═══════ PÁGINA 2 (Page Break) ═══════ */}
            <div className="page-break">
              <div className="header-box">
                <div>
                  <div className="header-title-main">
                    🌮 TACOS GAVILAN — {storeName}
                  </div>
                  <div className="header-subtitle">
                    HOJA DE CONTEO — PÁGINA 2 DE 2
                  </div>
                </div>
                <div className="header-meta">
                  <div>Date (Fecha): <strong>{todayUsFormatted}</strong></div>
                  <div>Formula: <strong>ORDER = PAR − LEFTOVER</strong></div>
                </div>
              </div>

              <table className="excel-table">
                <thead>
                  <tr>
                    <th className="th-main th-num">#</th>
                    <th className="th-main th-img">FOTO</th>
                    <th className="th-main th-sku">SKU</th>
                    <th className="th-main th-desc">DESCRIPCIÓN</th>
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
                        <td className="td-desc">{item.description}</td>
                        <td className="td-par">{parVal > 0 ? parVal : '-'}</td>
                        <td className="td-sobra"><div className="sobra-box"></div></td>
                        <td className="td-order"><div className="sobra-box"></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="page-label">Página 2 de 2 — {page2Items.length} artículos</div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function VielePrintSheetPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fff', fontFamily: 'sans-serif' }}>
        Generando formato de impresión...
      </div>
    }>
      <PrintSheetContent />
    </Suspense>
  );
}
