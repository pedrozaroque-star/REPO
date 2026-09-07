/**
 * @module admin/compras/viele/print-sheet
 * @description Hoja imprimible de conteo físico y pedido semanal para insumos de Viele & Sons.
 *              Replica fielmente el formato en doble columna (Twin-Column) del Excel Viele & Sons.xlsx,
 *              incorporando miniaturas fotográficas reales de 36x36px, niveles de PAR dinámicos por tienda,
 *              y casillas en blanco para conteo a lápiz (SOBRANTE) y cálculo (PEDIDO).
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Orientación: Vertical (Portrait) con márgenes de 0.15in para optimizar el área imprimible.
 * - Formato 2 Columnas Paralelas: Permite que los 89 artículos se impriman exactamente en 2 hojas verticales.
 * - Cada tienda carga sus propios PARs históricos extraídos de Viele & Sons.xlsx.
 * - FÓRMULA DE PEDIDO: PEDIDO = MAX(0, PAR - SOBRANTE).
 *
 * @dataFlow
 * - /api/viele/catalog → lista de los 89 artículos ordenados por sort_order.
 * - /api/viele/pars?storeId=X → niveles de PAR específicos de la sucursal seleccionada.
 * - stores table → nombre oficial y código de la tienda.
 */

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { VIELE_STORE_ACCOUNTS } from '@/lib/viele-api';

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

  // Cargar catálogo e información de la tienda
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        // 1. Cargar catálogo
        const catRes = await fetch('/api/viele/catalog');
        const catJson = await catRes.json();
        if (catJson.success && catJson.data) {
          setItems(catJson.data);
        }

        // 2. Cargar PARs de la tienda
        const parRes = await fetch(`/api/viele/pars?storeId=${storeId}`);
        const parJson = await parRes.json();
        if (parJson.success && parJson.pars) {
          setPars(parJson.pars);
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

  // Dividir los artículos en 2 columnas equilibradas (Izquierda y Derecha)
  const midpoint = Math.ceil(items.length / 2);
  const leftColumnItems = items.slice(0, midpoint);
  const rightColumnItems = items.slice(midpoint);

  // Fecha formateada
  const todayFormatted = new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: portrait;
            margin: 0.15in;
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
        }

        @media screen {
          body {
            background: #0f172a;
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
          margin-bottom: 6px;
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

        .twin-table-layout {
          display: flex;
          gap: 6px;
          width: 100%;
        }

        .table-half {
          flex: 1;
          width: 50%;
        }

        .excel-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 7.5px;
        }

        .excel-table th, .excel-table td {
          border: 1px solid #1e293b;
          padding: 1.5px 2px;
          vertical-align: middle;
          height: 20px;
        }

        .th-main {
          background-color: #0f172a !important;
          color: #ffffff !important;
          font-weight: 800;
          text-align: center;
          font-size: 7.5px;
          text-transform: uppercase;
          height: 16px;
        }

        .th-num { width: 4.5%; }
        .th-img { width: 9.5%; }
        .th-sku { width: 14%; }
        .th-desc { width: 44%; }
        .th-par { width: 9%; background-color: #fef08a !important; color: #000 !important; }
        .th-sobra { width: 9.5%; background-color: #e2e8f0 !important; color: #000 !important; }
        .th-order { width: 9.5%; background-color: #bbf7d0 !important; color: #000 !important; }

        .td-num {
          text-align: center;
          font-weight: 700;
          font-size: 7px;
          color: #64748b;
        }

        .td-img {
          text-align: center;
          padding: 1px !important;
        }

        .product-thumb {
          width: 22px;
          height: 22px;
          object-fit: contain;
          border-radius: 2px;
          display: block;
          margin: 0 auto;
          background: #fff;
        }

        .td-sku {
          font-weight: 800;
          font-size: 7px;
          text-align: center;
          color: #000;
          letter-spacing: -0.2px;
        }

        .td-desc {
          text-align: left;
          font-weight: 600;
          font-size: 7px;
          padding-left: 3px !important;
          white-space: normal;
          line-height: 1.05;
          color: #0f172a;
        }

        .td-par {
          text-align: center;
          font-weight: 900;
          font-size: 8.5px;
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
          height: 16px;
        }
      `}</style>

      {/* Barra de herramientas para pantalla */}
      <div className="no-print" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: '#ffffff', color: '#0f172a', padding: '10px 24px',
        display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.06)', borderBottom: '1px solid #e2e8f0'
      }}>
        <button
          onClick={() => router.push('/admin/compras/viele')}
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
                <div>Fecha Conteo: <strong>{todayFormatted}</strong></div>
                <div>Entrega Habitual: <strong>Martes</strong> (Modificable por emergencia)</div>
                <div>Comprador Oficial: <strong>AFV</strong></div>
                <div>Fórmula: <strong>PEDIDO = PAR − SOBRANTE</strong></div>
                <div>Total Artículos: <strong>{items.length} SKUs</strong></div>
              </div>
            </div>

            {/* Cuadrícula de 2 Columnas Paralelas */}
            <div className="twin-table-layout">
              {/* Columna Izquierda (Items 1 a 45) */}
              <div className="table-half">
                <table className="excel-table">
                  <thead>
                    <tr>
                      <th className="th-main th-num">#</th>
                      <th className="th-main th-img">FOTO</th>
                      <th className="th-main th-sku">SKU</th>
                      <th className="th-main th-desc">DESCRIPCIÓN</th>
                      <th className="th-main th-par">PAR</th>
                      <th className="th-main th-sobra">SOBRA</th>
                      <th className="th-main th-order">ORDEN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leftColumnItems.map((item, idx) => {
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
              </div>

              {/* Columna Derecha (Items 46 a 89) */}
              <div className="table-half">
                <table className="excel-table">
                  <thead>
                    <tr>
                      <th className="th-main th-num">#</th>
                      <th className="th-main th-img">FOTO</th>
                      <th className="th-main th-sku">SKU</th>
                      <th className="th-main th-desc">DESCRIPCIÓN</th>
                      <th className="th-main th-par">PAR</th>
                      <th className="th-main th-sobra">SOBRA</th>
                      <th className="th-main th-order">ORDEN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rightColumnItems.map((item, idx) => {
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
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fff', fontFamily: 'sans-serif' }}>
        Generando formato de impresión...
      </div>
    }>
      <PrintSheetContent />
    </Suspense>
  );
}
