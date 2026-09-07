/**
 * @module admin/compras/viele
 * @description Módulo interactivo de Compras e Inventario Viele & Sons para Tacos Gavilan.
 *              Permite capturar conteo físico de sobrantes, calcula automáticamente el pedido sugerido
 *              (ORDER = MAX(0, PAR - SOBRANTE)), permite ajustes manuales, y ejecuta el checkout directo
 *              en el portal de Viele & Sons bajo crédito comercial Net 30 con emisión de orden oficial Sage 100.
 *              Incorpora reordenamiento Drag & Drop por sucursal persistente en Supabase y visualización de
 *              fechas en formato estándar de EE.UU. (MM/DD/YYYY).
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Multi-tienda: Las 15 sucursales operan con su propia cuenta oficial en Viele & Sons.
 * - Secuencia por defecto: Secuencia oficial del Order Guide de Viele & Sons (jarabes de soda BIB primero).
 * - Personalización por sucursal: Cada gerente puede arrastrar y soltar (Drag & Drop) los insumos con el mouse
 *   para alinearlos con la distribución física de su almacén / bodega.
 * - FÓRMULA DE PEDIDO: SUGERIDO = MAX(0, PAR - SOBRANTE).
 * - Formato de fechas: Estándar estadounidense MM/DD/YYYY y US full date strings.
 * - Se permite sobreescribir el pedido final si se requieren cajas adicionales para eventos o contingencias.
 * - Soporte Bilingüe: Integrado con useLanguage() de lib/i18n.tsx.
 * - Prevención de órdenes accidentales: Modal de confirmación explícito antes del envío en vivo.
 * - Días de entrega: Siempre los días martes (getNextTuesday), editable para contingencias o cierres.
 * - Comprador oficial: "AFV" (Arturo Flores Velazquez), registrado en el 90% del historial de Viele & Sons.
 * - Paleta visual: Tema claro (Light Mode) del sistema con fondos slate-50/50, tarjetas blancas, acentos ámbar/esmeralda.
 *
 * @dataFlow
 * - GET /api/viele/catalog?storeId=X → Catálogo maestro de 89 insumos ordenados según la tienda.
 * - GET /api/viele/custom-order?storeId=X → Detecta si la sucursal tiene orden personalizado.
 * - PUT /api/viele/custom-order → Persiste el nuevo orden tras soltar (drop) una fila.
 * - DELETE /api/viele/custom-order?storeId=X → Restablece al orden oficial del Order Guide.
 * - GET /api/viele/pars?storeId=X → PARs base de inventario para la sucursal seleccionada.
 * - POST /api/viele/orders → Envío de orden (borrador local o live checkout contra Viele API).
 *
 * @notes
 * - [2026-09-07] Implementación de Drag & Drop por sucursal y formato de fechas USA (MM/DD/YYYY).
 * - [2026-09-07] Refactorización total de interfaz visual para respetar la paleta oficial clara de SM TEG.
 */

'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { VIELE_STORE_ACCOUNTS, formatUsDate, formatUsFullDate } from '@/lib/viele-api';
import { isVieleSoda } from '@/lib/viele-catalog-data';
import { 
  Printer, 
  Save, 
  Send, 
  Search, 
  History, 
  Package, 
  CheckCircle, 
  AlertTriangle, 
  X, 
  Plus, 
  Minus,
  Truck,
  GripVertical,
  RotateCcw,
  Check
} from 'lucide-react';

interface CatalogItem {
  item_code: string;
  description: string;
  uom: string;
  unit_price: number;
  category: string;
  image_file: string;
  sort_order: number;
  is_soda?: boolean;
  is_chemical?: boolean;
  previous_price?: number | null;
  price_change_percent?: number | null;
  price_changed_at?: string | null;
  price_status?: 'increased' | 'decreased' | 'unchanged' | 'new' | null;
  last_scanned_at?: string | null;
}

interface OrderRow {
  item: CatalogItem;
  par: number;
  leftover: string; // string para permitir borrado limpio en input
  suggested: number;
  finalOrder: number;
}

// Calcula el próximo martes habitual de entrega de Viele & Sons
function getNextTuesday(from = new Date()): string {
  const d = new Date(from);
  // Zona horaria de California
  const laStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const [y, m, day] = laStr.split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  const dayOfWeek = cur.getUTCDay(); // 0 = Dom, 1 = Lun, 2 = Mar, 3 = Mie, 4 = Jue, 5 = Vie, 6 = Sab
  
  // Días de entrega siempre serán los días martes (2)
  let daysToAdd = (2 - dayOfWeek + 7) % 7;
  if (daysToAdd === 0) {
    daysToAdd = 7; // Si hoy ya es martes, programar para el próximo ciclo
  }
  cur.setUTCDate(cur.getUTCDate() + daysToAdd);
  return cur.toISOString().split('T')[0];
}

function getDayOfWeekName(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const name = dt.toLocaleDateString('es-MX', { weekday: 'long', timeZone: 'UTC' });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function isTuesday(dateStr: string): boolean {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.getUTCDay() === 2;
}

function VieleOrderContent() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStoreId = searchParams.get('storeId') || '14'; // Default Lynwood #14

  const [storeId, setStoreId] = useState<string>(initialStoreId);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [pars, setPars] = useState<Record<string, number>>({});
  const [orderRows, setOrderRows] = useState<Record<string, OrderRow>>({});
  
  // Filtros de búsqueda
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fecha de entrega: Siempre los días martes (con opción de modificar por emergencias o cierres)
  const [shipDate, setShipDate] = useState<string>(() => getNextTuesday());

  // Modal de confirmación de checkout: Comprador oficial registrado en Viele & Sons ("AFV")
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [buyerName, setBuyerName] = useState('AFV');
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');
  
  // Drag & Drop y orden personalizado por sucursal
  const [hasCustomOrder, setHasCustomOrder] = useState<boolean>(false);
  const [isSavingCustomOrder, setIsSavingCustomOrder] = useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [customOrderToast, setCustomOrderToast] = useState<string | null>(null);

  // Estados de proceso
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Cargar Catálogo Maestro (con orden específico de tienda), PARs y estado de orden personalizado
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setErrorMessage(null);
      try {
        const [catRes, parRes, customOrderRes] = await Promise.all([
          fetch(`/api/viele/catalog?storeId=${storeId}`),
          fetch(`/api/viele/pars?storeId=${storeId}`),
          fetch(`/api/viele/custom-order?storeId=${storeId}`)
        ]);

        const catJson = await catRes.json();
        const parJson = await parRes.json();
        const customOrderJson = await customOrderRes.json();

        if (customOrderJson.success) {
          setHasCustomOrder(Boolean(customOrderJson.hasCustomOrder));
        }

        if (catJson.success && catJson.data) {
          setCatalog(catJson.data);

          const storePars = parJson.success ? parJson.pars || {} : {};
          setPars(storePars);

          // Inicializar estado de filas
          const rows: Record<string, OrderRow> = {};
          catJson.data.forEach((item: CatalogItem) => {
            const par = storePars[item.item_code] ?? 0;
            rows[item.item_code] = {
              item,
              par,
              leftover: '',
              suggested: par, // Si sobrante no se ha contado, sugerido es el PAR
              finalOrder: par
            };
          });
          setOrderRows(rows);
        }
      } catch (err: any) {
        setErrorMessage(err.message || 'Error cargando datos de Viele & Sons');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [storeId]);

  // Drag & Drop: Inicio de arrastre con el mouse
  const handleDragStart = (e: React.DragEvent<HTMLTableRowElement>, index: number) => {
    if (searchQuery) return; // Deshabilitar arrastre mientras se filtra con buscador
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  // Drag & Drop: Posicionamiento sobre otra fila
  const handleDragOver = (e: React.DragEvent<HTMLTableRowElement>, index: number) => {
    if (searchQuery) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Drag & Drop: Soltar fila y persistir orden para esta sucursal
  const handleDrop = async (e: React.DragEvent<HTMLTableRowElement>, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex || searchQuery) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const reordered = [...catalog];
    const [movedItem] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);

    const updatedCatalog = reordered.map((item, idx) => ({
      ...item,
      sort_order: idx + 1
    }));

    setCatalog(updatedCatalog);
    setDraggedIndex(null);
    setDragOverIndex(null);
    setHasCustomOrder(true);

    setIsSavingCustomOrder(true);
    try {
      const orderPayload = updatedCatalog.map((item, idx) => ({
        itemCode: item.item_code,
        sortOrder: idx + 1
      }));

      const saveRes = await fetch('/api/viele/custom-order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: parseInt(storeId),
          itemCodes: updatedCatalog.map(item => item.item_code),
          order: orderPayload
        })
      });
      const saveJson = await saveRes.json();
      if (saveJson.success) {
        setCustomOrderToast(t('viele.custom_order_toast'));
        setTimeout(() => setCustomOrderToast(null), 3500);
      }
    } catch (err) {
      console.error('Error guardando orden personalizado:', err);
    } finally {
      setIsSavingCustomOrder(false);
    }
  };

  // Restablecer al orden oficial del Order Guide de Viele & Sons
  const handleResetToOfficialOrder = async () => {
    if (!confirm('¿Deseas restablecer el orden de los productos al oficial de Viele & Sons?')) {
      return;
    }
    setIsSavingCustomOrder(true);
    try {
      const res = await fetch(`/api/viele/custom-order?storeId=${storeId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setHasCustomOrder(false);
        const catRes = await fetch(`/api/viele/catalog?storeId=${storeId}`);
        const catJson = await catRes.json();
        if (catJson.success && catJson.data) {
          setCatalog(catJson.data);
        }
        setCustomOrderToast(t('viele.official_order_active'));
        setTimeout(() => setCustomOrderToast(null), 3500);
      }
    } catch (err) {
      console.error('Error restableciendo orden:', err);
    } finally {
      setIsSavingCustomOrder(false);
    }
  };

  // Manejador de cambio en "Sobrante"
  const handleLeftoverChange = (code: string, val: string) => {
    setOrderRows(prev => {
      const current = prev[code];
      if (!current) return prev;

      if (val === '') {
        return {
          ...prev,
          [code]: {
            ...current,
            leftover: '',
            suggested: current.par,
            finalOrder: current.par
          }
        };
      }

      const numVal = Math.max(0, parseFloat(val) || 0);
      const suggested = Math.max(0, current.par - numVal);
      return {
        ...prev,
        [code]: {
          ...current,
          leftover: val,
          suggested,
          finalOrder: suggested
        }
      };
    });
  };

  // Manejador de cambio manual en "Pedido Final"
  const handleFinalOrderChange = (code: string, newQty: number) => {
    const validQty = Math.max(0, Math.round(newQty));
    setOrderRows(prev => {
      const current = prev[code];
      if (!current) return prev;
      return {
        ...prev,
        [code]: {
          ...current,
          finalOrder: validQty
        }
      };
    });
  };

  // Filtrado de filas visibles: Búsqueda rápida
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return catalog;
    return catalog.filter(item =>
      item.item_code.toLowerCase().includes(q) || 
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [catalog, searchQuery]);

  // Totales calculados en tiempo real con separación para las 2 facturas de Viele & Sons
  const summary = useMemo(() => {
    let orderedItemsCount = 0;
    let totalCases = 0;
    let subtotal = 0;

    let sodaItemsCount = 0;
    let sodaCases = 0;
    let sodaSubtotal = 0;

    let generalItemsCount = 0;
    let generalCases = 0;
    let generalSubtotal = 0;

    Object.values(orderRows).forEach(row => {
      if (row.finalOrder > 0) {
        orderedItemsCount++;
        totalCases += row.finalOrder;
        const ext = row.finalOrder * row.item.unit_price;
        subtotal += ext;

        const isSoda = row.item.is_soda || isVieleSoda(row.item.item_code);
        if (isSoda) {
          sodaItemsCount++;
          sodaCases += row.finalOrder;
          sodaSubtotal += ext;
        } else {
          generalItemsCount++;
          generalCases += row.finalOrder;
          generalSubtotal += ext;
        }
      }
    });

    const sodaTax = parseFloat((sodaSubtotal * 0.095).toFixed(2));
    const sodaGrandTotal = parseFloat((sodaSubtotal + sodaTax).toFixed(2));

    const generalTax = parseFloat((generalSubtotal * 0.095).toFixed(2));
    const generalGrandTotal = parseFloat((generalSubtotal + generalTax).toFixed(2));

    const estTax = parseFloat((subtotal * 0.095).toFixed(2));
    const grandTotal = parseFloat((subtotal + estTax).toFixed(2));

    return {
      orderedItemsCount,
      totalCases,
      subtotal: parseFloat(subtotal.toFixed(2)),
      estTax,
      grandTotal,
      isSplit: sodaCases > 0 && generalCases > 0,
      sodas: {
        itemsCount: sodaItemsCount,
        totalCases: sodaCases,
        subtotal: parseFloat(sodaSubtotal.toFixed(2)),
        estTax: sodaTax,
        grandTotal: sodaGrandTotal
      },
      general: {
        itemsCount: generalItemsCount,
        totalCases: generalCases,
        subtotal: parseFloat(generalSubtotal.toFixed(2)),
        estTax: generalTax,
        grandTotal: generalGrandTotal
      }
    };
  }, [orderRows]);

  // Guardar Borrador
  const handleSaveDraft = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const itemsToSubmit = Object.values(orderRows)
        .filter(r => r.finalOrder > 0)
        .map(r => ({
          itemCode: r.item.item_code,
          description: r.item.description,
          uom: r.item.uom,
          unitPrice: r.item.unit_price,
          parQuantity: r.par,
          leftoverQuantity: parseFloat(r.leftover) || 0,
          orderQuantity: r.finalOrder,
          isSoda: r.item.is_soda || isVieleSoda(r.item.item_code)
        }));

      const res = await fetch('/api/viele/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: parseInt(storeId),
          items: itemsToSubmit,
          shipDate,
          buyerName,
          customerPo: poNumber || `BORRADOR-${Date.now()}`,
          notes,
          submitLive: false,
          isSimulation: true
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      if (data.split) {
        alert(`✅ Borradores gemelos guardados en Supabase:\n• Sodas: ${data.orderNumberSodas}\n• Insumos: ${data.orderNumberGeneral}`);
      } else {
        alert(`✅ Borrador guardado exitosamente en Supabase (Orden: ${data.orderNumber})`);
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Enviar Pedido en Vivo a Viele & Sons
  const handleConfirmLiveSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const itemsToSubmit = Object.values(orderRows)
        .filter(r => r.finalOrder > 0)
        .map(r => ({
          itemCode: r.item.item_code,
          description: r.item.description,
          uom: r.item.uom,
          unitPrice: r.item.unit_price,
          parQuantity: r.par,
          leftoverQuantity: parseFloat(r.leftover) || 0,
          orderQuantity: r.finalOrder,
          isSoda: r.item.is_soda || isVieleSoda(r.item.item_code)
        }));

      const res = await fetch('/api/viele/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: parseInt(storeId),
          items: itemsToSubmit,
          shipDate,
          buyerName,
          customerPo: poNumber.trim() || buyerName.trim() || 'AFV',
          notes,
          submitLive: true
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setSubmitSuccess(data);
      setIsConfirmModalOpen(false);
    } catch (err: any) {
      setErrorMessage(err.message);
      setIsConfirmModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentStoreAccount = VIELE_STORE_ACCOUNTS[parseInt(storeId)];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:px-8 md:pt-8 pb-8">
      {/* Toast Flotante de Confirmación de Guardado de Orden de Sucursal */}
      {customOrderToast && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-xl font-bold text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-3 border border-emerald-500">
          <Check className="w-4 h-4 text-emerald-200" />
          <span>{customOrderToast}</span>
        </div>
      )}

      {/* Header Principal */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2.5 bg-amber-50 text-amber-600 rounded-xl border border-amber-200 shadow-sm">
                <Truck className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                  {t('viele.title')}
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold uppercase tracking-wide">
                    Sage 100 Net 30
                  </span>
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {t('viele.subtitle')}
                </p>
              </div>
            </div>
          </div>

          {/* Acciones Rápidas */}
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href={`/admin/compras/viele/print-sheet?storeId=${storeId}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-sm border border-slate-200 transition shadow-sm"
            >
              <Printer className="w-4 h-4 text-amber-600" />
              {t('viele.print_sheet')}
            </Link>

            <Link
              href="/admin/compras/viele/historial"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-sm border border-slate-200 transition shadow-sm"
            >
              <History className="w-4 h-4 text-blue-600" />
              {t('viele.history')}
            </Link>
          </div>
        </div>

        {/* Barra de Control: Selector de Tienda, Fecha y Búsqueda */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          {/* Selector de Tienda */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              {t('viele.store')}
            </label>
            <select
              value={storeId}
              onChange={(e) => {
                setStoreId(e.target.value);
                router.push(`/admin/compras/viele?storeId=${e.target.value}`);
              }}
              className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-sm"
            >
              {Object.values(VIELE_STORE_ACCOUNTS).map(acc => (
                <option key={acc.storeId} value={acc.storeId}>
                  🌮 {acc.storeName} (#{acc.storeId}) — Sage: {acc.sageCustomerCode}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Fecha de Entrega */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                {t('viele.delivery_date')}
              </label>
              {!isTuesday(shipDate) && (
                <button
                  type="button"
                  onClick={() => setShipDate(getNextTuesday())}
                  className="text-[11px] text-amber-600 hover:text-amber-800 font-bold underline cursor-pointer"
                  title="Restablecer al próximo ciclo habitual de martes"
                >
                  Restablecer a Martes
                </button>
              )}
            </div>
            <input
              type="date"
              value={shipDate}
              onChange={(e) => setShipDate(e.target.value)}
              className={`w-full bg-white border rounded-xl px-3.5 py-2 text-slate-900 font-bold text-sm focus:outline-none focus:ring-2 shadow-sm ${
                isTuesday(shipDate)
                  ? 'border-slate-300 focus:ring-emerald-500'
                  : 'border-amber-400 focus:ring-amber-500 bg-amber-50/20'
              }`}
            />
            <div className="mt-1 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-700">
                <span>🇺🇸 USA:</span>
                <span className="text-amber-800">{formatUsDate(shipDate)}</span>
                <span className="text-slate-400">•</span>
                <span className="text-slate-600 font-sans font-semibold text-[11px]">{formatUsFullDate(shipDate, 'en-US')}</span>
              </div>
              {isTuesday(shipDate) ? (
                <span className="text-[11px] text-emerald-700 flex items-center gap-1.5 font-semibold">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  Martes habitual (Entrega programada Viele & Sons)
                </span>
              ) : (
                <span className="text-[11px] text-amber-700 flex items-center gap-1.5 font-semibold">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  Modificado para {getDayOfWeekName(shipDate)} (Emergencia o cierre)
                </span>
              )}
            </div>
          </div>

          {/* Buscador Rápido */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Búsqueda Rápida
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('viele.search_placeholder')}
                className="w-full bg-white border border-slate-300 rounded-xl pl-10 pr-10 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-sm placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Barra de Estado de Orden Personalizado por Sucursal & Controles Drag & Drop */}
        <div className="mt-4 bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Disposición de Almacén:
            </span>
            {hasCustomOrder ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 shadow-xs">
                <span>⭐</span> {t('viele.custom_order_active')} ({currentStoreAccount?.storeName})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                <span>📋</span> {t('viele.official_order_active')} (Order Guide)
              </span>
            )}
            <span className="text-xs text-slate-400 hidden lg:inline">
              • Arrastra cualquier fila con el mouse para adaptar la lista al recorrido de tu bodega
            </span>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {hasCustomOrder && (
              <button
                type="button"
                onClick={handleResetToOfficialOrder}
                disabled={isSavingCustomOrder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-800 rounded-xl text-xs font-bold border border-slate-200 transition shadow-xs cursor-pointer"
                title={t('viele.reset_to_official')}
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                {t('viele.reset_to_official')}
              </button>
            )}
            {isSavingCustomOrder && (
              <span className="text-xs font-bold text-amber-600 animate-pulse flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                Guardando orden...
              </span>
            )}
          </div>
        </div>

        {/* Tarjetas Gemelas de Facturación Viele & Sons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          {/* Factura 1: Sodas BIB */}
          <div className={`p-4 rounded-2xl border transition-all ${
            summary.sodas.totalCases > 0 
              ? 'bg-gradient-to-br from-indigo-50 to-purple-50/40 border-indigo-200 shadow-sm' 
              : 'bg-white border-slate-200 opacity-85'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">
                <span>🥤</span> Factura 1: Sodas (BIB)
              </span>
              <span className="text-[11px] font-mono text-indigo-700 font-semibold">
                {summary.sodas.itemsCount} SKUs pedidos
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <div>
                <span className="text-2xl font-black text-indigo-950 font-mono">
                  ${summary.sodas.grandTotal.toFixed(2)}
                </span>
                <span className="block text-[11px] text-slate-500 font-medium">
                  Subtotal: ${summary.sodas.subtotal.toFixed(2)} + Tax (9.5%): ${summary.sodas.estTax.toFixed(2)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-lg font-black text-indigo-700 font-mono">
                  {summary.sodas.totalCases}
                </span>
                <span className="block text-[10px] uppercase font-bold text-slate-400">cajas</span>
              </div>
            </div>
          </div>

          {/* Factura 2: Insumos Generales */}
          <div className={`p-4 rounded-2xl border transition-all ${
            summary.general.totalCases > 0 
              ? 'bg-gradient-to-br from-amber-50 to-orange-50/40 border-amber-200 shadow-sm' 
              : 'bg-white border-slate-200 opacity-85'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                <span>📦</span> Factura 2: Insumos Generales
              </span>
              <span className="text-[11px] font-mono text-amber-700 font-semibold">
                {summary.general.itemsCount} SKUs pedidos
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <div>
                <span className="text-2xl font-black text-amber-950 font-mono">
                  ${summary.general.grandTotal.toFixed(2)}
                </span>
                <span className="block text-[11px] text-slate-500 font-medium">
                  Subtotal: ${summary.general.subtotal.toFixed(2)} + Tax (9.5%): ${summary.general.estTax.toFixed(2)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-lg font-black text-amber-700 font-mono">
                  {summary.general.totalCases}
                </span>
                <span className="block text-[10px] uppercase font-bold text-slate-400">cajas</span>
              </div>
            </div>
          </div>

          {/* Factura 3: Total Combinado */}
          <div className="p-4 rounded-2xl border bg-gradient-to-br from-emerald-50 to-teal-50/40 border-emerald-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                <span>💰</span> Total Combinado
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-600 text-white shadow-xs">
                {summary.isSplit ? '2 Facturas Viele & Sons' : '1 Factura Viele & Sons'}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <div>
                <span className="text-2xl font-black text-emerald-950 font-mono">
                  ${summary.grandTotal.toFixed(2)}
                </span>
                <span className="block text-[11px] text-slate-500 font-medium">
                  Subtotal: ${summary.subtotal.toFixed(2)} + Tax: ${summary.estTax.toFixed(2)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-lg font-black text-emerald-700 font-mono">
                  {summary.totalCases}
                </span>
                <span className="block text-[10px] uppercase font-bold text-slate-400">cajas totales</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Banner de Error */}
      {errorMessage && (
        <div className="max-w-7xl mx-auto mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-700 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm font-semibold">{errorMessage}</p>
        </div>
      )}

      {/* Tabla Interactiva de Insumos */}
      <div className="max-w-7xl mx-auto bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-24 text-center text-slate-400">
            <Package className="w-12 h-12 mx-auto animate-bounce mb-3 text-amber-500" />
            <p className="text-base font-bold text-slate-700">Cargando catálogo maestro y niveles PAR de {currentStoreAccount?.storeName}...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="py-3.5 px-2 w-10 text-center" title={t('viele.drag_handle_title')}>
                    <GripVertical className="w-4 h-4 mx-auto text-slate-400" />
                  </th>
                  <th className="py-3.5 px-3 w-12 text-center">#</th>
                  <th className="py-3.5 px-3 w-16 text-center">{t('viele.table.photo')}</th>
                  <th className="py-3.5 px-3 w-28 text-center">{t('viele.table.sku')}</th>
                  <th className="py-3.5 px-4">{t('viele.table.description')}</th>
                  <th className="py-3.5 px-3 w-24 text-right">{t('viele.table.price')}</th>
                  <th className="py-3.5 px-3 w-20 text-center bg-amber-50/70 text-amber-900">{t('viele.table.par')}</th>
                  <th className="py-3.5 px-3 w-24 text-center bg-slate-100/70 text-slate-700">{t('viele.table.leftover')}</th>
                  <th className="py-3.5 px-3 w-24 text-center bg-blue-50/70 text-blue-800">{t('viele.table.suggested')}</th>
                  <th className="py-3.5 px-4 w-36 text-center bg-emerald-50/70 text-emerald-800">{t('viele.table.final_order')}</th>
                  <th className="py-3.5 px-4 w-28 text-right">{t('viele.table.extended')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredItems.map((item, index) => {
                  const row = orderRows[item.item_code] || {
                    item,
                    par: pars[item.item_code] ?? 0,
                    leftover: '',
                    suggested: pars[item.item_code] ?? 0,
                    finalOrder: pars[item.item_code] ?? 0
                  };

                  const isOrdered = row.finalOrder > 0;
                  const extendedAmount = row.finalOrder * item.unit_price;
                  const isDraggingThis = draggedIndex === index;
                  const isDragOverThis = dragOverIndex === index;

                  return (
                    <tr 
                      key={item.item_code}
                      draggable={!searchQuery}
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => handleDrop(e, index)}
                      className={`transition-all ${
                        isOrdered ? 'bg-emerald-50/30' : 'hover:bg-slate-50/80'
                      } ${
                        isDragOverThis ? 'border-t-2 border-amber-500 bg-amber-50/60 shadow-inner' : ''
                      } ${
                        isDraggingThis ? 'opacity-30 bg-slate-200' : ''
                      }`}
                    >
                      {/* Agarradera Drag & Drop */}
                      <td
                        className={`py-2.5 px-2 text-center select-none ${
                          searchQuery
                            ? 'cursor-not-allowed opacity-25 text-slate-300'
                            : 'cursor-grab active:cursor-grabbing text-slate-400 hover:text-amber-600'
                        }`}
                        title={searchQuery ? 'Limpia la búsqueda para arrastrar y reordenar' : t('viele.drag_handle_title')}
                      >
                        <GripVertical className="w-4 h-4 mx-auto" />
                      </td>

                      {/* Correlativo */}
                      <td className="py-2.5 px-3 text-center text-xs text-slate-400 font-mono">
                        {index + 1}
                      </td>

                      {/* Miniatura Fotográfica */}
                      <td className="py-2.5 px-4 text-center">
                        <div className="w-10 h-10 bg-white rounded-lg p-0.5 border border-slate-200 shadow-sm mx-auto flex items-center justify-center overflow-hidden">
                          <img
                            src={item.image_file}
                            alt={item.item_code}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/images/viele/placeholder.png';
                            }}
                          />
                        </div>
                      </td>

                      {/* Código SKU */}
                      <td className="py-2.5 px-4 text-center">
                        <span className="font-mono font-bold text-xs px-2.5 py-1 rounded bg-slate-100 text-slate-800 border border-slate-200">
                          {item.item_code}
                        </span>
                      </td>

                      {/* Descripción y UOM */}
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-slate-900 text-sm leading-snug">
                          {item.description}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-500 font-semibold uppercase">
                            UOM: <strong className="text-slate-700">{item.uom}</strong>
                          </span>
                          <span className="text-xs text-slate-300">•</span>
                          <span className="text-xs text-slate-500">
                            {item.category}
                          </span>
                        </div>
                      </td>

                      {/* Precio Unitario (Sincronizado automáticamente) */}
                      <td className="py-2.5 px-4 text-right font-mono text-slate-700 text-xs font-semibold">
                        ${item.unit_price.toFixed(2)}
                      </td>

                      {/* Nivel PAR */}
                      <td className="py-2.5 px-4 text-center bg-amber-50/40 font-black text-amber-800 font-mono text-base">
                        {row.par > 0 ? row.par : <span className="text-slate-400 font-normal text-xs">-</span>}
                      </td>

                      {/* Input Sobrante */}
                      <td className="py-2.5 px-4 text-center bg-slate-50/50">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.leftover}
                          onChange={(e) => handleLeftoverChange(item.item_code, e.target.value)}
                          placeholder="0"
                          className="w-16 text-center font-bold font-mono py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm shadow-sm"
                        />
                      </td>

                      {/* Sugerido (PAR - Sobrante) */}
                      <td className="py-2.5 px-4 text-center bg-blue-50/30 font-mono font-black text-blue-700 text-sm">
                        {row.suggested}
                      </td>

                      {/* Pedido Final (Controles + Input) */}
                      <td className="py-2.5 px-4 text-center bg-emerald-50/30">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleFinalOrderChange(item.item_code, row.finalOrder - 1)}
                            className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-bold transition border border-slate-300 shadow-sm"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={row.finalOrder}
                            onChange={(e) => handleFinalOrderChange(item.item_code, parseInt(e.target.value) || 0)}
                            className={`w-14 text-center font-mono font-black py-1 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm ${
                              isOrdered
                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                : 'bg-white text-slate-400 border-slate-300'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => handleFinalOrderChange(item.item_code, row.finalOrder + 1)}
                            className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-bold transition border border-slate-300 shadow-sm"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* Importe Extendido */}
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-xs text-slate-900">
                        ${extendedAmount.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating Sticky Footer con Resumen y Acciones */}
      <div className="sticky bottom-[70px] lg:bottom-4 z-30 max-w-7xl mx-auto bg-white/95 backdrop-blur-md border border-slate-200 px-4 sm:px-6 py-4 rounded-2xl shadow-xl mt-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Métricas del Pedido */}
          <div className="flex items-center gap-5 flex-wrap">
            <div>
              <span className="text-xs text-slate-500 uppercase font-bold block">
                {t('viele.summary.ordered_items')}
              </span>
              <span className="text-lg font-black text-slate-900">
                {summary.orderedItemsCount} <span className="text-xs font-normal text-slate-400">/ {catalog.length}</span>
              </span>
            </div>

            <div className="border-l border-slate-200 pl-5">
              <span className="text-xs text-slate-500 uppercase font-bold block">
                {t('viele.summary.total_cases')}
              </span>
              <span className="text-xl font-black text-slate-800 font-mono">
                {summary.totalCases} <span className="text-xs font-normal text-slate-500">cajas</span>
              </span>
            </div>

            {/* Factura 1: Sodas */}
            <div className="border-l border-slate-200 pl-5 hidden sm:block">
              <span className="text-[11px] text-indigo-700 uppercase font-bold flex items-center gap-1">
                <span>🥤</span> Sodas ({summary.sodas.totalCases} cjs)
              </span>
              <span className="text-base font-black text-indigo-950 font-mono">
                ${summary.sodas.grandTotal.toFixed(2)}
              </span>
            </div>

            {/* Factura 2: Insumos */}
            <div className="border-l border-slate-200 pl-5 hidden sm:block">
              <span className="text-[11px] text-amber-700 uppercase font-bold flex items-center gap-1">
                <span>📦</span> Insumos ({summary.general.totalCases} cjs)
              </span>
              <span className="text-base font-black text-amber-950 font-mono">
                ${summary.general.grandTotal.toFixed(2)}
              </span>
            </div>

            {/* Total Combinado */}
            <div className="border-l border-slate-200 pl-5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 uppercase font-bold block">
                  {t('viele.summary.grand_total')}
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase">
                  {summary.isSplit ? '2 Facturas V&S' : '1 Factura V&S'}
                </span>
              </div>
              <span className="text-2xl font-black text-emerald-700 font-mono">
                ${summary.grandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveDraft}
              disabled={isSubmitting || summary.totalCases === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-bold text-sm rounded-xl border border-slate-300 transition shadow-sm cursor-pointer"
            >
              <Save className="w-4 h-4 text-slate-500" />
              {t('viele.save_draft')}
            </button>

            <button
              onClick={() => setIsConfirmModalOpen(true)}
              disabled={isSubmitting || summary.totalCases === 0}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition cursor-pointer"
            >
              <Send className="w-4 h-4" />
              {t('viele.submit_order')}
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Confirmación de Envío Oficial a Viele & Sons */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div className="flex items-center gap-3">
                <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-200 shadow-sm">
                  <Truck className="w-6 h-6" />
                </span>
                <h3 className="text-lg font-black text-slate-900">
                  {t('viele.modal.confirm_title')}
                </h3>
              </div>
              <button
                onClick={() => setIsConfirmModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              {t('viele.modal.confirm_desc')}
            </p>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 mb-5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">{t('viele.modal.store_label')}</span>
                <strong className="text-slate-900">🌮 {currentStoreAccount?.storeName} (#{storeId})</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sage 100 Customer ID:</span>
                <span className="font-mono text-amber-800 font-bold">{currentStoreAccount?.sageCustomerCode}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">{t('viele.modal.date_label')}</span>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5 font-mono text-slate-900 font-bold">
                    <span>🇺🇸 {formatUsDate(shipDate)}</span>
                  </div>
                  <span className="block text-[11px] text-slate-600 font-medium">
                    {formatUsFullDate(shipDate, 'en-US')}
                  </span>
                  {isTuesday(shipDate) ? (
                    <span className="block text-[11px] text-emerald-700 font-semibold">Martes habitual (Ciclo programado Viele)</span>
                  ) : (
                    <span className="block text-[11px] text-amber-700 font-semibold">Modificado por emergencia</span>
                  )}
                </div>
              </div>

              {/* Desglose Dual de Facturación */}
              <div className="pt-2 border-t border-slate-200 mt-2 space-y-2">
                {summary.sodas.totalCases > 0 && (
                  <div className="flex items-center justify-between bg-indigo-50/70 p-2.5 rounded-lg border border-indigo-100 text-xs">
                    <span className="font-bold text-indigo-900 flex items-center gap-1.5">
                      <span>🥤</span> Factura 1 (Sodas BIB):
                    </span>
                    <div className="text-right font-mono">
                      <span className="font-bold text-indigo-950">{summary.sodas.totalCases} cajas</span>
                      <span className="text-slate-400 mx-1">•</span>
                      <strong className="text-indigo-700">${summary.sodas.grandTotal.toFixed(2)}</strong>
                    </div>
                  </div>
                )}
                {summary.general.totalCases > 0 && (
                  <div className="flex items-center justify-between bg-amber-50/70 p-2.5 rounded-lg border border-amber-100 text-xs">
                    <span className="font-bold text-amber-900 flex items-center gap-1.5">
                      <span>📦</span> Factura 2 (Insumos Generales):
                    </span>
                    <div className="text-right font-mono">
                      <span className="font-bold text-amber-950">{summary.general.totalCases} cajas</span>
                      <span className="text-slate-400 mx-1">•</span>
                      <strong className="text-amber-700">${summary.general.grandTotal.toFixed(2)}</strong>
                    </div>
                  </div>
                )}
                {summary.isSplit && (
                  <p className="text-[11px] text-slate-500 leading-snug px-1">
                    ℹ️ <strong>Protocolo Oficial Viele & Sons:</strong> Se generarán automáticamente 2 órdenes correlativas independientes para emitir facturas separadas de Sodas e Insumos tal como lo requiere el proveedor.
                  </p>
                )}
              </div>

              <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
                <span className="text-slate-700 font-bold">{t('viele.modal.total_label')}</span>
                <strong className="text-emerald-700 font-mono text-lg">${summary.grandTotal.toFixed(2)}</strong>
              </div>
            </div>

            {/* Inputs del Comprador */}
            <div className="space-y-3 mb-6">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-600">
                    {t('viele.modal.buyer_label')}
                  </label>
                  <span className="text-[10px] text-emerald-700 font-mono font-bold">
                    ★ Código Oficial: AFV
                  </span>
                </div>
                <input
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 font-bold font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 uppercase shadow-sm"
                />
                {/* Botones de Comprador Registrado en Viele */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[10px] text-slate-500">Registrados en Viele & Sons:</span>
                  {(['AFV', 'LEWIS', 'MARK', 'PV'] as const).map(code => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setBuyerName(code)}
                      className={`px-2 py-0.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                        buyerName === code
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                      }`}
                    >
                      {code} {code === 'AFV' ? '★ Oficial' : ''}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  {t('viele.modal.po_label')}
                </label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder={buyerName || 'AFV'}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
                />
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[10px] text-slate-500">Referencias / Químicos:</span>
                  {(['AFV', 'AFV / CHEMICAL', 'MARK / CHEMICAL', 'LEWIS/CHEMICALS', 'PV/ CHEMICAL'] as const).map(refCode => (
                    <button
                      key={refCode}
                      type="button"
                      onClick={() => setPoNumber(refCode)}
                      className={`px-2 py-0.5 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                        poNumber === refCode
                          ? 'bg-emerald-600 text-white font-black shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                      }`}
                    >
                      {refCode}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Si se deja en blanco, se registrará automáticamente como <strong className="text-slate-800 font-mono">{buyerName || 'AFV'}</strong> tal como siempre se ha registrado en Viele & Sons.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  {t('viele.modal.notes_label')}
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Instrucciones de entrega para el chofer..."
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none shadow-sm"
                />
              </div>
            </div>

            {/* Botones del Modal */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition cursor-pointer"
              >
                {t('viele.modal.btn_cancel')}
              </button>

              <button
                onClick={handleConfirmLiveSubmit}
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('viele.modal.sending')}
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    {t('viele.modal.btn_confirm')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Éxito al Finalizar Orden */}
      {submitSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-emerald-200 rounded-2xl max-w-md w-full p-6 shadow-2xl text-center text-slate-900 animate-in fade-in zoom-in-95">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
              <CheckCircle className="w-10 h-10" />
            </div>

            <h3 className="text-xl font-black text-slate-900 mb-2">
              {t('viele.modal.success_title')}
            </h3>

            <p className="text-sm text-slate-600 mb-5 leading-relaxed">
              {submitSuccess.split ? (
                <>
                  Se generaron exitosamente las <strong>2 facturas oficiales</strong> en Viele & Sons:
                </>
              ) : (
                t('viele.modal.success_desc')
              )}
            </p>

            {submitSuccess.split ? (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6 text-left space-y-3">
                {/* Factura Sodas */}
                <div className="p-3 bg-indigo-50/80 rounded-xl border border-indigo-100 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-indigo-900 block flex items-center gap-1">
                      <span>🥤</span> Factura 1 (Sodas BIB)
                    </span>
                    <span className="text-lg font-black text-indigo-950 font-mono">
                      {submitSuccess.orderNumberSodas}
                    </span>
                  </div>
                  <span className="text-sm font-bold font-mono text-indigo-700">
                    ${submitSuccess.sodasTotal?.toFixed(2) || '0.00'}
                  </span>
                </div>

                {/* Factura Insumos */}
                <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-100 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-amber-900 block flex items-center gap-1">
                      <span>📦</span> Factura 2 (Insumos Generales)
                    </span>
                    <span className="text-lg font-black text-amber-950 font-mono">
                      {submitSuccess.orderNumberGeneral}
                    </span>
                  </div>
                  <span className="text-sm font-bold font-mono text-amber-700">
                    ${submitSuccess.generalTotal?.toFixed(2) || '0.00'}
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                  <span className="text-slate-500 font-bold">Total Facturado Combinado:</span>
                  <span className="text-base font-black font-mono text-emerald-700">
                    ${submitSuccess.totalAmount?.toFixed(2) || '0.00'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6 text-center">
                <span className="text-xs text-slate-500 uppercase font-bold block mb-1">
                  {t('viele.modal.order_number_label')}
                </span>
                <span className="text-2xl font-black text-emerald-700 font-mono tracking-wider">
                  {submitSuccess.orderNumber}
                </span>
                <div className="text-xs text-slate-500 mt-1">
                  {submitSuccess.isSimulation ? 'Simulación verificada' : 'Confirmada oficialmente en Sage 100'}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Link
                href="/admin/compras/viele/historial"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-xl transition shadow-md shadow-emerald-600/20"
              >
                {t('viele.modal.btn_view_history')}
              </Link>
              <button
                onClick={() => setSubmitSuccess(null)}
                className="w-full py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition cursor-pointer"
              >
                {t('viele.modal.btn_new_order')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VieleOrderPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Cargando pedido...</div>}>
      <VieleOrderContent />
    </Suspense>
  );
}
