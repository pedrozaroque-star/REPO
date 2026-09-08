/**
 * @module admin/compras/viele/historial
 * @description Historial unificado de pedidos Viele & Sons con dos fuentes de datos:
 *              1) Órdenes históricas del portal ClearNine / Sage 100 (en vivo desde shop.vieleandsons.com)
 *              2) Órdenes creadas desde la app TEG (almacenadas en Supabase viele_orders)
 *              Incluye filtros por sucursal, año y búsqueda; estadísticas; modal de detalle e impresión.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Las órdenes Web V&S se consultan EN VIVO desde el servidor ClearNine vía /api/viele/history.
 * - Las órdenes App TEG se consultan desde Supabase vía /api/viele/orders.
 * - Soporte Bilingüe: useLanguage() de lib/i18n.tsx.
 * - Formato de moneda con separador de miles ($X,XXX.XX) usando formatCurrency y formatNumber.
 * - Paleta visual: Tema claro (Light Mode) oficial de SM TEG.
 *
 * @dataFlow
 * - Tab Web V&S: GET /api/viele/history?storeId=X&year=YYYY → proxy a ClearNine salesOrderList_dt
 * - Tab App TEG: GET /api/viele/orders?storeId=X&year=YYYY → Supabase viele_orders
 * - Detalle Web: GET /api/viele/history?storeId=X&orderNo=Wxxxxxx → proxy a salesOrderDetail_dt
 * - Detalle App: GET /api/viele/orders?orderId=Y → Supabase viele_order_items
 *
 * @notes
 * - [2026-09-08] Rediseño completo: historial unificado con tabs Web/App, filtro por año, impresión.
 * - [2026-09-07] Formato estándar con separadores de miles ($X,XXX.XX y X,XXX).
 */

'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { VIELE_STORE_ACCOUNTS, formatUsDate, formatCurrency, formatNumber } from '@/lib/viele-api';
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute';
import {
  ArrowLeft, History, Package, DollarSign, Search, Eye, X, CheckCircle,
  FileText, Globe, Smartphone, Printer, BarChart3, ShoppingCart, Lock
} from 'lucide-react';

/* ═══════════════════ TYPES ═══════════════════ */
interface WebOrder {
  orderNo: string; orderDate: string; rawDate: string; status: string;
  shipToName: string; customerPo: string; orderTotal: string; orderTotalNumeric: number;
  storeId?: number; storeName?: string;
}
interface WebOrderItem {
  itemCode: string; description: string; qtyOrdered: number; qtyShipped: number;
  uom: string; unitPrice: string; unitPriceNumeric: number;
  extendedAmount: string; extendedAmountNumeric: number;
}
interface AppOrder {
  id: number; store_id: number; order_number: string; order_category?: string;
  linked_order_number?: string; order_date: string; ship_date: string; status: string;
  total_cases: number; subtotal_amount: number; tax_amount: number; total_amount: number;
  buyer_name: string; customer_po_no: string; created_at: string;
}
interface AppOrderItem {
  id: number; item_code: string; description: string; uom: string; unit_price: number;
  par_quantity: number; leftover_quantity: number; suggested_quantity: number;
  order_quantity: number; extended_amount: number;
}
type ActiveTab = 'web' | 'app';

/* ═══════════════════ MAIN COMPONENT ═══════════════════ */
function OrderHistoryContent() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const printRef = useRef<HTMLDivElement>(null);

  // Role-based store access
  const userRole = (user?.role || '').toLowerCase();
  const isManager = userRole === 'manager' || userRole === 'gerente';
  const isExecutive = userRole === 'admin' || userRole === 'supervisor';
  const userStoreId = user?.store_id ? String(user.store_id) : null;

  // If manager → lock to their store; otherwise use URL param or 'all'
  const initialStoreId = isManager && userStoreId
    ? userStoreId
    : searchParams.get('storeId') || 'all';

  const [activeTab, setActiveTab] = useState<ActiveTab>('web');
  const [storeId, setStoreId] = useState<string>(initialStoreId);
  const [year, setYear] = useState<string>('2025,2026');
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-sync storeId when user loads asynchronously as manager
  useEffect(() => {
    if (isManager && userStoreId && storeId !== userStoreId) {
      setStoreId(userStoreId);
    }
  }, [isManager, userStoreId, storeId]);

  // Web V&S state
  const [webOrders, setWebOrders] = useState<WebOrder[]>([]);
  const [webLoading, setWebLoading] = useState(false);
  const [webError, setWebError] = useState('');

  // App TEG state
  const [appOrders, setAppOrders] = useState<AppOrder[]>([]);
  const [appLoading, setAppLoading] = useState(false);

  // Detail modal state
  const [detailModal, setDetailModal] = useState<{
    open: boolean; source: 'web' | 'app'; orderNo: string; storeId: string;
    orderDate?: string; status?: string; customerPo?: string; orderTotal?: string;
    storeName?: string; appOrderId?: number; appOrder?: AppOrder;
  } | null>(null);
  const [detailItems, setDetailItems] = useState<(WebOrderItem | AppOrderItem)[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  /* ─── Load Web V&S Orders (supports storeId=all and multi-year) ─── */
  useEffect(() => {
    if (activeTab !== 'web') return;
    let cancelled = false;
    async function load() {
      setWebLoading(true); setWebError('');
      try {
        const res = await fetch(`/api/viele/history?storeId=${storeId}&year=${year}&limit=500`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) setWebOrders(data.orders || []);
        else { setWebError(data.error || 'Error'); setWebOrders([]); }
      } catch { if (!cancelled) { setWebError('Error de conexión'); setWebOrders([]); } }
      finally { if (!cancelled) setWebLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [activeTab, storeId, year]);

  /* ─── Load App TEG Orders (supports multi-year) ─── */
  useEffect(() => {
    if (activeTab !== 'app') return;
    let cancelled = false;
    async function load() {
      setAppLoading(true);
      try {
        const yearList = year.split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y));
        const allOrders: AppOrder[] = [];
        for (const yr of yearList) {
          const params = new URLSearchParams();
          if (storeId !== 'all') params.append('storeId', storeId);
          params.append('year', yr);
          const res = await fetch(`/api/viele/orders?${params.toString()}`);
          const data = await res.json();
          if (data.success && data.orders) allOrders.push(...data.orders);
        }
        if (!cancelled) setAppOrders(allOrders);
      } catch { /* ignore */ }
      finally { if (!cancelled) setAppLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [activeTab, storeId, year]);

  /* ─── Load Detail ─── */
  const handleViewDetail = async (source: 'web' | 'app', id: string | number, meta?: any) => {
    setDetailModal({ open: true, source, orderNo: String(id), storeId, ...meta });
    setDetailLoading(true); setDetailItems([]);
    try {
      if (source === 'web') {
        const sid = meta?.storeId || storeId;
        const res = await fetch(`/api/viele/history?storeId=${sid}&orderNo=${id}`);
        const data = await res.json();
        if (data.success) setDetailItems(data.items || []);
      } else {
        const res = await fetch(`/api/viele/orders?orderId=${id}`);
        const data = await res.json();
        if (data.success) {
          setDetailItems(data.items || []);
          if (data.order) setDetailModal(prev => prev ? { ...prev, appOrder: data.order } : null);
        }
      }
    } catch { /* ignore */ }
    finally { setDetailLoading(false); }
  };

  /* ─── Print ─── */
  const handlePrint = () => {
    if (!printRef.current) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head>
      <title>${t('viele.historial.print_title')} — ${detailModal?.orderNo || ''}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;padding:24px;font-size:12px}
        .hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #f59e0b;padding-bottom:12px;margin-bottom:16px}
        .hdr h1{font-size:18px;color:#1e293b}.hdr .brand{font-size:14px;color:#92400e;font-weight:700}
        .meta{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:16px}
        .meta label{font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;display:block}
        .meta strong{font-size:13px;color:#0f172a}
        table{width:100%;border-collapse:collapse;font-size:11px}
        th{background:#f1f5f9;color:#475569;font-size:10px;text-transform:uppercase;font-weight:700;padding:8px 6px;border-bottom:2px solid #e2e8f0;text-align:left}
        td{padding:6px;border-bottom:1px solid #f1f5f9}
        tr:nth-child(even){background:#f8fafc}
        .tr{text-align:right}.tc{text-align:center}.fb{font-weight:700}
        .mono{font-family:Consolas,monospace}
        .total-row{background:#fffbeb!important;font-weight:700;border-top:2px solid #f59e0b}
        .ft{margin-top:16px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px}
        @media print{body{padding:12px}}
      </style></head><body>${printRef.current.innerHTML}
      <div class="ft">Tacos Gavilan — Viele & Sons Procurement System — ${new Date().toLocaleDateString('en-US')}</div>
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  const q = searchQuery.toLowerCase().trim();
  const filteredWeb = webOrders
    .filter(o => !q || o.orderNo.toLowerCase().includes(q) || o.customerPo.toLowerCase().includes(q) || o.shipToName.toLowerCase().includes(q) || (o.storeName || '').toLowerCase().includes(q))
    .sort((a, b) => (b.rawDate || '').localeCompare(a.rawDate || '') || b.orderNo.localeCompare(a.orderNo));
  const filteredApp = appOrders
    .filter(o => !q || (o.order_number||'').toLowerCase().includes(q) || (o.buyer_name||'').toLowerCase().includes(q) || (o.customer_po_no||'').toLowerCase().includes(q) || (o.linked_order_number||'').toLowerCase().includes(q))
    .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '') || (b.id || 0) - (a.id || 0));

  /* ─── Stats ─── */
  const webStats = { count: filteredWeb.length, total: filteredWeb.reduce((a, o) => a + o.orderTotalNumeric, 0), avg: filteredWeb.length > 0 ? filteredWeb.reduce((a, o) => a + o.orderTotalNumeric, 0) / filteredWeb.length : 0 };
  const appStats = { count: filteredApp.length, total: filteredApp.reduce((a, o) => a + (o.total_amount || 0), 0), avg: filteredApp.length > 0 ? filteredApp.reduce((a, o) => a + (o.total_amount || 0), 0) / filteredApp.length : 0 };
  const stats = activeTab === 'web' ? webStats : appStats;
  const isLoading = activeTab === 'web' ? webLoading : appLoading;
  const yearOptions: { value: string; label: string }[] = [
    { value: '2025,2026', label: '📅 2025 + 2026' },
    { value: '2026', label: '📅 2026' },
    { value: '2025', label: '📅 2025' },
    { value: '2024', label: '📅 2024' },
    { value: '2023', label: '📅 2023' },
    { value: '2023,2024,2025,2026', label: '📅 Todos (2023–2026)' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* ═══ Header ═══ */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 pb-5 mb-6">
          <div className="flex items-center gap-3">
            <Link href={`/admin/compras/viele${storeId !== 'all' ? `?storeId=${storeId}` : ''}`} className="p-2.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl border border-slate-200 transition shadow-sm">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                {t('viele.historial.title')}
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold uppercase">{t('viele.historial.badge_sage')}</span>
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">{t('viele.historial.subtitle')}</p>
            </div>
          </div>
          <Link href={`/admin/compras/viele${storeId !== 'all' ? `?storeId=${storeId}` : ''}`} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition shadow-md shadow-emerald-600/20">
            <Package className="w-4 h-4" /> {t('viele.historial.btn_new_order')}
          </Link>
        </div>

        {/* ═══ Tabs ═══ */}
        <div className="flex rounded-xl bg-white p-1 border border-slate-200 shadow-sm mb-6">
          <button onClick={() => setActiveTab('web')} className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-bold transition cursor-pointer ${activeTab === 'web' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}>
            <Globe className="w-4 h-4" />
            <span className="hidden sm:inline">{t('viele.historial.tab_web')}</span>
            <span className="sm:hidden">{t('viele.historial.tab_web_short')}</span>
          </button>
          <button onClick={() => setActiveTab('app')} className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm font-bold transition cursor-pointer ${activeTab === 'app' ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}>
            <Smartphone className="w-4 h-4" />
            <span className="hidden sm:inline">{t('viele.historial.tab_app')}</span>
            <span className="sm:hidden">{t('viele.historial.tab_app_short')}</span>
          </button>
        </div>

        {/* ═══ Filters ═══ */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              {t('viele.historial.store_filter')}
              {isManager && <Lock className="w-3 h-3 inline ml-1 text-amber-500" />}
            </label>
            {isManager && userStoreId ? (
              <div className="w-full bg-amber-50 border border-amber-300 rounded-xl px-3.5 py-2.5 text-amber-900 font-semibold text-sm cursor-not-allowed">
                🌮 {VIELE_STORE_ACCOUNTS[Number(userStoreId)]?.storeName || `Tienda #${userStoreId}`}
              </div>
            ) : (
              <select value={storeId} onChange={e => setStoreId(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-sm">
                <option value="all">🌟 {t('viele.historial.all_stores')}</option>
                {Object.values(VIELE_STORE_ACCOUNTS).map(a => <option key={a.storeId} value={a.storeId}>🌮 {a.storeName} (#{a.storeId}) — {a.sageCustomerCode}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">{t('viele.historial.year_filter')}</label>
            <select value={year} onChange={e => setYear(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-sm">
              {yearOptions.map(y => <option key={y.value} value={y.value}>{y.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">{t('viele.historial.search_placeholder')}</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t('viele.historial.search_placeholder')} className="w-full bg-white border border-slate-300 rounded-xl pl-10 pr-10 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-sm placeholder:text-slate-400" />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-4 h-4" /></button>}
            </div>
          </div>
        </div>

        {/* ═══ Stats ═══ */}
        {!isLoading && stats.count > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[
              { icon: <ShoppingCart className="w-5 h-5" />, label: t('viele.historial.stats_total_orders'), value: formatNumber(stats.count), bg: 'bg-blue-50 text-blue-600 border-blue-200' },
              { icon: <DollarSign className="w-5 h-5" />, label: t('viele.historial.stats_total_spent'), value: formatCurrency(stats.total), bg: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
              { icon: <BarChart3 className="w-5 h-5" />, label: t('viele.historial.stats_avg_order'), value: formatCurrency(stats.avg), bg: 'bg-amber-50 text-amber-600 border-amber-200' },
            ].map((c, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className={`p-2.5 rounded-xl border ${c.bg}`}>{c.icon}</span>
                  <div>
                    <p className="text-xs text-slate-500 font-bold uppercase">{c.label}</p>
                    <p className="text-2xl font-bold text-slate-900 tabular-nums">{c.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══════ TAB: WEB V&S ═══════ */}
        {activeTab === 'web' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            {webLoading ? (
              <div className="py-20 text-center"><History className="w-10 h-10 mx-auto animate-spin mb-3 text-blue-500" /><p className="font-bold text-slate-600">{t('viele.historial.loading_web')}</p><p className="text-xs text-slate-400 mt-1">{storeId === 'all' ? 'Consultando las 15 sucursales en paralelo...' : ''}</p></div>
            ) : webError ? (
              <div className="py-20 text-center"><X className="w-10 h-10 mx-auto mb-3 text-red-400" /><p className="font-bold text-red-600">Error: {webError}</p></div>
            ) : filteredWeb.length === 0 ? (
              <div className="py-20 text-center"><FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" /><p className="font-bold text-slate-700">{t('viele.historial.no_orders')}</p><p className="text-xs text-slate-400 mt-1">No hay órdenes de {year} para esta sucursal en Sage 100.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_order_no')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_order_date')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_status')}</th>
                      <th className="py-3.5 px-4">{t('viele.historial.col_store')}</th>
                      <th className="py-3.5 px-4">{t('viele.historial.col_po')}</th>
                      <th className="py-3.5 px-4 text-right">{t('viele.historial.col_total')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredWeb.map((o, idx) => (
                      <tr key={`${o.orderNo}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 text-center font-mono font-bold text-blue-800"><div className="flex items-center justify-center gap-1.5"><Globe className="w-3 h-3 text-blue-400" />{o.orderNo}</div></td>
                        <td className="py-3 px-4 text-center tabular-nums text-slate-700 text-xs font-medium">{o.orderDate}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${o.status === 'Complete' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                            {o.status === 'Complete' && <CheckCircle className="w-3 h-3" />}{o.status === 'Complete' ? t('viele.historial.status_complete') : t('viele.historial.status_open')}
                          </span>
                        </td>
                        <td className="py-3 px-4"><strong className="text-slate-900 text-xs">🌮 {o.storeName || VIELE_STORE_ACCOUNTS[Number(storeId)]?.storeName || o.shipToName}</strong></td>
                        <td className="py-3 px-4 text-slate-700 text-xs font-bold">{o.customerPo}</td>
                        <td className="py-3 px-4 text-right tabular-nums font-bold text-slate-900">{o.orderTotal}</td>
                        <td className="py-3 px-4 text-center">
                          <button onClick={() => handleViewDetail('web', o.orderNo, { orderDate: o.orderDate, status: o.status, customerPo: o.customerPo, orderTotal: o.orderTotal, storeName: o.storeName || VIELE_STORE_ACCOUNTS[Number(storeId)]?.storeName || o.shipToName, storeId: String(o.storeId || storeId) })} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition border border-slate-200 shadow-sm cursor-pointer">
                            <Eye className="w-3.5 h-3.5 text-blue-600" />{t('viele.historial.btn_view')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══════ TAB: APP TEG ═══════ */}
        {activeTab === 'app' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            {appLoading ? (
              <div className="py-20 text-center"><History className="w-10 h-10 mx-auto animate-spin mb-3 text-amber-500" /><p className="font-bold text-slate-600">{t('viele.historial.loading')}</p></div>
            ) : filteredApp.length === 0 ? (
              <div className="py-20 text-center"><FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" /><p className="font-bold text-slate-700">{t('viele.historial.no_orders')}</p><p className="text-xs text-slate-400 mt-1">{t('viele.historial.no_orders_hint')}</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_order_no')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_type')}</th>
                      <th className="py-3.5 px-4">{t('viele.historial.col_store')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_order_date')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_ship_date')}</th>
                      <th className="py-3.5 px-4">{t('viele.historial.col_buyer')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_cases')}</th>
                      <th className="py-3.5 px-4 text-right">{t('viele.historial.col_total')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_status')}</th>
                      <th className="py-3.5 px-4 text-center">{t('viele.historial.col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredApp.map(order => {
                      const sa = VIELE_STORE_ACCOUNTS[order.store_id];
                      const isConf = order.status === 'confirmed';
                      const isSoda = order.order_category === 'sodas';
                      return (
                        <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 text-center font-mono font-bold text-amber-800">
                            <div className="flex items-center justify-center gap-1.5"><Smartphone className="w-3 h-3 text-amber-400" />{order.order_number || `#${order.id}`}</div>
                            {order.linked_order_number && (
                              <button onClick={e => { e.stopPropagation(); const tw = appOrders.find(o => o.order_number === order.linked_order_number); if (tw) handleViewDetail('app', tw.id, { orderDate: tw.order_date, orderTotal: formatCurrency(tw.total_amount), storeName: sa?.storeName }); }} className="text-[10px] text-indigo-500 hover:text-indigo-700 font-mono block mt-0.5 underline cursor-pointer" title={t('viele.historial.twin_invoice')}>
                                🔗 {order.linked_order_number}
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {isSoda ? <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">🥤 {t('viele.historial.badge_sodas')}</span>
                              : order.order_category === 'chemicals' ? <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">🧪 {t('viele.historial.badge_chemicals')}</span>
                              : <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">📦 {t('viele.historial.badge_general')}</span>}
                          </td>
                          <td className="py-3 px-4"><strong className="text-slate-900 block text-xs">🌮 {sa?.storeName || `Tienda #${order.store_id}`}</strong><span className="text-[10px] text-slate-500 font-mono">Sage: {sa?.sageCustomerCode || '—'}</span></td>
                          <td className="py-3 px-4 text-center tabular-nums text-slate-700 text-xs font-medium">{formatUsDate(order.order_date)}</td>
                          <td className="py-3 px-4 text-center tabular-nums text-emerald-700 font-semibold text-xs">{formatUsDate(order.ship_date)}</td>
                          <td className="py-3 px-4 text-slate-700 text-xs font-bold">{order.buyer_name}</td>
                          <td className="py-3 px-4 text-center tabular-nums font-bold text-amber-800">{formatNumber(order.total_cases)}</td>
                          <td className="py-3 px-4 text-right tabular-nums font-bold text-slate-900">{formatCurrency(order.total_amount)}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${isConf ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                              {isConf ? <><CheckCircle className="w-3 h-3" />{t('viele.historial.status_confirmed')}</> : t('viele.historial.status_draft')}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button onClick={() => handleViewDetail('app', order.id, { orderDate: order.order_date, orderTotal: formatCurrency(order.total_amount), storeName: sa?.storeName })} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition border border-slate-200 shadow-sm cursor-pointer">
                              <Eye className="w-3.5 h-3.5 text-blue-600" />{t('viele.historial.btn_view')}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════ MODAL DE DETALLE ═══════ */}
      {detailModal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 text-slate-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div className="flex items-center gap-3">
                <span className={`p-2 rounded-xl border shadow-sm ${detailModal.source === 'web' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                  {detailModal.source === 'web' ? <Globe className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    {t('viele.historial.detail_title')}: <span className="text-amber-800 font-mono">{detailModal.orderNo}</span>
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${detailModal.source === 'web' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                      {detailModal.source === 'web' ? `🌐 ${t('viele.historial.source_web')}` : `📱 ${t('viele.historial.source_app')}`}
                    </span>
                    {detailModal.status && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${(detailModal.status === 'Complete' || detailModal.status === 'confirmed') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                        {detailModal.status === 'Complete' ? `✅ ${t('viele.historial.status_complete')}` : detailModal.status === 'confirmed' ? `✅ ${t('viele.historial.status_confirmed')}` : detailModal.status}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition border border-blue-200 cursor-pointer">
                  <Printer className="w-4 h-4" />{t('viele.historial.btn_print')}
                </button>
                <button onClick={() => { setDetailModal(null); setDetailItems([]); }} className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {detailLoading ? (
                <div className="py-12 text-center text-slate-400"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />{t('viele.historial.loading_detail')}</div>
              ) : (
                <div ref={printRef}>
                  {/* Print Header */}
                  <div className="hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #f59e0b', paddingBottom: '12px', marginBottom: '16px' }}>
                    <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>{t('viele.historial.print_title')}</h1>
                    <span className="brand" style={{ fontSize: '14px', fontWeight: 700, color: '#92400e' }}>Tacos Gavilan</span>
                  </div>
                  {/* Meta */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                    <div><label style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>{t('viele.historial.detail_store')}</label><strong style={{ fontSize: '13px', color: '#0f172a' }}>{detailModal.storeName || '—'}</strong></div>
                    <div><label style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>{t('viele.historial.col_order_date')}</label><strong style={{ fontSize: '13px', color: '#0f172a' }}>{detailModal.orderDate || '—'}</strong></div>
                    <div><label style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>{t('viele.historial.col_po')}</label><strong style={{ fontSize: '13px', color: '#0f172a' }}>{detailModal.customerPo || detailModal.appOrder?.customer_po_no || '—'}</strong></div>
                    <div><label style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>{t('viele.historial.detail_total')}</label><strong style={{ fontSize: '13px', color: '#0f172a' }}>{detailModal.orderTotal || '—'}</strong></div>
                  </div>
                  {/* Items */}
                  {detailItems.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9' }}>
                          <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'left', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#475569' }}>SKU</th>
                          <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'left', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#475569' }}>{t('viele.table.description')}</th>
                          {detailModal.source === 'web' ? (
                            <>
                              <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#166534' }}>{t('viele.historial.detail_qty_ordered')}</th>
                              <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#475569' }}>{t('viele.historial.detail_qty_shipped')}</th>
                            </>
                          ) : (
                            <>
                              <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#475569' }}>PAR</th>
                              <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#475569' }}>{t('viele.table.leftover')}</th>
                              <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#166534' }}>{t('viele.historial.detail_qty_ordered')}</th>
                            </>
                          )}
                          <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#475569' }}>UOM</th>
                          <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'right', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#475569' }}>{t('viele.table.price')}</th>
                          <th style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', textAlign: 'right', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: '#475569' }}>{t('viele.table.extended')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((item, idx) => {
                          const isW = detailModal.source === 'web';
                          const w = item as WebOrderItem;
                          const a = item as AppOrderItem;
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
                              <td style={{ padding: '6px', fontFamily: 'Consolas,monospace', fontWeight: 700, color: '#92400e' }}>{isW ? w.itemCode : a.item_code}</td>
                              <td style={{ padding: '6px', color: '#1e293b' }}>{isW ? w.description : a.description}</td>
                              {isW ? (
                                <>
                                  <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'Consolas,monospace', fontWeight: 700, color: '#166534' }}>{w.qtyOrdered}</td>
                                  <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'Consolas,monospace', color: '#475569' }}>{w.qtyShipped}</td>
                                </>
                              ) : (
                                <>
                                  <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'Consolas,monospace', color: '#475569' }}>{formatNumber(a.par_quantity)}</td>
                                  <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'Consolas,monospace', color: '#475569' }}>{formatNumber(a.leftover_quantity)}</td>
                                  <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'Consolas,monospace', fontWeight: 700, color: '#166534' }}>{formatNumber(a.order_quantity)}</td>
                                </>
                              )}
                              <td style={{ padding: '6px', textAlign: 'center', color: '#475569' }}>{isW ? w.uom : a.uom}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'Consolas,monospace', color: '#475569' }}>{isW ? w.unitPrice : formatCurrency(a.unit_price)}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'Consolas,monospace', fontWeight: 700, color: '#0f172a' }}>{isW ? w.extendedAmount : formatCurrency(a.extended_amount)}</td>
                            </tr>
                          );
                        })}
                        <tr style={{ background: '#fffbeb', fontWeight: 700, borderTop: '2px solid #f59e0b' }}>
                          <td colSpan={detailModal.source === 'web' ? 5 : 6} style={{ padding: '8px 6px', textAlign: 'right', fontSize: '12px' }}>TOTAL:</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'Consolas,monospace', fontSize: '13px', color: '#0f172a' }}>{detailModal.orderTotal || '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex justify-between items-center">
              <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-md shadow-blue-600/20 cursor-pointer"><Printer className="w-4 h-4" />{t('viele.historial.btn_print')}</button>
              <button onClick={() => { setDetailModal(null); setDetailItems([]); }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer">{t('viele.historial.btn_close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VieleHistoryPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager']}>
      <Suspense fallback={<div className="p-8 text-center text-slate-500">Cargando historial...</div>}>
        <OrderHistoryContent />
      </Suspense>
    </ProtectedRoute>
  );
}
