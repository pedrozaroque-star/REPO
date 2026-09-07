/**
 * @module admin/compras/viele/historial
 * @description Historial de pedidos y auditoría de compras de Viele & Sons.
 *              Permite consultar todas las órdenes de compra emitidas, sus números oficiales de Sage 100
 *              (Wxxxxxx), fechas de entrega, importes totales y desglose detallado de productos por caja.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Muestra órdenes de las 15 sucursales con filtro individual por tienda.
 * - Soporte Bilingüe: useLanguage() de lib/i18n.tsx.
 * - Paleta visual: Tema claro (Light Mode) oficial de SM TEG (fondos slate-50/50, tarjetas blancas, tablas con thead slate-50).
 *
 * @dataFlow
 * - GET /api/viele/orders?storeId=X → listado de órdenes en viele_orders.
 * - GET /api/viele/orders?orderId=Y → detalle de líneas de producto en viele_order_items.
 *
 * @notes
 * - [2026-09-07] Refactorización a tema claro del sistema para alineación completa con el layout corporativo.
 */

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { VIELE_STORE_ACCOUNTS, formatUsDate, formatUsFullDate } from '@/lib/viele-api';
import { 
  ArrowLeft, 
  History, 
  Package, 
  Calendar, 
  DollarSign, 
  Truck, 
  Search, 
  Eye, 
  X, 
  CheckCircle,
  FileText
} from 'lucide-react';

interface OrderHeader {
  id: number;
  store_id: number;
  order_number: string;
  order_category?: string;
  linked_order_number?: string;
  order_date: string;
  ship_date: string;
  status: string;
  total_cases: number;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  buyer_name: string;
  customer_po_no: string;
  created_at: string;
  stores?: {
    id: number;
    name: string;
    code: string;
  };
}

interface OrderItemLine {
  id: number;
  item_code: string;
  description: string;
  uom: string;
  unit_price: number;
  par_quantity: number;
  leftover_quantity: number;
  suggested_quantity: number;
  order_quantity: number;
  extended_amount: number;
}

function OrderHistoryContent() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStoreId = searchParams.get('storeId') || 'all';

  const [storeId, setStoreId] = useState<string>(initialStoreId);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'general' | 'sodas' | 'chemicals'>('all');
  const [orders, setOrders] = useState<OrderHeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal de detalle
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [orderDetail, setOrderDetail] = useState<{ order: OrderHeader; items: OrderItemLine[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Cargar listado de órdenes
  useEffect(() => {
    async function loadOrders() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (storeId !== 'all') params.append('storeId', storeId);
        if (categoryFilter !== 'all') params.append('category', categoryFilter);

        const url = `/api/viele/orders${params.toString() ? `?${params.toString()}` : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.success && data.orders) {
          setOrders(data.orders);
        }
      } catch (err) {
        console.error('Error cargando historial:', err);
      } finally {
        setLoading(false);
      }
    }

    loadOrders();
  }, [storeId, categoryFilter]);

  // Cargar detalle de una orden al abrir modal
  const handleViewDetail = async (orderId: number) => {
    setSelectedOrderId(orderId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/viele/orders?orderId=${orderId}`);
      const data = await res.json();
      if (data.success) {
        setOrderDetail({ order: data.order, items: data.items });
      }
    } catch (err) {
      console.error('Error cargando detalle:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Filtrado de órdenes
  const filteredOrders = orders.filter(o => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (o.order_number && o.order_number.toLowerCase().includes(q)) ||
      (o.buyer_name && o.buyer_name.toLowerCase().includes(q)) ||
      (o.customer_po_no && o.customer_po_no.toLowerCase().includes(q)) ||
      (o.linked_order_number && o.linked_order_number.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 pb-5 mb-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/admin/compras/viele${storeId !== 'all' ? `?storeId=${storeId}` : ''}`}
              className="p-2.5 bg-white hover:bg-slate-50 text-slate-700 rounded-xl border border-slate-200 transition shadow-sm"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                Historial de Pedidos Viele & Sons
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold uppercase">
                  Auditoría Sage 100
                </span>
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Registro oficial de órdenes de compra, números de confirmación y entregas por sucursal.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`/admin/compras/viele${storeId !== 'all' ? `?storeId=${storeId}` : ''}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition shadow-md shadow-emerald-600/20"
            >
              <Package className="w-4 h-4" />
              Nuevo Pedido
            </Link>
          </div>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          {/* Selector de Tienda */}
          <div className="md:col-span-1">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Filtrar por Sucursal
            </label>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-sm"
            >
              <option value="all">🌟 Todas las Sucursales (15 Tiendas)</option>
              {Object.values(VIELE_STORE_ACCOUNTS).map(acc => (
                <option key={acc.storeId} value={acc.storeId}>
                  🌮 {acc.storeName} (#{acc.storeId}) — {acc.sageCustomerCode}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Tipo de Factura / Categoría */}
          <div className="md:col-span-1">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Tipo de Factura
            </label>
            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition cursor-pointer text-center ${
                  categoryFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs font-black'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('general')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition cursor-pointer text-center ${
                  categoryFilter === 'general'
                    ? 'bg-white text-amber-900 shadow-xs font-black'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                📦 Insumos
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('sodas')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition cursor-pointer text-center ${
                  categoryFilter === 'sodas'
                    ? 'bg-white text-indigo-900 shadow-xs font-black'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                🥤 Sodas
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('chemicals')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition cursor-pointer text-center ${
                  categoryFilter === 'chemicals'
                    ? 'bg-white text-emerald-900 shadow-xs font-black'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                🧪 Químicos
              </button>
            </div>
          </div>

          {/* Buscador */}
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
              Buscar Orden, Comprador o Enlace
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por número Wxxxxxx, comprador o PO..."
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

        {/* Tabla de Órdenes */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          {loading ? (
            <div className="py-20 text-center text-slate-400">
              <History className="w-10 h-10 mx-auto animate-spin mb-3 text-amber-500" />
              <p className="font-bold text-slate-600">Cargando órdenes de Viele & Sons...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-20 text-center text-slate-400">
              <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="text-base font-bold text-slate-700">No se encontraron órdenes registradas.</p>
              <p className="text-xs text-slate-400 mt-1">Los pedidos guardados o enviados aparecerán en este panel.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                    <th className="py-3.5 px-4 text-center">No. Factura / Orden</th>
                    <th className="py-3.5 px-4 text-center">Tipo Factura</th>
                    <th className="py-3.5 px-4">Sucursal</th>
                    <th className="py-3.5 px-4 text-center">Fecha Pedido</th>
                    <th className="py-3.5 px-4 text-center">Fecha Entrega</th>
                    <th className="py-3.5 px-4">Comprador</th>
                    <th className="py-3.5 px-4 text-center">Cajas</th>
                    <th className="py-3.5 px-4 text-right">Importe Total</th>
                    <th className="py-3.5 px-4 text-center">Estado</th>
                    <th className="py-3.5 px-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map(order => {
                    const storeAccount = VIELE_STORE_ACCOUNTS[order.store_id];
                    const isConfirmed = order.status === 'confirmed';
                    const isSoda = order.order_category === 'sodas';

                    return (
                      <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 text-center font-mono font-black text-amber-800">
                          <div>
                            {order.order_number || `#${order.id}`}
                          </div>
                          {order.linked_order_number && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const twinOrder = orders.find(o => o.order_number === order.linked_order_number);
                                if (twinOrder) handleViewDetail(twinOrder.id);
                              }}
                              className="text-[10px] text-indigo-500 hover:text-indigo-700 font-mono block mt-0.5 underline cursor-pointer transition-colors"
                              title="Ver factura gemela"
                            >
                              🔗 {order.linked_order_number}
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isSoda ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <span>🥤</span> Sodas (BIB)
                            </span>
                          ) : order.order_category === 'chemicals' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <span>🧪</span> Químicos
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              <span>📦</span> Insumos
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <strong className="text-slate-900 block">
                            🌮 {storeAccount?.storeName || `Tienda #${order.store_id}`}
                          </strong>
                          <span className="text-xs text-slate-500 font-mono">
                            Sage: {storeAccount?.sageCustomerCode || '00ELG'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-700 text-xs font-semibold">
                          {formatUsDate(order.order_date)}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-emerald-700 font-bold text-xs">
                          {formatUsDate(order.ship_date)}
                        </td>
                        <td className="py-3 px-4 text-slate-700 text-xs font-bold">
                          {order.buyer_name}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-black text-amber-800">
                          {order.total_cases}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-black text-slate-900">
                          ${order.total_amount?.toFixed(2) || '0.00'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                            isConfirmed
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {isConfirmed ? (
                              <>
                                <CheckCircle className="w-3 h-3" />
                                Confirmado
                              </>
                            ) : (
                              'Borrador'
                            )}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => handleViewDetail(order.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition border border-slate-200 shadow-sm cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5 text-blue-600" />
                            Ver Desglose
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
      </div>

      {/* Modal Desplegable de Detalle de la Orden */}
      {selectedOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 text-slate-900">
            {/* Header del Modal */}
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div className="flex items-center gap-3">
                <span className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-200 shadow-sm">
                  <FileText className="w-5 h-5" />
                </span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                      Orden: <span className="text-amber-800 font-mono">{orderDetail?.order.order_number || `#${selectedOrderId}`}</span>
                    </h3>
                    {orderDetail?.order.order_category === 'sodas' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        <span>🥤</span> Factura Sodas (BIB)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        <span>📦</span> Factura Insumos
                      </span>
                    )}
                  </div>
                  {orderDetail?.order.linked_order_number && (
                    <button
                      onClick={() => {
                        const twinOrder = orders.find(o => o.order_number === orderDetail.order.linked_order_number);
                        if (twinOrder) handleViewDetail(twinOrder.id);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-mono mt-0.5 font-bold underline cursor-pointer transition-colors"
                    >
                      🔗 Factura gemela correlativa: <strong>{orderDetail.order.linked_order_number}</strong> → Ver detalle
                    </button>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setSelectedOrderId(null); setOrderDetail(null); }}
                className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Contenido del Modal */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {loadingDetail ? (
                <div className="py-12 text-center text-slate-400">
                  <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Cargando líneas del pedido...
                </div>
              ) : orderDetail ? (
                <>
                  {/* Resumen Superior */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-500 font-bold block">Sucursal:</span>
                      <strong className="text-slate-900 text-sm">
                        {VIELE_STORE_ACCOUNTS[orderDetail.order.store_id]?.storeName} (#{orderDetail.order.store_id})
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 font-bold block">Fecha Entrega (USA):</span>
                      <strong className="text-emerald-700 font-mono text-sm">{formatUsDate(orderDetail.order.ship_date)}</strong>
                      <span className="block text-[10px] text-slate-500">{formatUsFullDate(orderDetail.order.ship_date, 'en-US')}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-bold block">Total Cajas:</span>
                      <strong className="text-amber-800 font-mono text-sm">{orderDetail.order.total_cases}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 font-bold block">Total Facturado:</span>
                      <strong className="text-slate-900 font-mono text-sm">${orderDetail.order.total_amount?.toFixed(2)}</strong>
                    </div>
                  </div>

                  {/* Tabla de Productos */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200">
                          <th className="py-2.5 px-3">SKU</th>
                          <th className="py-2.5 px-3">Descripción</th>
                          <th className="py-2.5 px-3 text-center">PAR</th>
                          <th className="py-2.5 px-3 text-center">Sobrante</th>
                          <th className="py-2.5 px-3 text-center text-emerald-800">Pedido</th>
                          <th className="py-2.5 px-3 text-right">Precio</th>
                          <th className="py-2.5 px-3 text-right">Importe</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {orderDetail.items.map(item => (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="py-2 px-3 font-bold text-amber-800">{item.item_code}</td>
                            <td className="py-2 px-3 font-sans text-slate-800 font-medium">{item.description}</td>
                            <td className="py-2 px-3 text-center text-slate-600">{item.par_quantity}</td>
                            <td className="py-2 px-3 text-center text-slate-600">{item.leftover_quantity}</td>
                            <td className="py-2 px-3 text-center font-bold text-emerald-700 text-sm">{item.order_quantity}</td>
                            <td className="py-2 px-3 text-right text-slate-600">${item.unit_price.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right font-bold text-slate-900">${item.extended_amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>

            {/* Footer del Modal */}
            <div className="p-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => { setSelectedOrderId(null); setOrderDetail(null); }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VieleHistoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Cargando historial...</div>}>
      <OrderHistoryContent />
    </Suspense>
  );
}
