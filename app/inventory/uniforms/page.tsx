'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shirt, Package, ShoppingCart, ClipboardList, Truck, AlertTriangle, 
  CheckCircle, Search, Plus, Save, X, Settings, ArrowRight, RefreshCw,
  Building, DollarSign, Activity, AlertCircle, Edit2, RotateCcw
} from 'lucide-react';
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute';
import { useLanguage } from '@/lib/i18n';
import {
  fetchUniformsPricing, fetchUniformsStock, saveInitialCount,
  saveManualAudit, recordUniformSale, recordNewHirePackage,
  recordDamageExchange, fetchTransactionHistory, fetchEmployeeKardex,
  fetchExecutiveDashboard, updateUniformPricing, fetchDailySalesTotal,
  confirmOrderReception, resetInitialCount, fetchQBEstimateForReception,
  fetchRecentStoreEstimates, fetchEmployeesForStore,
  updateUniformTransactionDetails, voidUniformTransaction,
  updateUniformMinStock, updateSingleUniformStock
} from './actions';
import {
  UniformCategory, UniformSize, SIZES_BY_CATEGORY, NEW_HIRE_PACKAGE,
  CATEGORY_GROUPS, PricingRecord, StockItem, UniformTransaction,
  ExecutiveDashboardData, getBusinessDate, formatCurrency, getCategoryDisplayName,
  getTransactionTypeLabel, ALL_CATEGORIES, ExecutiveStoreData, TransactionType,
  getDefaultMinStock, DEFAULT_MIN_STOCK
} from './utils';

/**
 * @module UniformsPage
 * @description Módulo de Control de Inventario y Entrega de Uniformes para Tacos Gavilan.
 * @businessRules
 * - Gerentes y Asistentes operan su tienda asignada. Admins y Supervisores ven tablero global (15 tiendas).
 * - Primera vez en una tienda muestra el Asistente de Conteo Inicial (Setup Wizard).
 * - 4 pestañas: Stock y Auditoría, Ventas y Entregas, Recepción de Órdenes, Historial y Kardex.
 * - Permite reiniciar el conteo inicial con confirmación explícita.
 * @dataFlow Cliente (React) <-> Server Actions <-> Supabase DB
 * @notes i18n 100% bilingüe (es/en) usando useLanguage().
 */

export default function UniformsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager', 'asistente']}>
      <UniformsContent />
    </ProtectedRoute>
  );
}

function UniformsContent() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  
  const isExecutive = user?.role === 'admin' || user?.role === 'supervisor';
  
  const [stores, setStores] = useState<{id: number, name: string}[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'stock' | 'sales' | 'reception' | 'history'>('stock');
  
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [stockData, setStockData] = useState<StockItem[]>([]);
  const [pricingData, setPricingData] = useState<PricingRecord[]>([]);
  
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error' | 'warning'} | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Accessible stores: Supervisors/Admins see all stores, Managers/Asistentes see ONLY their assigned store
  const accessibleStores = useMemo(() => {
    if (isExecutive) return stores;
    if (!user) return [];
    const userStoreIds = [
      ...(user.store_ids || []),
      ...(user.store_id ? [user.store_id] : []),
      ...(user.store_scope || [])
    ].map(id => String(id));

    const filtered = stores.filter(s => userStoreIds.includes(String(s.id)));
    return filtered.length > 0 ? filtered : (user?.store_id ? stores.filter(s => String(s.id) === String(user.store_id)) : []);
  }, [stores, user, isExecutive]);

  // Fetch stores and pricing on mount
  useEffect(() => {
    const initData = async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem('teg_token');
        const res = await fetch('/api/stores', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (Array.isArray(data)) {
          const storeList = data.map((s: any) => ({ id: s.id, name: s.name }));
          setStores(storeList);
          
          if (!isExecutive && user) {
            const userStoreIds = [
              ...(user.store_ids || []),
              ...(user.store_id ? [user.store_id] : []),
              ...(user.store_scope || [])
            ].map(id => String(id));
            const userStore = storeList.find(s => userStoreIds.includes(String(s.id)));
            if (userStore) {
              setSelectedStoreId(userStore.id);
            } else if (storeList.length > 0) {
              setSelectedStoreId(storeList[0].id);
            }
          } else if (storeList.length > 0) {
            setSelectedStoreId(storeList[0].id);
          }
        }

        const pricing = await fetchUniformsPricing();
        setPricingData(pricing);
      } catch (err) {
        showToast(t('uniforms.toast.error'), 'error');
      } finally {
        setLoading(false);
      }
    };
    initData();
  }, [isExecutive, t, user]);

  // Keep selectedStoreId strictly synchronized to manager's assigned store
  useEffect(() => {
    if (!isExecutive && accessibleStores.length > 0) {
      if (!selectedStoreId || !accessibleStores.some(s => s.id === selectedStoreId)) {
        setSelectedStoreId(accessibleStores[0].id);
      }
    }
  }, [isExecutive, accessibleStores, selectedStoreId]);

  // Load stock when selectedStoreId changes
  useEffect(() => {
    const loadStoreStock = async () => {
      if (!selectedStoreId) return;
      
      try {
        setLoading(true);
        const stock = await fetchUniformsStock(selectedStoreId);
        setStockData(stock);
        
        if (stock.length === 0) {
          setNeedsSetup(true);
        } else {
          setNeedsSetup(false);
        }
      } catch (err) {
        showToast(t('uniforms.toast.error'), 'error');
      } finally {
        setLoading(false);
      }
    };
    loadStoreStock();
  }, [selectedStoreId, t]);

  const handleSetupComplete = async () => {
    if (selectedStoreId) {
      const stock = await fetchUniformsStock(selectedStoreId);
      setStockData(stock);
      setNeedsSetup(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 font-sans">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-20 right-6 z-[99999] px-6 py-4 rounded-xl shadow-2xl text-white font-medium flex items-center gap-3 border border-white/20
              ${toast.type === 'success' ? 'bg-emerald-600' : toast.type === 'error' ? 'bg-rose-600' : 'bg-amber-500'}`}
          >
            {toast.type === 'success' && <CheckCircle className="w-5 h-5" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5" />}
            {toast.type === 'warning' && <AlertTriangle className="w-5 h-5" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shirt className="w-7 h-7 text-blue-500" />
              {t('uniforms.title')}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {t('uniforms.subtitle')}
            </p>
          </div>

          {/* Store Display (Single store for Managers / Asistentes) or Selector (for Admins / Supervisors) */}
          <div className="flex items-center gap-3">
            {isExecutive || accessibleStores.length > 1 ? (
              <div className="flex items-center gap-2">
                <Building className="w-5 h-5 text-gray-400" />
                <select
                  className="bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-xl px-4 py-2 font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                  value={selectedStoreId || ''}
                  onChange={(e) => setSelectedStoreId(Number(e.target.value))}
                >
                  {accessibleStores.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : accessibleStores.length === 1 ? (
              <div className="flex items-center gap-2.5 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl shadow-sm">
                <Building className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <div className="flex flex-col text-left">
                  <span className="text-[10px] uppercase tracking-wider font-extrabold text-blue-600 dark:text-blue-400">
                    {t('uniforms.assigned_store')}
                  </span>
                  <span className="font-bold text-sm text-blue-950 dark:text-blue-100">
                    {accessibleStores[0].name}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="flex items-center justify-center p-20">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : needsSetup && selectedStoreId ? (
          <SetupWizard 
            storeId={selectedStoreId} 
            onComplete={handleSetupComplete} 
            showToast={showToast} 
          />
        ) : selectedStoreId ? (
          <div className="space-y-6">
            {/* Tabs Bar */}
            <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
              <TabButton
                active={activeTab === 'stock'}
                onClick={() => setActiveTab('stock')}
                icon={<Package className="w-4 h-4" />}
                label={t('uniforms.tabs.stock')}
              />
              <TabButton
                active={activeTab === 'sales'}
                onClick={() => setActiveTab('sales')}
                icon={<ShoppingCart className="w-4 h-4" />}
                label={t('uniforms.tabs.sales')}
              />
              <TabButton
                active={activeTab === 'reception'}
                onClick={() => setActiveTab('reception')}
                icon={<Truck className="w-4 h-4" />}
                label={t('uniforms.tabs.reception')}
              />
              <TabButton
                active={activeTab === 'history'}
                onClick={() => setActiveTab('history')}
                icon={<ClipboardList className="w-4 h-4" />}
                label={t('uniforms.tabs.history')}
              />
            </div>

            {/* Active Tab View */}
            <main>
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {activeTab === 'stock' && (
                    <TabStockAndAudit 
                      storeId={selectedStoreId}
                      stockData={stockData} 
                      setStockData={setStockData}
                      pricingData={pricingData}
                      setPricingData={setPricingData}
                      showToast={showToast}
                      isAdmin={user?.role === 'admin'}
                      setNeedsSetup={setNeedsSetup}
                    />
                  )}
                  {activeTab === 'sales' && (
                    <TabSalesAndIssues 
                      storeId={selectedStoreId}
                      stockData={stockData}
                      pricingData={pricingData}
                      showToast={showToast}
                      onTransactionComplete={() => {
                        fetchUniformsStock(selectedStoreId).then(setStockData);
                      }}
                    />
                  )}
                  {activeTab === 'reception' && (
                    <TabOrderReception 
                      storeId={selectedStoreId}
                      showToast={showToast}
                      onComplete={() => {
                        fetchUniformsStock(selectedStoreId).then(setStockData);
                      }}
                    />
                  )}
                  {activeTab === 'history' && (
                    <TabHistoryAndKardex 
                      storeId={selectedStoreId} 
                      showToast={showToast} 
                      onTransactionComplete={() => {
                        fetchUniformsStock(selectedStoreId).then(setStockData);
                      }} 
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        ) : (
          <div className="flex items-center justify-center p-20 text-gray-500">
            {t('uniforms.select_store')}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all whitespace-nowrap
        ${active 
          ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' 
          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
        }`}
    >
      {icon}
      {label}
    </button>
  );
}

// --- SUB-COMPONENTS ---

function SetupWizard({ storeId, onComplete, showToast }: { storeId: number, onComplete: () => void, showToast: any }) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const categories: UniformCategory[] = ALL_CATEGORIES;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const payload: Array<{item_category: string, size: string, quantity: number}> = [];
      
      categories.forEach(cat => {
        const sizes = SIZES_BY_CATEGORY[cat] || [];
        sizes.forEach(size => {
          const key = `${cat}:${size}`;
          const qty = counts[key] || 0;
          payload.push({ item_category: cat, size, quantity: qty });
        });
      });

      await saveInitialCount(storeId, payload, user?.email || '');
      showToast(t('uniforms.toast.initial_saved'), 'success');
      onComplete();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-sm max-w-4xl mx-auto">
      <div className="text-center max-w-xl mx-auto mb-8">
        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Shirt className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold mb-2">{t('uniforms.wizard.title')}</h2>
        <p className="text-gray-500 dark:text-gray-400">{t('uniforms.wizard.description')}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 gap-6">
          {categories.map(cat => {
            const sizes = SIZES_BY_CATEGORY[cat] || [];
            return (
              <div key={cat} className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-xl border border-gray-100 dark:border-gray-700">
                <h3 className="font-bold text-lg mb-4">{getCategoryDisplayName(cat, language as 'es' | 'en')}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                  {sizes.map(size => {
                    const key = `${cat}:${size}`;
                    return (
                      <div key={size} className="text-center">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">{size}</label>
                        <input
                          type="number"
                          min="0"
                          className="w-full text-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                          value={counts[key] || 0}
                          onChange={(e) => setCounts({
                            ...counts,
                            [key]: Math.max(0, parseInt(e.target.value) || 0)
                          })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-colors disabled:opacity-50"
          >
            {submitting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {t('uniforms.wizard.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function TabStockAndAudit({ storeId, stockData, setStockData, pricingData, setPricingData, showToast, isAdmin, setNeedsSetup }: any) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [auditMode, setAuditMode] = useState(false);
  const [editedStock, setEditedStock] = useState<Record<string | number, number>>({});
  const [auditReason, setAuditReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [showMinStockModal, setShowMinStockModal] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);

  const isSupervisorOrAdmin = isAdmin || user?.role === 'supervisor';

  const fullStockData = useMemo(() => {
    const existingMap = new Map<string, any>();
    (stockData || []).forEach((item: any) => {
      existingMap.set(`${item.item_category}:${item.size}`, item);
    });

    const fullList: any[] = [];
    ALL_CATEGORIES.forEach(cat => {
      const sizes = SIZES_BY_CATEGORY[cat] || [];
      sizes.forEach(size => {
        const key = `${cat}:${size}`;
        if (existingMap.has(key)) {
          const item = existingMap.get(key);
          const defaultMin = getDefaultMinStock(cat, size);
          fullList.push({
            ...item,
            min_stock: (item.min_stock !== null && item.min_stock !== undefined) ? item.min_stock : defaultMin
          });
        } else {
          const defaultMin = getDefaultMinStock(cat, size);
          fullList.push({
            id: `virtual-${cat}-${size}`,
            store_id: storeId,
            item_category: cat,
            size,
            quantity_on_hand: 0,
            min_stock: defaultMin,
            updated_at: new Date().toISOString(),
            display_name_es: getCategoryDisplayName(cat, 'es'),
            display_name_en: getCategoryDisplayName(cat, 'en')
          });
        }
      });
    });

    return fullList;
  }, [stockData, storeId]);

  const lowStockItems = useMemo(() => {
    return fullStockData.filter((item: any) => {
      const min = (item.min_stock !== null && item.min_stock !== undefined) ? item.min_stock : getDefaultMinStock(item.item_category, item.size);
      return min > 0 && item.quantity_on_hand <= min;
    });
  }, [fullStockData]);

  const handleSaveAudit = async () => {
    if (!auditReason.trim()) {
      showToast(t('uniforms.toast.error'), 'warning');
      return;
    }
    
    try {
      setSubmitting(true);
      const changes = Object.entries(editedStock).map(([idStr, newQty]) => {
        const item = fullStockData.find((s: any) => String(s.id) === String(idStr));
        if (!item) return null;
        return {
          item_category: item.item_category,
          size: item.size,
          newQty,
          reason: auditReason
        };
      }).filter((c): c is NonNullable<typeof c> => c !== null);

      if (changes.length === 0) {
        setAuditMode(false);
        return;
      }

      await saveManualAudit(storeId, changes, user?.email || '');
      
      const updatedStock = await fetchUniformsStock(storeId);
      setStockData(updatedStock);
      setAuditMode(false);
      setEditedStock({});
      setAuditReason('');
      showToast(t('uniforms.toast.audit_saved'), 'success');
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetInitial = async () => {
    if (window.confirm(t('uniforms.stock.reset_confirm'))) {
      try {
        setSubmitting(true);
        await resetInitialCount(storeId, user?.email || '');
        showToast(t('uniforms.toast.reset_success'), 'success');
        setStockData([]);
        if (setNeedsSetup) setNeedsSetup(true);
      } catch (err) {
        showToast(t('uniforms.toast.error'), 'error');
      } finally {
        setSubmitting(false);
      }
    }
  };

  const renderGroup = (title: string, items: StockItem[]) => {
    return (
      <div className="mb-8 last:mb-0">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span>
          {title}
        </h3>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="p-4 font-semibold">{t('uniforms.stock.item')}</th>
              <th className="p-4 font-semibold">{t('uniforms.stock.size')}</th>
              <th className="p-4 font-semibold">{t('uniforms.stock.qty_on_hand')}</th>
              <th className="p-4 font-semibold">{t('uniforms.stock.min_stock')}</th>
              <th className="p-4 font-semibold">{t('uniforms.stock.status')}</th>
              {isSupervisorOrAdmin && (
                <th className="p-4 font-semibold text-right">{t('uniforms.stock.actions')}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {items.map(item => {
              const qty = auditMode && editedStock[item.id] !== undefined ? editedStock[item.id] : item.quantity_on_hand;
              const min = (item.min_stock !== null && item.min_stock !== undefined) ? item.min_stock : getDefaultMinStock(item.item_category, item.size);
              const isLow = min > 0 && qty < min && qty > 0;
              const isOut = min > 0 ? qty <= 0 : false;

              const rowBgClass = isOut
                ? 'bg-red-50/70 dark:bg-red-950/20 hover:bg-red-100/70'
                : isLow
                ? 'bg-amber-50/70 dark:bg-amber-950/20 hover:bg-amber-100/70'
                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50';

              return (
                <tr key={item.id} className={`${rowBgClass} transition-colors`}>
                  <td className="p-4 font-medium flex items-center gap-2">
                    <span>{getCategoryDisplayName(item.item_category, language as 'es' | 'en')}</span>
                  </td>
                  <td className="p-4">
                    <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded-md text-xs font-semibold">
                      {item.size}
                    </span>
                  </td>
                  <td className="p-4 font-bold">
                    {auditMode ? (
                      <input
                        type="number"
                        min="0"
                        className="w-20 px-2 py-1 bg-white dark:bg-gray-900 border border-blue-500 rounded-md outline-none"
                        value={qty}
                        onChange={(e) => setEditedStock({
                          ...editedStock,
                          [item.id]: Math.max(0, parseInt(e.target.value) || 0)
                        })}
                      />
                    ) : (
                      <span className={isOut ? 'text-red-600 dark:text-red-400 font-black' : isLow ? 'text-amber-600 dark:text-amber-400 font-black' : ''}>
                        {qty}
                      </span>
                    )}
                  </td>
                  <td className="p-4 font-semibold text-gray-600 dark:text-gray-400">
                    <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-bold">
                      {min}
                    </span>
                  </td>
                  <td className="p-4">
                    {isOut ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-extrabold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border border-red-200 dark:border-red-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
                        {language === 'en' ? '🔴 Out of Stock' : '🔴 Agotado'}
                      </span>
                    ) : isLow ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        {language === 'en' ? `⚠️ Low Stock (Min: ${min})` : `⚠️ Stock Bajo (Mín: ${min})`}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> {t('uniforms.stock.ok')}
                      </span>
                    )}
                  </td>
                  {isSupervisorOrAdmin && (
                    <td className="p-4 text-right">
                      <button
                        onClick={() => setEditingItem(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-bold transition-all shadow-sm"
                        title={t('uniforms.stock.edit_item')}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>{t('uniforms.stock.edit_btn')}</span>
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

  return (
    <div>
      {/* ⚠️ REORDER ALERT BANNER FOR BODEGA REPLENISHMENT */}
      {lowStockItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 md:p-5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-2 border-amber-400/80 dark:border-amber-600/80 rounded-2xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-md mt-0.5">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="font-extrabold text-amber-900 dark:text-amber-100 text-base md:text-lg flex items-center gap-2">
                <span>{t('uniforms.stock.replenishment_alert')}</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100 border border-amber-300 dark:border-amber-700">
                  {lowStockItems.length} {lowStockItems.length === 1 ? 'prenda en mínimo' : 'prendas en mínimo'}
                </span>
              </h3>
              <p className="text-sm text-amber-800 dark:text-amber-200/90 mt-0.5 font-medium">
                {t('uniforms.stock.replenishment_desc')}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
            <button
              onClick={() => setShowReorderModal(true)}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <Package className="w-4 h-4" />
              <span>{t('uniforms.stock.request_replenishment')}</span>
            </button>
          </div>
        </motion.div>
      )}

      <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
        <h2 className="text-xl font-bold">{t('uniforms.stock.title')}</h2>
        {(isAdmin || user?.role === 'supervisor') && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMinStockModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 dark:text-amber-300 rounded-lg font-medium transition-colors border border-amber-200 dark:border-amber-800"
            >
              <Settings className="w-4 h-4" />
              <span>{t('uniforms.stock.edit_min_stock')}</span>
            </button>

            {isAdmin && (
              <>
                <button
                  onClick={() => setShowPricingModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors"
                >
                  <DollarSign className="w-4 h-4" />
                  {t('uniforms.stock.edit_pricing')}
                </button>

                <button
                  onClick={handleResetInitial}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-300 rounded-lg font-medium transition-colors border border-red-200 dark:border-red-800"
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('uniforms.stock.reset_initial')}
                </button>
              </>
            )}
            
            {auditMode ? (
              <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg border border-blue-100 dark:border-blue-800">
                <input
                  type="text"
                  placeholder={t('uniforms.stock.reason')}
                  className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 text-sm w-48"
                  value={auditReason}
                  onChange={(e) => setAuditReason(e.target.value)}
                />
                <button
                  onClick={() => { setAuditMode(false); setEditedStock({}); setAuditReason(''); }}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm font-medium"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveAudit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {t('uniforms.stock.save_audit')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAuditMode(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors shadow-sm"
              >
                <Edit2 className="w-4 h-4" />
                {t('uniforms.stock.audit_mode')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-8">
        {renderGroup('Team Members Red (Equipo)', fullStockData.filter((i: any) => CATEGORY_GROUPS.RED_TEAM.includes(i.item_category)))}
        {renderGroup('Shift Leader Black', fullStockData.filter((i: any) => CATEGORY_GROUPS.SHIFT_LEADER.includes(i.item_category)))}
        {renderGroup('Assistant Manager Polo Black', fullStockData.filter((i: any) => CATEGORY_GROUPS.ASSISTANT_MANAGER.includes(i.item_category)))}
        {renderGroup('Camisa Store Manager Negra (Regalía $0.00)', fullStockData.filter((i: any) => CATEGORY_GROUPS.STORE_MANAGER.includes(i.item_category)))}
        {renderGroup('Gorras & Chamarras Negras', fullStockData.filter((i: any) => CATEGORY_GROUPS.BLACK_ACCESSORIES.includes(i.item_category)))}
      </div>

      {showPricingModal && (
        <PricingModal 
          onClose={() => setShowPricingModal(false)}
          pricingData={pricingData}
          setPricingData={setPricingData}
          showToast={showToast}
        />
      )}

      {showReorderModal && (
        <ReorderModal
          onClose={() => setShowReorderModal(false)}
          lowStockItems={lowStockItems}
        />
      )}

      {showMinStockModal && (
        <MinStockModal
          storeId={storeId}
          fullStockData={fullStockData}
          onClose={() => setShowMinStockModal(false)}
          onSaveSuccess={async () => {
            const updated = await fetchUniformsStock(storeId);
            setStockData(updated);
          }}
          showToast={showToast}
        />
      )}

      {editingItem && (
        <EditItemStockModal
          item={editingItem}
          storeId={storeId}
          onClose={() => setEditingItem(null)}
          onSaveSuccess={async () => {
            const updated = await fetchUniformsStock(storeId);
            setStockData(updated);
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function EditItemStockModal({ 
  item, 
  storeId, 
  onClose, 
  onSaveSuccess, 
  showToast 
}: { 
  item: StockItem, 
  storeId: number, 
  onClose: () => void, 
  onSaveSuccess: () => Promise<void> | void, 
  showToast: (msg: string, type?: string) => void 
}) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [newQty, setNewQty] = useState<number>(item.quantity_on_hand || 0);
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const prevQty = item.quantity_on_hand || 0;
  const diff = newQty - prevQty;

  const quickReasons = [
    t('uniforms.stock.reason_physical_count'),
    t('uniforms.stock.reason_correction'),
    t('uniforms.stock.reason_damage'),
    t('uniforms.stock.reason_supervisor_adj')
  ];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      showToast(t('uniforms.toast.error'), 'warning');
      return;
    }

    try {
      setSubmitting(true);
      await updateSingleUniformStock({
        storeId,
        item_category: item.item_category,
        size: item.size,
        newQty,
        reason: reason.trim(),
        userEmail: user?.email || ''
      });

      showToast(t('uniforms.stock.item_stock_updated'), 'success');
      await onSaveSuccess();
      onClose();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col space-y-5"
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
              <Edit2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {t('uniforms.stock.edit_item_modal_title')}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-semibold text-sm text-gray-700 dark:text-gray-300">
                  {getCategoryDisplayName(item.item_category, language as 'es'|'en')}
                </span>
                <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-bold font-mono">
                  {item.size}
                </span>
              </div>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700 text-sm">
            <div>
              <span className="text-xs text-gray-500 font-medium block">{t('uniforms.stock.current_stock_label')}</span>
              <span className="text-lg font-bold text-gray-900 dark:text-white">{prevQty} pzas</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-medium block">{t('uniforms.stock.min_stock')}</span>
              <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{item.min_stock} pzas</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              {t('uniforms.stock.new_qty_label')} *
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                required
                className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 font-bold text-lg"
                value={newQty}
                onChange={e => setNewQty(Math.max(0, parseInt(e.target.value) || 0))}
              />
              <div className={`px-3 py-2 rounded-xl text-xs font-black whitespace-nowrap border flex items-center gap-1
                ${diff > 0 
                  ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800' 
                  : diff < 0 
                  ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800' 
                  : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-300'}`}
              >
                <span>{diff > 0 ? `+${diff}` : diff} pzas</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              {t('uniforms.stock.reason_required')} *
            </label>
            <input
              type="text"
              required
              placeholder={t('uniforms.stock.reason_placeholder')}
              className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            <div className="mt-2">
              <span className="text-[11px] text-gray-400 font-semibold block mb-1">{t('uniforms.stock.quick_reasons')}</span>
              <div className="flex flex-wrap gap-1.5">
                {quickReasons.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-600 dark:hover:text-blue-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium text-sm transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors disabled:opacity-50"
            >
              {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t('uniforms.stock.save_adjustment')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function MinStockModal({ storeId, fullStockData, onClose, onSaveSuccess, showToast }: any) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [editedMinStock, setEditedMinStock] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const initialMap: Record<string, number> = {};
    (fullStockData || []).forEach((item: any) => {
      const key = `${item.item_category}:${item.size}`;
      const val = (item.min_stock !== undefined && item.min_stock !== null) ? item.min_stock : getDefaultMinStock(item.item_category, item.size);
      initialMap[key] = val;
    });
    setEditedMinStock(initialMap);
  }, [fullStockData]);

  const handleResetDefaults = () => {
    const resetMap: Record<string, number> = {};
    ALL_CATEGORIES.forEach(cat => {
      (SIZES_BY_CATEGORY[cat] || []).forEach(size => {
        resetMap[`${cat}:${size}`] = getDefaultMinStock(cat, size);
      });
    });
    setEditedMinStock(resetMap);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const updates = Object.entries(editedMinStock).map(([key, min_stock]) => {
        const [item_category, size] = key.split(':');
        return {
          item_category: item_category as UniformCategory,
          size: size as UniformSize,
          min_stock
        };
      });

      await updateUniformMinStock(storeId, updates, user?.email || '');
      showToast(t('uniforms.stock.min_stock_saved') || 'Metas de stock mínimo actualizadas exitosamente', 'success');
      await onSaveSuccess();
      onClose();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700 max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
              <Settings className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {t('uniforms.stock.min_stock_modal_title')}
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {t('uniforms.stock.global_scope_badge')}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('uniforms.stock.min_stock_desc')}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0">
          <div className="overflow-y-auto flex-1 mb-6 pr-2 space-y-6">
            {ALL_CATEGORIES.map(cat => {
              const sizes = SIZES_BY_CATEGORY[cat] || [];
              return (
                <div key={cat} className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                  <h4 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-3 flex items-center justify-between">
                    <span>{getCategoryDisplayName(cat, language as 'es' | 'en')}</span>
                    <span className="text-xs text-gray-400 font-normal">({sizes.length} tallas)</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                    {sizes.map(size => {
                      const key = `${cat}:${size}`;
                      const currentVal = editedMinStock[key] !== undefined ? editedMinStock[key] : getDefaultMinStock(cat, size);
                      const defaultVal = getDefaultMinStock(cat, size);
                      const isCustom = currentVal !== defaultVal;

                      return (
                        <div key={size} className="bg-white dark:bg-gray-800 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-bold text-gray-700 dark:text-gray-300">{size}</span>
                            <span className="text-[10px] text-gray-400" title="Estándar predeterminado">
                              def: {defaultVal}
                            </span>
                          </div>
                          <input 
                            type="number"
                            min={0}
                            max={999}
                            className={`w-full bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1 text-sm text-center font-extrabold outline-none focus:ring-2 focus:ring-amber-500 ${isCustom ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-gray-300 dark:border-gray-600'}`}
                            value={currentVal}
                            onChange={e => {
                              const val = Math.max(0, parseInt(e.target.value) || 0);
                              setEditedMinStock(prev => ({ ...prev, [key]: val }));
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 underline font-medium flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('uniforms.stock.reset_defaults')}</span>
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium text-sm transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
              >
                {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{t('uniforms.stock.save_min_stock')}</span>
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function PricingModal({ onClose, pricingData, setPricingData, showToast }: any) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const initial: Record<string, number> = {};
    pricingData.forEach((p: any) => {
      initial[p.item_category] = p.sale_price;
    });
    setPrices(initial);
  }, [pricingData]);

  const handleSave = async () => {
    try {
      setSubmitting(true);
      for (const [item_category, sale_price] of Object.entries(prices)) {
        const record = pricingData.find((p: any) => p.item_category === item_category);
        if (record) {
          await updateUniformPricing(record.id, { sale_price }, user?.email || '');
        }
      }
      const newPricing = await fetchUniformsPricing();
      setPricingData(newPricing);
      showToast(t('uniforms.toast.pricing_saved'), 'success');
      onClose();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-500" />
            {t('uniforms.pricing.title')}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {ALL_CATEGORIES.map(cat => (
            <div key={cat} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700">
              <span className="font-medium">{getCategoryDisplayName(cat, language as "es" | "en")}</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-24 pl-7 pr-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-right font-medium"
                  value={prices[cat] || 0}
                  onChange={(e) => setPrices(prev => ({...prev, [cat]: parseFloat(e.target.value) || 0}))}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-3 bg-gray-50 dark:bg-gray-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={submitting}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('common.save')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ReorderModal({ onClose, lowStockItems }: { onClose: () => void, lowStockItems: StockItem[] }) {
  const router = useRouter();
  const { t, language } = useLanguage();

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700 max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {t('uniforms.stock.reorder_modal_title')}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {language === 'en' 
                  ? 'The following items are at or below their configured minimum stock level.' 
                  : 'Las siguientes prendas están en o por debajo de su stock mínimo configurado.'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 mb-6 pr-1">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                <th className="p-3 font-semibold">{t('uniforms.stock.item')}</th>
                <th className="p-3 font-semibold">{t('uniforms.stock.size')}</th>
                <th className="p-3 font-semibold text-center">{t('uniforms.stock.qty_on_hand')}</th>
                <th className="p-3 font-semibold text-center">{t('uniforms.stock.min_stock')}</th>
                <th className="p-3 font-semibold text-center text-amber-600 dark:text-amber-400">
                  {t('uniforms.stock.suggested_order')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {lowStockItems.map(item => {
                const min = (item.min_stock !== null && item.min_stock !== undefined) ? item.min_stock : getDefaultMinStock(item.item_category, item.size);
                const suggested = min > 0 ? Math.max(1, (min * 2) - item.quantity_on_hand) : 0;
                const isOut = item.quantity_on_hand <= 0;

                return (
                  <tr key={item.id} className={isOut ? 'bg-red-50/50 dark:bg-red-950/20' : 'bg-amber-50/50 dark:bg-amber-950/20'}>
                    <td className="p-3 font-medium">
                      {getCategoryDisplayName(item.item_category, language as 'es' | 'en')}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs font-semibold">
                        {item.size}
                      </span>
                    </td>
                    <td className="p-3 text-center font-bold">
                      <span className={isOut ? 'text-red-600 dark:text-red-400 font-extrabold' : 'text-amber-600 dark:text-amber-400 font-extrabold'}>
                        {item.quantity_on_hand}
                      </span>
                    </td>
                    <td className="p-3 text-center text-gray-500 font-medium">
                      {min}
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-2.5 py-1 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 rounded-full font-bold text-xs">
                        +{suggested} pza
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {language === 'en'
              ? 'Replenishment orders are processed via La Bodega.'
              : 'Las solicitudes de reposición se procesan desde el módulo de Órdenes a Bodega.'}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium text-sm transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                onClose();
                router.push('/inventory/orders?type=uniforms');
              }}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2"
            >
              <Truck className="w-4 h-4" />
              <span>{t('uniforms.stock.go_to_bodega_orders')}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function TabSalesAndIssues({ storeId, stockData, pricingData, showToast, onTransactionComplete }: any) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [empName, setEmpName] = useState('');
  const [empGuid, setEmpGuid] = useState('');
  const [employeeList, setEmployeeList] = useState<Array<{id: string, name: string, toast_guid: string, job_title?: string}>>([]);
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');
  const [isCustomNameMode, setIsCustomNameMode] = useState(false);
  const [txType, setTxType] = useState<'sale' | 'customer_sale' | 'new_hire' | 'damage'>('sale');
  const [saleNotes, setSaleNotes] = useState('');

  // Flexible Package State (Entrega / Asignación / Nuevo Ingreso)
  const [pkgShirtCategory, setPkgShirtCategory] = useState<UniformCategory>('shirt_red');
  const [pkgShirtSize, setPkgShirtSize] = useState<UniformSize>('M');
  const [pkgShirtQty, setPkgShirtQty] = useState<number>(6);

  const [pkgIncludeCap, setPkgIncludeCap] = useState<boolean>(true);
  const [pkgCapCategory, setPkgCapCategory] = useState<UniformCategory>('cap_red');
  const [pkgCapQty, setPkgCapQty] = useState<number>(1);

  const [pkgIncludeJacket, setPkgIncludeJacket] = useState<boolean>(true);
  const [pkgJacketCategory, setPkgJacketCategory] = useState<UniformCategory>('jacket_red');
  const [pkgJacketSize, setPkgJacketSize] = useState<UniformSize>('M');
  const [pkgJacketQty, setPkgJacketQty] = useState<number>(1);

  const applyRoleDefaults = (emp: {id: string, name: string, toast_guid: string, job_title?: string}) => {
    const job = (emp.job_title || '').toLowerCase();
    if (job.includes('manager') && !job.includes('asst')) {
      setPkgShirtCategory('shirt_manager');
      setPkgCapCategory('cap_black');
      setPkgJacketCategory('jacket_black');
      setPkgIncludeJacket(false);
    } else if (job.includes('asst')) {
      setPkgShirtCategory('shirt_assistant');
      setPkgCapCategory('cap_black');
      setPkgJacketCategory('jacket_black');
      setPkgIncludeJacket(false);
    } else if (job.includes('shift leader')) {
      setPkgShirtCategory('shirt_shift_leader');
      setPkgCapCategory('cap_black');
      setPkgJacketCategory('jacket_black');
      setPkgIncludeJacket(true);
    } else {
      setPkgShirtCategory('shirt_red');
      setPkgCapCategory('cap_red');
      setPkgJacketCategory('jacket_red');
      setPkgIncludeJacket(true);
    }
  };

  useEffect(() => {
    fetchEmployeesForStore(storeId).then(emps => {
      setEmployeeList(emps);
      if (emps.length > 0 && !isCustomNameMode) {
        setSelectedEmpId(emps[0].id);
        setEmpName(emps[0].name);
        setEmpGuid(emps[0].toast_guid);
        applyRoleDefaults(emps[0]);
      }
    }).catch(console.error);
  }, [storeId]);

  const handleEmployeeSelect = (empId: string) => {
    setSelectedEmpId(empId);
    const found = employeeList.find(x => x.id === empId);
    if (found) {
      setEmpName(found.name);
      setEmpGuid(found.toast_guid);
      applyRoleDefaults(found);
    }
  };

  const handleTxTypeChange = (newType: 'sale' | 'customer_sale' | 'new_hire' | 'damage') => {
    setTxType(newType);
    if (newType === 'customer_sale') {
      setIsCustomNameMode(true);
      if (!empName || empName.trim() === '' || employeeList.some(e => e.name === empName)) {
        setEmpName('Cliente Mostrador');
      }
      setEmpGuid('');
    } else if (newType === 'sale' || newType === 'new_hire') {
      const isDefaultCustomer = empName === 'Cliente Mostrador' || empName === 'Counter Customer' || empName === t('uniforms.sales.counter_customer');
      if (employeeList.length > 0 && isCustomNameMode && isDefaultCustomer) {
        setIsCustomNameMode(false);
        setSelectedEmpId(employeeList[0].id);
        setEmpName(employeeList[0].name);
        setEmpGuid(employeeList[0].toast_guid);
        applyRoleDefaults(employeeList[0]);
      }
    }
  };

  const handlePkgShirtCategoryChange = (newCat: UniformCategory) => {
    setPkgShirtCategory(newCat);
    if (newCat === 'shirt_assistant' || newCat === 'shirt_manager' || newCat === 'shirt_shift_leader') {
      setPkgCapCategory('cap_black');
      setPkgJacketCategory('jacket_black');
    } else if (newCat === 'shirt_red') {
      setPkgCapCategory('cap_red');
      setPkgJacketCategory('jacket_red');
    }
  };
  
  // Sale specific
  const [saleCategory, setSaleCategory] = useState<UniformCategory>('shirt_red');
  const [saleSize, setSaleSize] = useState<UniformSize>('M');
  const [saleQty, setSaleQty] = useState(1);
  
  // Damage specific
  const [damageReason, setDamageReason] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const selectedEmp = employeeList.find(x => x.id === selectedEmpId);
  const selectedJobTitle = selectedEmp?.job_title || '';

  const [todaySalesTotal, setTodaySalesTotal] = useState<number>(0);

  const loadTodaySales = () => {
    if (storeId) {
      fetchDailySalesTotal(storeId, getBusinessDate())
        .then(setTodaySalesTotal)
        .catch(() => setTodaySalesTotal(0));
    }
  };

  useEffect(() => {
    loadTodaySales();
  }, [storeId]);

  const isExempt = useMemo(() => {
    if (txType === 'customer_sale' || isCustomNameMode) return false;
    const p = pricingData.find((x: any) => x.item_category === saleCategory);
    if (!p || !p.is_free_for_roles || !Array.isArray(p.is_free_for_roles) || p.is_free_for_roles.length === 0) return false;
    const jobLower = (selectedJobTitle || '').toLowerCase().trim();
    return p.is_free_for_roles.some((role: string) => {
      const rLower = role.toLowerCase().trim();
      return rLower.length > 0 && jobLower.includes(rLower);
    });
  }, [txType, isCustomNameMode, pricingData, saleCategory, selectedJobTitle]);

  const currentPrice = useMemo(() => {
    if (txType === 'sale' || txType === 'customer_sale') {
      if (isExempt) return 0;
      const p = pricingData.find((x: any) => x.item_category === saleCategory)?.sale_price || 0;
      return p * saleQty;
    }
    return 0;
  }, [txType, saleCategory, saleQty, pricingData, isExempt]);

  const availableStock = useMemo(() => {
    if (txType === 'sale' || txType === 'customer_sale' || txType === 'damage') {
      return stockData.find((s: any) => s.item_category === saleCategory && s.size === saleSize)?.quantity_on_hand || 0;
    }
    return null;
  }, [txType, saleCategory, saleSize, stockData]);

  // Stock helpers for package delivery form
  const pkgShirtStock = useMemo(() => {
    return stockData.find((s: any) => s.item_category === pkgShirtCategory && s.size === pkgShirtSize)?.quantity_on_hand || 0;
  }, [stockData, pkgShirtCategory, pkgShirtSize]);

  const pkgCapStock = useMemo(() => {
    return stockData.find((s: any) => s.item_category === pkgCapCategory && s.size === 'ONE_SIZE')?.quantity_on_hand || 0;
  }, [stockData, pkgCapCategory]);

  const pkgJacketStock = useMemo(() => {
    return stockData.find((s: any) => s.item_category === pkgJacketCategory && s.size === pkgJacketSize)?.quantity_on_hand || 0;
  }, [stockData, pkgJacketCategory, pkgJacketSize]);

  // Auto-clamp package quantities if stock changes or category/size changes
  useEffect(() => {
    if (txType === 'new_hire') {
      if (pkgShirtStock === 0) {
        setPkgShirtQty(0);
      } else if (pkgShirtQty > pkgShirtStock || pkgShirtQty === 0) {
        setPkgShirtQty(Math.min(6, pkgShirtStock));
      }
    }
  }, [pkgShirtStock, txType]);

  useEffect(() => {
    if (txType === 'new_hire' && pkgIncludeCap) {
      if (pkgCapStock === 0) {
        setPkgCapQty(0);
      } else if (pkgCapQty > pkgCapStock || pkgCapQty === 0) {
        setPkgCapQty(Math.min(1, pkgCapStock));
      }
    }
  }, [pkgCapStock, pkgIncludeCap, txType]);

  useEffect(() => {
    if (txType === 'new_hire' && pkgIncludeJacket) {
      if (pkgJacketStock === 0) {
        setPkgJacketQty(0);
      } else if (pkgJacketQty > pkgJacketStock || pkgJacketQty === 0) {
        setPkgJacketQty(Math.min(1, pkgJacketStock));
      }
    }
  }, [pkgJacketStock, pkgIncludeJacket, txType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim()) {
      showToast(t('uniforms.toast.error'), 'warning');
      return;
    }

    try {
      setSubmitting(true);
      if (txType === 'sale' || txType === 'customer_sale') {
        if (availableStock !== null && availableStock < saleQty) {
           showToast(t('uniforms.toast.no_stock'), 'error');
           setSubmitting(false);
           return;
        }
        await recordUniformSale({ 
          storeId, 
          userEmail: user?.email || '',
          employeeName: empName,
          employeeToastGuid: empGuid || undefined,
          employeeJobTitle: isCustomNameMode ? undefined : selectedJobTitle,
          transactionType: txType === 'customer_sale' ? 'customer_sale' : 'employee_sale',
          notes: saleNotes.trim() || undefined,
          item_category: saleCategory,
          size: saleSize,
          quantity: saleQty,
          businessDate: getBusinessDate()
        });
      } else if (txType === 'new_hire') {
        // Enforce strict stock limit validation before submitting
        if (pkgShirtQty > pkgShirtStock) {
          showToast(`No puedes entregar más de ${pkgShirtStock} camisas. Stock insuficiente.`, 'error');
          setSubmitting(false);
          return;
        }

        if (pkgIncludeCap && pkgCapQty > pkgCapStock) {
          showToast(`No puedes entregar más de ${pkgCapStock} gorras. Stock insuficiente.`, 'error');
          setSubmitting(false);
          return;
        }

        if (pkgIncludeJacket && pkgJacketQty > pkgJacketStock) {
          showToast(`No puedes entregar más de ${pkgJacketStock} chamarras. Stock insuficiente.`, 'error');
          setSubmitting(false);
          return;
        }

        const itemsToDeliver: Array<{ item_category: UniformCategory, size: UniformSize, quantity: number }> = [];

        if (pkgShirtQty > 0) {
          itemsToDeliver.push({
            item_category: pkgShirtCategory,
            size: pkgShirtSize,
            quantity: pkgShirtQty
          });
        }

        if (pkgIncludeCap && pkgCapQty > 0) {
          itemsToDeliver.push({
            item_category: pkgCapCategory,
            size: 'ONE_SIZE',
            quantity: pkgCapQty
          });
        }

        if (pkgIncludeJacket && pkgJacketQty > 0) {
          itemsToDeliver.push({
            item_category: pkgJacketCategory,
            size: pkgJacketSize,
            quantity: pkgJacketQty
          });
        }

        if (itemsToDeliver.length === 0) {
          showToast(t('uniforms.sales.error_min_items'), 'warning');
          setSubmitting(false);
          return;
        }

        const res = await recordNewHirePackage({ 
          storeId, 
          userEmail: user?.email || '',
          employeeName: empName,
          employeeToastGuid: empGuid || undefined,
          items: itemsToDeliver,
          businessDate: getBusinessDate()
        });

        const hasWarning = res.results.some(r => r.warning);
        if (hasWarning) {
          showToast(t('uniforms.sales.partial_delivery_warning'), 'warning');
        }
      } else if (txType === 'damage') {
        if (!damageReason.trim()) {
          showToast(t('uniforms.toast.error'), 'warning');
          setSubmitting(false);
          return;
        }
        if (saleQty <= 0) {
          showToast(t('uniforms.sales.error_valid_replacements'), 'warning');
          setSubmitting(false);
          return;
        }
        const res = await recordDamageExchange({ 
          storeId, 
          userEmail: user?.email || '',
          employeeName: empName,
          employeeToastGuid: empGuid || undefined,
          item_category: saleCategory,
          size: saleSize,
          quantity: saleQty,
          reason: damageReason + (saleNotes.trim() ? ` (${saleNotes.trim()})` : ''),
          businessDate: getBusinessDate()
        });
        if (res.warning) {
          showToast(res.warning, 'warning');
        }
      }
      
      showToast(t('uniforms.toast.sale_success'), 'success');
      loadTodaySales();

      // Reset form
      if (employeeList.length > 0 && !isCustomNameMode && txType !== 'customer_sale') {
        setSelectedEmpId(employeeList[0].id);
        setEmpName(employeeList[0].name);
        setEmpGuid(employeeList[0].toast_guid);
        applyRoleDefaults(employeeList[0]);
      } else if (txType === 'customer_sale') {
        setEmpName(t('uniforms.sales.counter_customer'));
        setEmpGuid('');
      } else {
        setEmpName('');
        setEmpGuid('');
      }
      setDamageReason('');
      setSaleNotes('');
      setSaleQty(1);
      onTransactionComplete();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center justify-between">
                  <span>
                    {txType === 'customer_sale' ? t('uniforms.sales.customer_name') : t('uniforms.sales.employee_name')} *
                  </span>
                  {txType !== 'customer_sale' && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomNameMode(!isCustomNameMode);
                        if (!isCustomNameMode) {
                          setEmpName('');
                          setEmpGuid('');
                        } else if (employeeList.length > 0) {
                          setSelectedEmpId(employeeList[0].id);
                          setEmpName(employeeList[0].name);
                          setEmpGuid(employeeList[0].toast_guid);
                          applyRoleDefaults(employeeList[0]);
                        }
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-normal"
                    >
                      {isCustomNameMode ? t('uniforms.sales.select_from_list') : t('uniforms.sales.enter_unregistered')}
                    </button>
                  )}
                </label>

                {(!isCustomNameMode && txType !== 'customer_sale') ? (
                  <select
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none font-medium text-sm"
                    value={selectedEmpId}
                    onChange={e => handleEmployeeSelect(e.target.value)}
                  >
                    {employeeList.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} {emp.job_title ? `(${emp.job_title})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    placeholder={txType === 'customer_sale' ? t('uniforms.sales.counter_customer') : t('uniforms.sales.placeholder_custom_name')}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
                    value={empName}
                    onChange={e => {
                      setEmpName(e.target.value);
                      setEmpGuid('');
                    }}
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('uniforms.sales.transaction_type')}
              </label>
              <div className="flex flex-wrap gap-3">
                {(['sale', 'customer_sale', 'new_hire', 'damage'] as const).map(type => (
                  <label 
                    key={type}
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl border cursor-pointer transition-all
                      ${txType === type 
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-semibold shadow-xs' 
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium'}`}
                  >
                    <input
                      type="radio"
                      name="txType"
                      className="hidden"
                      checked={txType === type}
                      onChange={() => handleTxTypeChange(type)}
                    />
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center
                      ${txType === type ? 'border-blue-500' : 'border-gray-400'}`}
                    >
                      {txType === type && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                    </div>
                    <span className="text-sm">{t(`uniforms.sales.type_${type}` as any)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-xl border border-gray-100 dark:border-gray-700">
              {txType === 'new_hire' ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3">
                    <h4 className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2 text-base">
                      <Package className="w-5 h-5" />
                      {t('uniforms.sales.new_hire_auto')}
                    </h4>
                    <span className="text-xs font-semibold px-2.5 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full">
                      {t('uniforms.sales.free_badge')}
                    </span>
                  </div>

                  {/* 1. SECCIÓN TORSO: Camisas / Polos */}
                  <div className="space-y-3 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                      1. {t('uniforms.sales.shirt_category')}
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          {t('uniforms.sales.category')}
                        </label>
                        <select 
                          className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium outline-none"
                          value={pkgShirtCategory}
                          onChange={e => handlePkgShirtCategoryChange(e.target.value as UniformCategory)}
                        >
                          <option value="shirt_red">{getCategoryDisplayName('shirt_red', language as "es" | "en")}</option>
                          <option value="shirt_shift_leader">{getCategoryDisplayName('shirt_shift_leader', language as "es" | "en")}</option>
                          <option value="shirt_assistant">{getCategoryDisplayName('shirt_assistant', language as "es" | "en")}</option>
                          <option value="shirt_manager">{getCategoryDisplayName('shirt_manager', language as "es" | "en")}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          {t('uniforms.sales.shirt_size')}
                        </label>
                        <select 
                          className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium outline-none"
                          value={pkgShirtSize}
                          onChange={e => setPkgShirtSize(e.target.value as UniformSize)}
                        >
                          {(SIZES_BY_CATEGORY[pkgShirtCategory] || []).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          {t('uniforms.sales.shirt_qty')}
                        </label>
                        <input
                          type="number"
                          min={pkgShirtStock > 0 ? 1 : 0}
                          max={pkgShirtStock}
                          disabled={pkgShirtStock === 0}
                          className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium outline-none disabled:opacity-50"
                          value={pkgShirtQty}
                          onChange={e => {
                            const raw = parseInt(e.target.value) || 0;
                            if (raw > pkgShirtStock) {
                              showToast(`El stock máximo disponible es de ${pkgShirtStock} piezas.`, 'warning');
                              setPkgShirtQty(pkgShirtStock);
                            } else {
                              setPkgShirtQty(Math.max(0, raw));
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 pt-1">
                      <span>{t('uniforms.sales.available_stock')}:</span>
                      <span className={`font-bold ${pkgShirtStock >= pkgShirtQty && pkgShirtStock > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {pkgShirtStock} {t('uniforms.stock.pieces_long')}
                      </span>
                    </div>
                  </div>

                  {/* 2. SECCIÓN GORRA */}
                  <div className="space-y-3 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pkgIncludeCap}
                          onChange={e => setPkgIncludeCap(e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          2. {t('uniforms.sales.include_cap')}
                        </span>
                      </label>
                    </div>

                    {pkgIncludeCap && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            {t('uniforms.sales.cap_category')}
                          </label>
                          <select 
                            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium outline-none"
                            value={pkgCapCategory}
                            onChange={e => setPkgCapCategory(e.target.value as UniformCategory)}
                          >
                            <option value="cap_red">{getCategoryDisplayName('cap_red', language as "es" | "en")}</option>
                            <option value="cap_black">{getCategoryDisplayName('cap_black', language as "es" | "en")}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            {t('uniforms.sales.cap_qty')}
                          </label>
                          <input
                            type="number"
                            min={pkgCapStock > 0 ? 1 : 0}
                            max={pkgCapStock}
                            disabled={pkgCapStock === 0}
                            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium outline-none disabled:opacity-50"
                            value={pkgCapQty}
                            onChange={e => {
                              const raw = parseInt(e.target.value) || 0;
                              if (raw > pkgCapStock) {
                                showToast(`El stock máximo disponible es de ${pkgCapStock} piezas.`, 'warning');
                                setPkgCapQty(pkgCapStock);
                              } else {
                                setPkgCapQty(Math.max(0, raw));
                              }
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {pkgIncludeCap && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 pt-1">
                        <span>{t('uniforms.sales.available_stock')}:</span>
                        <span className={`font-bold ${pkgCapStock >= pkgCapQty && pkgCapStock > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {pkgCapStock} {t('uniforms.stock.pieces_long')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 3. SECCIÓN CHAMARRA */}
                  <div className="space-y-3 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pkgIncludeJacket}
                          onChange={e => setPkgIncludeJacket(e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          3. {t('uniforms.sales.include_jacket')}
                        </span>
                      </label>
                    </div>

                    {!pkgIncludeJacket && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 italic">
                        {t('uniforms.sales.no_jacket_needed')}
                      </p>
                    )}

                    {pkgIncludeJacket && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            {t('uniforms.sales.jacket_category')}
                          </label>
                          <select 
                            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium outline-none"
                            value={pkgJacketCategory}
                            onChange={e => setPkgJacketCategory(e.target.value as UniformCategory)}
                          >
                            <option value="jacket_red">{getCategoryDisplayName('jacket_red', language as "es" | "en")}</option>
                            <option value="jacket_black">{getCategoryDisplayName('jacket_black', language as "es" | "en")}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            {t('uniforms.sales.jacket_size')}
                          </label>
                          <select 
                            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium outline-none"
                            value={pkgJacketSize}
                            onChange={e => setPkgJacketSize(e.target.value as UniformSize)}
                          >
                            {(SIZES_BY_CATEGORY[pkgJacketCategory] || []).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            {t('uniforms.sales.jacket_qty')}
                          </label>
                          <input
                            type="number"
                            min={pkgJacketStock > 0 ? 1 : 0}
                            max={pkgJacketStock}
                            disabled={pkgJacketStock === 0}
                            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium outline-none disabled:opacity-50"
                            value={pkgJacketQty}
                            onChange={e => {
                              const raw = parseInt(e.target.value) || 0;
                              if (raw > pkgJacketStock) {
                                showToast(`El stock máximo disponible es de ${pkgJacketStock} piezas.`, 'warning');
                                setPkgJacketQty(pkgJacketStock);
                              } else {
                                setPkgJacketQty(Math.max(0, raw));
                              }
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {pkgIncludeJacket && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 pt-1">
                        <span>{t('uniforms.sales.available_stock')}:</span>
                        <span className={`font-bold ${pkgJacketStock >= pkgJacketQty && pkgJacketStock > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {pkgJacketStock} {t('uniforms.stock.pieces_long')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('uniforms.sales.category')}
                      </label>
                      <select 
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 outline-none"
                        value={saleCategory}
                        onChange={e => {
                          const newCat = e.target.value as UniformCategory;
                          setSaleCategory(newCat);
                          setSaleSize((SIZES_BY_CATEGORY[newCat] || ['M'])[0]);
                        }}
                      >
                        {ALL_CATEGORIES.map(c => <option key={c} value={c}>{getCategoryDisplayName(c, language as "es" | "en")}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('uniforms.sales.size')}
                      </label>
                      <select 
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 outline-none"
                        value={saleSize}
                        onChange={e => setSaleSize(e.target.value as UniformSize)}
                      >
                        {(SIZES_BY_CATEGORY[saleCategory] || []).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                    {(txType === 'sale' || txType === 'customer_sale' || txType === 'damage') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {txType === 'damage' ? t('uniforms.sales.replacement_quantity') : t('uniforms.sales.quantity')}
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={txType === 'damage' ? 999 : (availableStock !== null && availableStock > 0 ? availableStock : 999)}
                          disabled={txType !== 'damage' && availableStock === 0}
                          className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 outline-none disabled:opacity-50 font-medium"
                          value={saleQty}
                          onChange={e => {
                            const raw = parseInt(e.target.value) || 0;
                            const max = txType === 'damage' ? 999 : (availableStock !== null && availableStock > 0 ? availableStock : 999);
                            if (txType !== 'damage' && raw > max) {
                              showToast(`El stock máximo disponible es de ${max} piezas.`, 'warning');
                              setSaleQty(max);
                            } else {
                              setSaleQty(Math.max(1, raw));
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {availableStock !== null && (
                    <div className="flex items-center gap-2 text-sm mt-2 flex-wrap">
                      <span className="text-gray-500">{t('uniforms.sales.available_stock')}:</span>
                      <span className={`font-bold ${availableStock > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {availableStock}
                      </span>
                      {isExempt && txType === 'sale' && (
                        <span className="text-xs font-semibold px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 rounded-md">
                          {t('uniforms.sales.manager_free_badge')}
                        </span>
                      )}
                      {txType === 'damage' && availableStock < saleQty && (
                        <span className="text-xs font-semibold px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded-md">
                          {t('uniforms.sales.low_stock_warning_damage')}
                        </span>
                      )}
                    </div>
                  )}

                  {txType === 'damage' && (
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('uniforms.sales.reason')} *
                      </label>
                      <input
                        type="text"
                        required
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 outline-none text-sm font-medium"
                        value={damageReason}
                        onChange={e => setDamageReason(e.target.value)}
                      />
                    </div>
                  )}

                  {/* OBSERVACIONES / NOTAS */}
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('uniforms.sales.observations')}
                    </label>
                    <input
                      type="text"
                      placeholder={t('uniforms.sales.observations_placeholder')}
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 outline-none text-sm font-medium"
                      value={saleNotes}
                      onChange={e => setSaleNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="text-2xl font-bold">
                {(txType === 'sale' || txType === 'customer_sale') ? (
                  isExempt ? (
                    <span className="text-purple-600 dark:text-purple-400">$0.00 ({t('uniforms.sales.manager_free_badge')})</span>
                  ) : (
                    <span className="text-blue-600 dark:text-blue-400">{formatCurrency(currentPrice)}</span>
                  )
                ) : (
                  <span className="text-green-600 dark:text-green-400">$0.00</span>
                )}
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-colors disabled:opacity-50 shadow-md"
              >
                {submitting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                {t('uniforms.sales.submit')}
              </button>
            </div>
          </form>
        </div>
      </div>
      
      <div className="space-y-6">
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-md space-y-4">
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold opacity-80 mb-1">{t('uniforms.kpi.current_transaction')}</h3>
            <p className="text-3xl font-bold">
              {(txType === 'sale' || txType === 'customer_sale') ? (
                isExempt ? '$0.00' : formatCurrency(currentPrice)
              ) : '$0.00'}
            </p>
          </div>
          <div className="pt-3 border-t border-white/20">
            <h3 className="text-xs uppercase tracking-wider font-semibold opacity-80 mb-1">{t('uniforms.kpi.today_safe_sales')}</h3>
            <p className="text-2xl font-bold text-emerald-200">{formatCurrency(todaySalesTotal)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabOrderReception({ storeId, showToast, onComplete }: any) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [receptionMode, setReceptionMode] = useState<'manual' | 'estimate'>('estimate');
  const [estimateNum, setEstimateNum] = useState('');
  
  // Manual mode items
  const [manualItems, setManualItems] = useState<{id: string, category: UniformCategory, size: UniformSize, qty: number}[]>([
    { id: '1', category: 'shirt_red', size: 'M', qty: 1 }
  ]);

  // QB Estimate items (ordered vs received with discrepancy tracking)
  const [orderItems, setOrderItems] = useState<Array<{
    id: string,
    category: UniformCategory,
    size: UniformSize,
    orderedQty: number,
    receivedQty: number,
    isMissing: boolean,
    notes: string
  }>>([]);

  const loadStandardTemplate = () => {
    setOrderItems([
      { id: '1', category: 'shirt_red', size: 'S', orderedQty: 6, receivedQty: 6, isMissing: false, notes: '' },
      { id: '2', category: 'shirt_red', size: 'M', orderedQty: 12, receivedQty: 12, isMissing: false, notes: '' },
      { id: '3', category: 'shirt_red', size: 'L', orderedQty: 12, receivedQty: 12, isMissing: false, notes: '' },
      { id: '4', category: 'shirt_red', size: 'XL', orderedQty: 6, receivedQty: 6, isMissing: false, notes: '' },
      { id: '5', category: 'cap_red', size: 'ONE_SIZE', orderedQty: 6, receivedQty: 6, isMissing: false, notes: '' },
      { id: '6', category: 'jacket_red', size: 'M', orderedQty: 2, receivedQty: 2, isMissing: false, notes: '' }
    ]);
  };

  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadedOrderId, setLoadedOrderId] = useState<string | null>(null);
  const [isOrderReceived, setIsOrderReceived] = useState(false);
  const [recentEstimates, setRecentEstimates] = useState<Array<{id: string, qb_estimate_number: string, qb_estimate_id: string, created_at: string, status?: string}>>([]);

  useEffect(() => {
    if (receptionMode === 'estimate') {
      fetchRecentStoreEstimates(storeId).then(setRecentEstimates).catch(console.error);
    }
  }, [storeId, receptionMode]);

  const loadEstimateByNum = async (num: string) => {
    setEstimateNum(num);
    setLoadedOrderId(null);
    setIsOrderReceived(false);
    try {
      setSearching(true);
      const res = await fetchQBEstimateForReception(storeId, num);
      if (res.found && res.items.length > 0) {
        setLoadedOrderId(res.orderId || null);
        setIsOrderReceived(!!res.isAlreadyReceived);
        setOrderItems(res.items.map(i => ({
          id: i.id,
          category: i.category as UniformCategory,
          size: i.size as UniformSize,
          orderedQty: i.orderedQty,
          receivedQty: i.receivedQty,
          isMissing: i.isMissing,
          notes: i.notes
        })));
        if (res.isAlreadyReceived) {
          showToast(t('uniforms.reception.order_already_received'), 'warning');
        } else {
          showToast(`Orden #${res.orderNumber || num} cargada exitosamente`, 'success');
        }
      } else {
        showToast(res.message || 'No se encontró la orden. Puedes agregar los artículos manualmente.', 'warning');
      }
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleSearchEstimate = async () => {
    if (!estimateNum.trim()) {
      showToast(t('uniforms.toast.error'), 'warning');
      return;
    }
    await loadEstimateByNum(estimateNum);
  };

  // Manual items handlers
  const addManualItem = () => {
    setManualItems([...manualItems, { id: Math.random().toString(), category: 'shirt_red', size: 'M', qty: 1 }]);
  };

  const removeManualItem = (id: string) => {
    if (manualItems.length > 1) {
      setManualItems(manualItems.filter(i => i.id !== id));
    }
  };

  const updateManualItem = (id: string, field: string, value: any) => {
    setManualItems(manualItems.map(i => {
      if (i.id === id) {
        const updated = { ...i, [field]: value };
        if (field === 'category') {
          updated.size = (SIZES_BY_CATEGORY[value as UniformCategory] || ['M'])[0];
        }
        return updated;
      }
      return i;
    }));
  };

  // Estimate items handlers
  const updateOrderItem = (id: string, field: string, value: any) => {
    setOrderItems(orderItems.map(item => {
      if (item.id === id) {
        let parsedVal = value;
        if (field === 'receivedQty') {
          parsedVal = isNaN(parseInt(value, 10)) ? 0 : parseInt(value, 10);
        }
        const updated = { ...item, [field]: parsedVal };
        if (field === 'receivedQty') {
          updated.isMissing = Number(parsedVal) < Number(item.orderedQty);
        } else if (field === 'isMissing' && !value) {
          updated.receivedQty = Number(item.orderedQty);
        }
        return updated;
      }
      return item;
    }));
  };

  const addOrderItem = () => {
    setOrderItems([...orderItems, {
      id: Math.random().toString(),
      category: 'shirt_red',
      size: 'M',
      orderedQty: 1,
      receivedQty: 1,
      isMissing: false,
      notes: ''
    }]);
  };

  const handleSubmitManual = async () => {
    const validItems = manualItems.filter(i => Number(i.qty) > 0).map(i => ({
      item_category: i.category,
      size: i.size,
      receivedQty: Number(i.qty)
    }));
    if (validItems.length === 0) {
      showToast(t('uniforms.toast.error'), 'warning');
      return;
    }
    
    try {
      setSubmitting(true);
      await confirmOrderReception({ 
        storeId, 
        items: validItems, 
        notes: 'Entrada Manual de Uniformes',
        userEmail: user?.email || '' 
      });
      showToast(t('uniforms.toast.reception_success'), 'success');
      setManualItems([{ id: Math.random().toString(), category: 'shirt_red', size: 'M', qty: 1 }]);
      onComplete();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitEstimate = async () => {
    if (isOrderReceived) {
      showToast(t('uniforms.reception.order_already_received'), 'warning');
      return;
    }

    const validItems = orderItems.filter(i => Number(i.receivedQty) > 0).map(i => {
      const rQty = Number(i.receivedQty);
      const oQty = Number(i.orderedQty);
      let notes = i.notes.trim();
      if (rQty < oQty && !notes) {
        notes = `Faltaron ${oQty - rQty} unidades (Pedidas: ${oQty}, Recibidas: ${rQty})`;
      }
      return {
        item_category: i.category,
        size: i.size,
        receivedQty: rQty,
        notes
      };
    });

    if (validItems.length === 0) {
      showToast(t('uniforms.toast.error'), 'warning');
      return;
    }

    // Build consolidated notes
    const discrepancies = orderItems.filter(i => i.isMissing || Number(i.receivedQty) < Number(i.orderedQty) || i.notes.trim());
    let orderNotes = estimateNum ? `QB Estimate: ${estimateNum}` : 'Recepcion de Orden QB';
    if (discrepancies.length > 0) {
      const details = discrepancies.map(d => 
        `${getCategoryDisplayName(d.category, language as 'es'|'en')} (${d.size}): Pedidas ${d.orderedQty}, Recibidas ${d.receivedQty}. ${d.notes}`
      ).join(' | ');
      orderNotes += ` — Observaciones: ${details}`;
    }

    try {
      setSubmitting(true);
      await confirmOrderReception({
        storeId,
        orderId: loadedOrderId || undefined,
        estimateNum: estimateNum.trim() || undefined,
        items: validItems.map(v => ({ item_category: v.item_category, size: v.size, receivedQty: Number(v.receivedQty) })),
        notes: orderNotes,
        userEmail: user?.email || ''
      });

      showToast(t('uniforms.toast.reception_success'), 'success');
      setOrderItems([]);
      setEstimateNum('');
      setLoadedOrderId(null);
      setIsOrderReceived(false);
      fetchRecentStoreEstimates(storeId).then(setRecentEstimates).catch(console.error);
      onComplete();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div>
          <h2 className="text-xl font-bold">{t('uniforms.reception.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {receptionMode === 'estimate' ? t('uniforms.reception.mode_qb_estimate') : t('uniforms.reception.mode_manual')}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-900 p-1.5 rounded-xl border border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setReceptionMode('estimate')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2
              ${receptionMode === 'estimate' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
          >
            <Truck className="w-4 h-4" />
            {t('uniforms.reception.mode_qb_estimate')}
          </button>
          <button
            onClick={() => setReceptionMode('manual')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2
              ${receptionMode === 'manual' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
          >
            <Plus className="w-4 h-4" />
            {t('uniforms.reception.mode_manual')}
          </button>
        </div>
      </div>

      {receptionMode === 'estimate' ? (
        <div className="space-y-6">
          {/* QB Estimate Header Info */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex-1 w-full">
              <label className="block text-xs font-semibold text-gray-500 mb-1"># Estimate / Orden QuickBooks</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder={t('uniforms.reception.search_estimate_placeholder')}
                    className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                    value={estimateNum}
                    onChange={e => setEstimateNum(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSearchEstimate(); }}
                  />
                </div>
                <button
                  onClick={handleSearchEstimate}
                  disabled={searching}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 shadow-sm"
                >
                  {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {t('uniforms.reception.fetch_order')}
                </button>
              </div>

              {recentEstimates.length > 0 && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400 font-medium">Órdenes / Estimates Recientes:</span>
                  {recentEstimates.slice(0, 6).map(est => {
                    const isRec = est.status === 'received';
                    return (
                      <button
                        key={est.id}
                        onClick={() => loadEstimateByNum(est.qb_estimate_number)}
                        className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-colors flex items-center gap-1.5 border
                          ${isRec 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/50' 
                            : 'bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-600 dark:hover:text-blue-300 border-transparent'}`}
                      >
                        <span>#{est.qb_estimate_number}</span>
                        <span className={`text-[10px] px-1 py-0.2 rounded font-sans font-bold
                          ${isRec 
                            ? 'bg-emerald-200/60 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-100' 
                            : 'bg-amber-200/60 dark:bg-amber-800 text-amber-800 dark:text-amber-100'}`}
                        >
                          {isRec ? t('uniforms.reception.status_received') : t('uniforms.reception.status_pending')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 self-end">
              <button
                onClick={loadStandardTemplate}
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-300 rounded-lg font-medium text-xs transition-colors"
              >
                <ClipboardList className="w-4 h-4" />
                Cargar Plantilla Estándar
              </button>
              <button
                onClick={addOrderItem}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg font-medium text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('uniforms.reception.add_item')}
              </button>
            </div>
          </div>

          {/* Banner if Order was already received */}
          {isOrderReceived && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-xl flex items-center gap-3 text-amber-800 dark:text-amber-300 text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <span className="font-bold">{t('uniforms.reception.order_already_received')}.</span>{' '}
                <span>{t('uniforms.reception.order_already_received_desc').replace('{number}', estimateNum)}</span>
              </div>
            </div>
          )}

          {/* Items Checklist with Discrepancies */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            <div className="p-6 space-y-4">
              {orderItems.length === 0 ? (
                <div className="p-12 text-center text-gray-500 space-y-4">
                  <Truck className="w-12 h-12 text-gray-300 mx-auto" />
                  <div>
                    <p className="font-semibold text-gray-700 dark:text-gray-300">No hay artículos agregados a esta recepción</p>
                    <p className="text-xs text-gray-400 mt-1">Ingresa el # de Estimate de QB arriba o agrega artículos para confirmar la entrega.</p>
                  </div>
                  <div className="flex justify-center gap-3 pt-2">
                    <button
                      onClick={addOrderItem}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      {t('uniforms.reception.add_item')}
                    </button>
                    <button
                      onClick={loadStandardTemplate}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors"
                    >
                      <ClipboardList className="w-4 h-4" />
                      Cargar Plantilla Estándar
                    </button>
                  </div>
                </div>
              ) : (
                orderItems.map((item, idx) => (
                <div 
                  key={item.id} 
                  className={`p-4 rounded-xl border transition-all space-y-3
                    ${item.isMissing || item.receivedQty < item.orderedQty 
                      ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700' 
                      : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'}`}
                >
                  <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-gray-400">{idx + 1}.</span>
                      <select 
                        className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 outline-none text-sm font-semibold"
                        value={item.category}
                        onChange={e => updateOrderItem(item.id, 'category', e.target.value)}
                      >
                        {ALL_CATEGORIES.map(c => <option key={c} value={c}>{getCategoryDisplayName(c, language as 'es'|'en')}</option>)}
                      </select>
                      <select 
                        className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 outline-none text-sm font-semibold"
                        value={item.size}
                        onChange={e => updateOrderItem(item.id, 'size', e.target.value)}
                      >
                        {(SIZES_BY_CATEGORY[item.category] || []).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <span className="block text-xs text-gray-500 font-medium">{t('uniforms.reception.ordered_qty')}</span>
                        <span className="font-bold text-base text-blue-600 dark:text-blue-400">{item.orderedQty}</span>
                      </div>

                      <div className="text-center">
                        <span className="block text-xs text-gray-500 font-medium">{t('uniforms.reception.qty_received')}</span>
                        <input
                          type="number"
                          min="0"
                          className="w-20 text-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 outline-none font-bold text-base"
                          value={item.receivedQty}
                          onChange={e => updateOrderItem(item.id, 'receivedQty', e.target.value)}
                        />
                      </div>

                      <label className="flex items-center gap-2 cursor-pointer select-none text-sm font-medium text-amber-700 dark:text-amber-400">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                          checked={item.isMissing || item.receivedQty < item.orderedQty}
                          onChange={e => updateOrderItem(item.id, 'isMissing', e.target.checked)}
                        />
                        {t('uniforms.reception.mark_incomplete')}
                      </label>
                    </div>
                  </div>

                  {(item.isMissing || item.receivedQty < item.orderedQty) && (
                    <div className="pt-2 border-t border-amber-200 dark:border-amber-800">
                      <label className="block text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">
                        ⚠️ {t('uniforms.reception.discrepancy_notes')}
                      </label>
                      <input
                        type="text"
                        placeholder={t('uniforms.reception.discrepancy_placeholder')}
                        className="w-full bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-amber-500"
                        value={item.notes}
                        onChange={e => updateOrderItem(item.id, 'notes', e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )))}
            </div>

            <div className="p-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4 text-sm font-medium">
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4" />
                  Recibidos: {orderItems.reduce((acc, i) => acc + i.receivedQty, 0)} items
                </span>
                {orderItems.some(i => i.isMissing || i.receivedQty < i.orderedQty) && (
                  <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    {orderItems.filter(i => i.isMissing || i.receivedQty < i.orderedQty).length} con observaciones
                  </span>
                )}
              </div>

              <button
                onClick={handleSubmitEstimate}
                disabled={submitting || isOrderReceived || orderItems.length === 0}
                className={`flex items-center gap-2 px-8 py-3 rounded-xl font-medium transition-colors shadow-md
                  ${isOrderReceived 
                    ? 'bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed opacity-80' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50'}`}
              >
                {submitting ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : isOrderReceived ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <Truck className="w-5 h-5" />
                )}
                {isOrderReceived ? t('uniforms.reception.status_received') : t('uniforms.reception.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Manual Mode Form */
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <h3 className="font-bold">{t('uniforms.reception.mode_manual')}</h3>
            <button
              onClick={addManualItem}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              {t('uniforms.reception.add_item')}
            </button>
          </div>

          <div className="p-6 space-y-4">
            {manualItems.map((item, idx) => (
              <div key={item.id} className="flex flex-wrap md:flex-nowrap items-end gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700">
                <div className="w-8 font-bold text-gray-400 pb-2">{idx + 1}.</div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('uniforms.sales.category')}</label>
                  <select 
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none text-sm font-medium"
                    value={item.category}
                    onChange={e => updateManualItem(item.id, 'category', e.target.value)}
                  >
                    {ALL_CATEGORIES.map(c => <option key={c} value={c}>{getCategoryDisplayName(c, language as 'es' | 'en')}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('uniforms.sales.size')}</label>
                  <select 
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none text-sm font-medium"
                    value={item.size}
                    onChange={e => updateManualItem(item.id, 'size', e.target.value)}
                  >
                    {(SIZES_BY_CATEGORY[item.category] || []).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div className="w-32">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('uniforms.reception.qty_received')}</label>
                  <input
                    type="number"
                    min="1"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none text-sm font-medium"
                    value={item.qty}
                    onChange={e => updateManualItem(item.id, 'qty', parseInt(e.target.value) || 0)}
                  />
                </div>
                <button
                  onClick={() => removeManualItem(item.id)}
                  disabled={manualItems.length === 1}
                  className="p-2 text-gray-400 hover:text-red-500 disabled:opacity-30 transition-colors mb-0.5"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>

          <div className="p-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex justify-end">
            <button
              onClick={handleSubmitManual}
              disabled={submitting}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-colors disabled:opacity-50 shadow-md"
            >
              {submitting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Truck className="w-5 h-5" />}
              {t('uniforms.reception.confirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabHistoryAndKardex({ storeId, showToast, onTransactionComplete }: any) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchGuid, setSearchGuid] = useState('');
  const [kardexMode, setKardexMode] = useState(false);

  // Edit / Void Modals State (Supervisors and Admins)
  const canEditOrVoid = user?.role === 'admin' || user?.role === 'supervisor';
  const [editingTx, setEditingTx] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [voidingTx, setVoidingTx] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  const refreshHistory = async () => {
    try {
      setLoading(true);
      if (kardexMode && searchGuid.trim()) {
        const data = await fetchEmployeeKardex(searchGuid.trim());
        setHistory(data);
      } else {
        const data = await fetchTransactionHistory(storeId);
        setHistory(data);
      }
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshHistory();
  }, [storeId]);

  const handleSearchKardex = async () => {
    if (!searchGuid.trim()) return;
    try {
      setLoading(true);
      const data = await fetchEmployeeKardex(searchGuid.trim());
      setHistory(data);
      setKardexMode(true);
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClearKardex = async () => {
    setSearchGuid('');
    setKardexMode(false);
    await refreshHistory();
  };

  const handleOpenEdit = (tx: any) => {
    setEditingTx(tx);
    setEditName(tx.employee_name || '');
    setEditReason(tx.reason || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    try {
      setEditSubmitting(true);
      await updateUniformTransactionDetails({
        transactionId: editingTx.id,
        employeeName: editName,
        reason: editReason,
        userEmail: user?.email || ''
      });
      showToast(t('uniforms.history.edit_success'), 'success');
      setEditingTx(null);
      await refreshHistory();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidingTx || !voidReason.trim()) {
      showToast(t('uniforms.history.void_reason_required'), 'warning');
      return;
    }
    try {
      setVoidSubmitting(true);
      const res = await voidUniformTransaction({
        transactionId: voidingTx.id,
        reason: voidReason,
        userEmail: user?.email || ''
      });

      if (res.warning) {
        showToast(res.warning, 'warning');
        setVoidingTx(null);
        setVoidReason('');
        return;
      }

      showToast(t('uniforms.history.void_success'), 'success');
      setVoidingTx(null);
      setVoidReason('');
      await refreshHistory();
      if (onTransactionComplete) onTransactionComplete();
    } catch (err) {
      showToast(t('uniforms.toast.error'), 'error');
    } finally {
      setVoidSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <h2 className="text-xl font-bold">
          {kardexMode ? `${t('uniforms.history.kardex_title')}: ${searchGuid}` : t('uniforms.history.title')}
        </h2>
        
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t('uniforms.history.kardex_search')}
              className="pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 w-64 text-sm"
              value={searchGuid}
              onChange={e => setSearchGuid(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearchKardex()}
            />
          </div>
          <button
            onClick={handleSearchKardex}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
          >
            {t('common.search')}
          </button>
          {kardexMode && (
            <button
              onClick={handleClearKardex}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium text-sm transition-colors"
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-gray-500 flex justify-center items-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-4 font-semibold">{t('uniforms.history.date')}</th>
                  <th className="p-4 font-semibold">{t('uniforms.history.type')}</th>
                  <th className="p-4 font-semibold">{t('uniforms.history.item')}</th>
                  <th className="p-4 font-semibold">{t('uniforms.history.qty')}</th>
                  <th className="p-4 font-semibold">{t('uniforms.history.employee')}</th>
                  <th className="p-4 font-semibold">{t('uniforms.history.amount')}</th>
                  <th className="p-4 font-semibold">{t('uniforms.history.created_by')}</th>
                  {canEditOrVoid && (
                    <th className="p-4 font-semibold text-center">{t('uniforms.history.actions')}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={canEditOrVoid ? 8 : 7} className="p-8 text-center text-gray-500">
                      {t('uniforms.history.no_results')}
                    </td>
                  </tr>
                ) : (
                  history.map(tx => {
                    const isVoided = tx.reason && tx.reason.includes('[ANULADO]');
                    return (
                      <tr key={tx.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${isVoided ? 'opacity-60 bg-red-50/30 dark:bg-red-950/10' : ''}`}>
                        <td className="p-4 text-sm text-gray-500">
                          {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${isVoided ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-gray-100 dark:bg-gray-700'}`}>
                            {isVoided ? `🚫 ${t('uniforms.history.void_badge')}` : getTransactionTypeLabel(tx.transaction_type, language as 'es' | 'en')}
                          </span>
                        </td>
                        <td className="p-4 font-medium">
                          {getCategoryDisplayName(tx.item_category, language as 'es' | 'en')} ({tx.size})
                        </td>
                        <td className={`p-4 font-bold ${isVoided ? 'line-through text-gray-400' : tx.quantity > 0 ? 'text-green-600' : 'text-gray-700 dark:text-gray-300'}`}>
                          {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                        </td>
                        <td className="p-4 text-sm">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{tx.employee_name || '-'}</div>
                          {tx.reason && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 italic mt-0.5 font-normal">
                              📝 {tx.reason}
                            </div>
                          )}
                        </td>
                        <td className="p-4 font-medium">
                          {isVoided ? (
                            <span className="line-through text-gray-400">$0.00</span>
                          ) : (
                            tx.total_amount ? formatCurrency(tx.total_amount) : '$0.00'
                          )}
                        </td>
                        <td className="p-4 text-sm text-gray-500">
                          {tx.created_by || '-'}
                        </td>
                        {canEditOrVoid && (
                          <td className="p-4 text-center">
                            {isVoided ? (
                              <span className="text-xs font-bold text-red-500 uppercase tracking-wider">{t('uniforms.history.void_badge')}</span>
                            ) : (
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => handleOpenEdit(tx)}
                                  className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                  title={t('uniforms.history.edit_btn')}
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setVoidingTx(tx)}
                                  className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                  title={t('uniforms.history.void_btn')}
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL EDITAR DETALLES DE TRANSACCIÓN */}
      {editingTx && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3 mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                {t('uniforms.history.edit_modal_title')}
              </h3>
              <button 
                onClick={() => setEditingTx(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('uniforms.history.employee_or_customer')}
                </label>
                <input 
                  type="text"
                  required
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('uniforms.sales.observations')}
                </label>
                <input 
                  type="text"
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setEditingTx(null)}
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium text-sm transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
                >
                  {editSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{t('common.save')}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* MODAL ANULAR TRANSACCIÓN Y REVERTIR INVENTARIO */}
      {voidingTx && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3 mb-4">
              <h3 className="text-lg font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {t('uniforms.history.void_modal_title')}
              </h3>
              <button 
                onClick={() => setVoidingTx(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300 mb-4">
              {t('uniforms.history.void_modal_desc')}
            </p>

            <form onSubmit={handleConfirmVoid} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('uniforms.history.void_reason_prompt')}
                </label>
                <input 
                  type="text"
                  required
                  placeholder={t('uniforms.history.void_reason_placeholder')}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-red-500"
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setVoidingTx(null)}
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-medium text-sm transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={voidSubmitting}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
                >
                  {voidSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  <span>{t('uniforms.history.void_btn')}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
