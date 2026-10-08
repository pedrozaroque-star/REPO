/**
 * @module CrearBillsPage
 * @description Módulo administrativo para la sincronización y creación automática de Bills en QuickBooks Online a partir de Invoices emitidos por La Bodega Central a las tiendas.
 * 
 * @businessRules
 * - La Bodega Central factura a cada una de las 15 sucursales diariamente.
 * - Este módulo sustituye el proceso manual en QuickBooks Online (Receive Payment -> Nueva pestaña -> Bill manual).
 * - Muestra todas las facturas emitidas por la bodega a las tiendas con su estatus de Bill (Creado o Pendiente).
 * - Permite crear Bills de forma individual (1-clic con confirmación) o en lote (batch selection).
 * - El Bill generado en QuickBooks Online replica con total exactitud la regla de negocio:
 *   - Vendor: "Tacos El Gavilan - Warehouse" (ID: 116)
 *   - Bill no: Invoice DocNumber
 *   - Bill date: Invoice TxnDate
 *   - Due date: 30 días posteriores al Bill date (Terms "15" / Net 30)
 *   - Location (Department): Sucursal correspondiente en QBO
 *   - Category (Account): "50010 COGS Purchases:Prep Foods" (ID: 71)
 *   - Class: Sucursal correspondiente en QBO
 *   - Amount: Monto total exacto del Invoice
 * 
 * @dataFlow
 * - UI -> /api/quickbooks/bills (GET / POST) -> lib/quickbooks-bills.ts -> QuickBooks Online API v3
 * 
 * @notes
 * - Soporta filtrado por tienda, estado (Todos, Pendientes, Creados) y búsqueda por número o monto.
 * - Ordenamiento interactivo por encabezado de columna (Factura #, Fecha Emisión, Vencimiento, Tienda, Monto Total, Estado del Bill).
 * - Ordenamiento por defecto: Agrupado por Tienda (A-Z) y ordenado por Fecha cronológica y número de factura.
 * - Validación estricta anti-duplicados para evitar registrar dos veces el mismo gasto.
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    Receipt, RefreshCw, CheckCircle2, Clock, Search, Filter, Store,
    Calendar, ArrowRight, ExternalLink, ShieldCheck, ChevronRight, X,
    Sparkles, Building2, CheckSquare, Square, DollarSign, Eye, AlertCircle,
    Check, AlertTriangle, ChevronUp, ChevronDown, ArrowUpDown
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { WarehouseInvoiceRecord, STORE_QB_MAPPINGS } from '@/types/quickbooks-bills';

export type SortKey = 'docNumber' | 'txnDate' | 'dueDate' | 'storeName' | 'totalAmount' | 'hasBill';

export interface SortConfig {
    key: SortKey;
    direction: 'asc' | 'desc';
}

export default function CrearBillsPage() {
    const { t, language } = useLanguage();

    const [invoices, setInvoices] = useState<WarehouseInvoiceRecord[]>([]);
    const [summary, setSummary] = useState<{
        totalCount: number;
        pendingCount: number;
        createdCount: number;
        pendingAmount: number;
        createdAmount: number;
        totalAmount: number;
    }>({
        totalCount: 0,
        pendingCount: 0,
        createdCount: 0,
        pendingAmount: 0,
        createdAmount: 0,
        totalAmount: 0
    });

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSyncing, setIsSyncing] = useState<boolean>(false);
    const [selectedStore, setSelectedStore] = useState<string>('all');
    const [selectedStatus, setSelectedStatus] = useState<'all' | 'pending' | 'created'>('all');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [selectedDocNumbers, setSelectedDocNumbers] = useState<Set<string>>(new Set());

    // Sorting state (Default: by Store and by Date)
    const [sortConfig, setSortConfig] = useState<SortConfig>({
        key: 'storeName',
        direction: 'asc'
    });

    // Modals
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        invoice?: WarehouseInvoiceRecord;
        billDate?: string;
        dueDate?: string;
    }>({ isOpen: false });

    const [batchModal, setBatchModal] = useState<{
        isOpen: boolean;
    }>({ isOpen: false });

    const [viewBillModal, setViewBillModal] = useState<{
        isOpen: boolean;
        invoice?: WarehouseInvoiceRecord;
    }>({ isOpen: false });

    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Auto-dismiss toast
    useEffect(() => {
        if (toastMessage) {
            const timer = setTimeout(() => setToastMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [toastMessage]);

    // Fetch invoices and bills from API
    const loadData = async (isManualSync: boolean = false) => {
        try {
            if (isManualSync) setIsSyncing(true);
            else setIsLoading(true);

            const res = await fetch('/api/quickbooks/bills?limit=150');
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: Error al consultar facturas de QuickBooks`);
            }
            const data = await res.json();

            if (data.success && data.invoices) {
                setInvoices(data.invoices);
                if (data.summary) setSummary(data.summary);
                if (isManualSync) {
                    setToastMessage({
                        type: 'success',
                        text: t('create_bills.toast_synced') || 'Datos actualizados con QuickBooks Online'
                    });
                }
            } else {
                setToastMessage({
                    type: 'error',
                    text: data.error || 'Error al cargar facturas de QuickBooks'
                });
            }
        } catch (err: any) {
            console.error('Error loading bills data:', err);
            setToastMessage({
                type: 'error',
                text: err.message || 'Error de conexión'
            });
        } finally {
            setIsLoading(false);
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // Clear batch selection when switching store to prevent accidental cross-store bill creation
    useEffect(() => {
        setSelectedDocNumbers(new Set());
    }, [selectedStore]);

    // Global Escape key listener to close modals
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isSubmitting) {
                if (confirmModal.isOpen) setConfirmModal({ isOpen: false });
                if (batchModal.isOpen) setBatchModal({ isOpen: false });
                if (viewBillModal.isOpen) setViewBillModal({ isOpen: false });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [confirmModal.isOpen, batchModal.isOpen, viewBillModal.isOpen, isSubmitting]);

    // Invoices scoped to selected store (for reactive KPIs)
    const storeInvoices = useMemo(() => {
        if (selectedStore === 'all') return invoices;
        return invoices.filter((inv) => inv.storeId === selectedStore || (inv.storeName || '').toLowerCase() === selectedStore.toLowerCase());
    }, [invoices, selectedStore]);

    // Dynamic reactive summary based on current store selection
    const displaySummary = useMemo(() => {
        let pendingCount = 0;
        let createdCount = 0;
        let pendingAmount = 0;
        let createdAmount = 0;
        let totalAmount = 0;

        for (const inv of storeInvoices) {
            const amt = Number(inv.totalAmount) || 0;
            totalAmount += amt;
            if (inv.hasBill) {
                createdCount++;
                createdAmount += amt;
            } else {
                pendingCount++;
                pendingAmount += amt;
            }
        }

        return {
            totalCount: storeInvoices.length,
            pendingCount,
            createdCount,
            pendingAmount: Math.round(pendingAmount * 100) / 100,
            createdAmount: Math.round(createdAmount * 100) / 100,
            totalAmount: Math.round(totalAmount * 100) / 100
        };
    }, [storeInvoices]);

    // Filtered invoices
    const filteredInvoices = useMemo(() => {
        return invoices.filter((inv) => {
            // Filter by store
            if (selectedStore !== 'all') {
                if (inv.storeId !== selectedStore && (inv.storeName || '').toLowerCase() !== selectedStore.toLowerCase()) {
                    return false;
                }
            }

            // Filter by status
            if (selectedStatus === 'pending' && inv.hasBill) return false;
            if (selectedStatus === 'created' && !inv.hasBill) return false;

            // Search filter with flexible syntax (#, $, commas)
            if (searchTerm.trim() !== '') {
                const term = searchTerm.toLowerCase().replace(/[#$,]/g, '').trim();
                const docClean = (inv.docNumber || '').toLowerCase().replace(/#/g, '');
                const matchDoc = docClean.includes(term);
                const matchStore = (inv.storeName || '').toLowerCase().includes(term);
                const matchCustomer = (inv.customerName || '').toLowerCase().includes(term);
                const rawAmt = (inv.totalAmount || 0).toString();
                const formattedAmt = formatCurrency(inv.totalAmount || 0).toLowerCase().replace(/[$,]/g, '');
                const matchAmount = rawAmt.includes(term) || formattedAmt.includes(term);
                if (!matchDoc && !matchStore && !matchCustomer && !matchAmount) {
                    return false;
                }
            }

            return true;
        });
    }, [invoices, selectedStore, selectedStatus, searchTerm]);

    // Request column sorting toggle
    const requestSort = (key: SortKey) => {
        setSortConfig((prev) => {
            if (prev.key === key) {
                return {
                    key,
                    direction: prev.direction === 'asc' ? 'desc' : 'asc'
                };
            }
            const initialDirection: 'asc' | 'desc' =
                key === 'storeName' || key === 'dueDate' || key === 'hasBill' ? 'asc' : 'desc';
            return { key, direction: initialDirection };
        });
    };

    // Sorted invoices with multi-level sorting (Default: Store A-Z, then Date)
    const sortedInvoices = useMemo(() => {
        const list = [...filteredInvoices];
        return list.sort((a, b) => {
            const dir = sortConfig.direction === 'asc' ? 1 : -1;

            if (sortConfig.key === 'storeName') {
                const storeCmp = (a.storeName || '').localeCompare(b.storeName || '');
                if (storeCmp !== 0) return storeCmp * dir;
                // Secondary sort by txnDate (chronological within store)
                const dateCmp = (a.txnDate || '').localeCompare(b.txnDate || '');
                if (dateCmp !== 0) return dateCmp * dir;
                // Tertiary sort by docNumber
                const numA = parseInt((a.docNumber || '').replace(/\D/g, ''), 10) || 0;
                const numB = parseInt((b.docNumber || '').replace(/\D/g, ''), 10) || 0;
                return (numA - numB) * dir;
            }

            if (sortConfig.key === 'txnDate') {
                const dateCmp = (a.txnDate || '').localeCompare(b.txnDate || '');
                if (dateCmp !== 0) return dateCmp * dir;
                // Secondary: storeName
                const storeCmp = (a.storeName || '').localeCompare(b.storeName || '');
                if (storeCmp !== 0) return storeCmp;
                const numA = parseInt((a.docNumber || '').replace(/\D/g, ''), 10) || 0;
                const numB = parseInt((b.docNumber || '').replace(/\D/g, ''), 10) || 0;
                return (numA - numB) * dir;
            }

            if (sortConfig.key === 'dueDate') {
                const dueCmp = (a.dueDate || '').localeCompare(b.dueDate || '');
                if (dueCmp !== 0) return dueCmp * dir;
                return (a.storeName || '').localeCompare(b.storeName || '');
            }

            if (sortConfig.key === 'docNumber') {
                const numA = parseInt((a.docNumber || '').replace(/\D/g, ''), 10) || 0;
                const numB = parseInt((b.docNumber || '').replace(/\D/g, ''), 10) || 0;
                if (numA !== numB) return (numA - numB) * dir;
                return (a.docNumber || '').localeCompare(b.docNumber || '') * dir;
            }

            if (sortConfig.key === 'totalAmount') {
                const diff = (Number(a.totalAmount) || 0) - (Number(b.totalAmount) || 0);
                if (diff !== 0) return diff * dir;
                return (a.storeName || '').localeCompare(b.storeName || '');
            }

            if (sortConfig.key === 'hasBill') {
                const valA = a.hasBill ? 1 : 0;
                const valB = b.hasBill ? 1 : 0;
                if (valA !== valB) return (valA - valB) * dir;
                const storeCmp = (a.storeName || '').localeCompare(b.storeName || '');
                if (storeCmp !== 0) return storeCmp;
                return (a.txnDate || '').localeCompare(b.txnDate || '');
            }

            return 0;
        });
    }, [filteredInvoices, sortConfig]);

    // Total accumulated amount of currently selected batch
    const selectedTotalAmount = useMemo(() => {
        let sum = 0;
        for (const inv of invoices) {
            if (selectedDocNumbers.has(inv.docNumber)) {
                sum += Number(inv.totalAmount) || 0;
            }
        }
        return Math.round(sum * 100) / 100;
    }, [invoices, selectedDocNumbers]);

    // List of unique stores from mapping
    const storeOptions = useMemo(() => {
        return Object.values(STORE_QB_MAPPINGS).map((m) => ({
            id: m.storeId,
            name: m.storeName
        })).sort((a, b) => a.name.localeCompare(b.name));
    }, []);

    // Handle single bill creation
    const handleOpenConfirmSingle = (inv: WarehouseInvoiceRecord) => {
        setConfirmModal({
            isOpen: true,
            invoice: inv,
            billDate: inv.txnDate,
            dueDate: inv.dueDate || inv.txnDate
        });
    };

    const handleConfirmSingleCreate = async () => {
        if (!confirmModal.invoice) return;
        setIsSubmitting(true);
        const docNumber = confirmModal.invoice.docNumber;

        try {
            const res = await fetch('/api/quickbooks/bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    invoiceDocNumbers: [docNumber],
                    customOptions: {
                        billDate: confirmModal.billDate,
                        dueDate: confirmModal.dueDate
                    }
                })
            });

            const data = await res.json();
            if (data.success && data.results?.[0]?.success) {
                const createdBill = data.results[0].bill;
                setToastMessage({
                    type: 'success',
                    text: (t('create_bills.success_single') || 'Bill creado exitosamente en QuickBooks Online (ID: {id})').replace('{id}', createdBill.Id)
                });
                setConfirmModal({ isOpen: false });

                // Deselect if it was selected in batch
                setSelectedDocNumbers((prev) => {
                    const next = new Set(prev);
                    next.delete(docNumber);
                    return next;
                });

                // Update local state directly
                setInvoices((prev) =>
                    prev.map((item) =>
                        item.docNumber === docNumber
                            ? {
                                  ...item,
                                  hasBill: true,
                                  bill: {
                                      billId: createdBill.Id,
                                      docNumber: createdBill.DocNumber,
                                      txnDate: createdBill.TxnDate,
                                      dueDate: createdBill.DueDate,
                                      totalAmount: Number(createdBill.TotalAmt) || item.totalAmount,
                                      createdAt: new Date().toISOString(),
                                      vendorName: createdBill.VendorRef?.name || 'Tacos El Gavilan - Warehouse',
                                      departmentName: createdBill.DepartmentRef?.name
                                  }
                              }
                            : item
                    )
                );

                // Update summary counters
                setSummary((prev) => ({
                    ...prev,
                    pendingCount: Math.max(0, prev.pendingCount - 1),
                    createdCount: prev.createdCount + 1,
                    pendingAmount: Math.max(0, prev.pendingAmount - (confirmModal.invoice?.totalAmount || 0)),
                    createdAmount: prev.createdAmount + (confirmModal.invoice?.totalAmount || 0)
                }));
            } else {
                setToastMessage({
                    type: 'error',
                    text: data.results?.[0]?.error || data.error || 'Error al crear el Bill en QuickBooks'
                });
            }
        } catch (err: any) {
            setToastMessage({
                type: 'error',
                text: err.message || 'Error en la petición a QuickBooks'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle batch selection
    const toggleSelectDocNumber = (doc: string) => {
        setSelectedDocNumbers((prev) => {
            const next = new Set(prev);
            if (next.has(doc)) next.delete(doc);
            else next.add(doc);
            return next;
        });
    };

    const handleSelectAllVisiblePending = () => {
        const pendingVisible = sortedInvoices.filter((inv) => !inv.hasBill);
        const allSelected = pendingVisible.every((inv) => selectedDocNumbers.has(inv.docNumber));

        setSelectedDocNumbers((prev) => {
            const next = new Set(prev);
            if (allSelected) {
                pendingVisible.forEach((inv) => next.delete(inv.docNumber));
            } else {
                pendingVisible.forEach((inv) => next.add(inv.docNumber));
            }
            return next;
        });
    };

    const handleConfirmBatchCreate = async () => {
        if (selectedDocNumbers.size === 0) return;
        setIsSubmitting(true);
        const docNumbers = Array.from(selectedDocNumbers);

        try {
            const res = await fetch('/api/quickbooks/bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    invoiceDocNumbers: docNumbers
                })
            });

            const data = await res.json();
            if (data.results) {
                const successfulDocs = new Set(
                    data.results.filter((r: any) => r.success).map((r: any) => r.docNumber)
                );

                if (successfulDocs.size > 0) {
                    setToastMessage({
                        type: 'success',
                        text: (t('create_bills.success_batch') || 'Se crearon {success} Bills exitosamente en QuickBooks').replace('{success}', String(successfulDocs.size))
                    });

                    // Reload fresh data from QuickBooks
                    loadData(true);
                    setSelectedDocNumbers(new Set());
                    setBatchModal({ isOpen: false });
                } else {
                    setToastMessage({
                        type: 'error',
                        text: t('create_bills.error_batch') || 'No se pudo crear ningún Bill en QuickBooks'
                    });
                }
            }
        } catch (err: any) {
            setToastMessage({
                type: 'error',
                text: err.message || 'Error en la creación en lote'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2
        }).format(val);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8 space-y-6">
            {/* TOAST FEEDBACK */}
            {toastMessage && (
                <div
                    className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl border text-sm font-medium transition-all transform animate-in slide-in-from-bottom-5 ${
                        toastMessage.type === 'success'
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-500/20'
                            : 'bg-rose-600 text-white border-rose-500 shadow-rose-500/20'
                    }`}
                >
                    {toastMessage.type === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                    ) : (
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    )}
                    <span>{toastMessage.text}</span>
                    <button
                        onClick={() => setToastMessage(null)}
                        className="ml-2 hover:opacity-75"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200/60 dark:border-emerald-800/60">
                            <Receipt className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
                                {t('create_bills.title') || 'Crear Bills'}
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    QuickBooks Online
                                </span>
                            </h1>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {t('create_bills.subtitle') || 'Sincronización y creación automática de Bills desde Invoices de Bodega en QuickBooks Online'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => loadData(true)}
                        disabled={isSyncing || isLoading}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-xl transition-all border border-slate-200 dark:border-slate-700 shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-emerald-600' : ''}`} />
                        <span>{isSyncing ? (t('create_bills.syncing') || 'Sincronizando...') : (t('create_bills.sync_btn') || 'Sincronizar QuickBooks')}</span>
                    </button>
                </div>
            </div>

            {/* SUMMARY KPIS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Pending Invoices */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                            {t('create_bills.kpi_pending') || 'Invoices Pendientes'}
                        </span>
                        <div className="p-2 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-lg">
                            <Clock className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <span className="text-3xl font-bold text-slate-900 dark:text-white">
                            {displaySummary.pendingCount}
                        </span>
                        <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                            {formatCurrency(displaySummary.pendingAmount)}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t('create_bills.kpi_pending_sub') || 'Sin Bill creado en QuickBooks'}
                    </p>
                </div>

                {/* Created Bills */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                            {t('create_bills.kpi_created') || 'Bills Creados'}
                        </span>
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-lg">
                            <CheckCircle2 className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <span className="text-3xl font-bold text-slate-900 dark:text-white">
                            {displaySummary.createdCount}
                        </span>
                        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(displaySummary.createdAmount)}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t('create_bills.kpi_created_sub') || 'Registrados en QBO'}
                    </p>
                </div>

                {/* Total Invoiced */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                            {t('create_bills.kpi_total') || 'Total Facturado'}
                        </span>
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg">
                            <DollarSign className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <span className="text-3xl font-bold text-slate-900 dark:text-white">
                            {displaySummary.totalCount}
                        </span>
                        <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                            {formatCurrency(displaySummary.totalAmount)}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t('create_bills.kpi_total_sub') || 'Invoices de Bodega'}
                    </p>
                </div>

                {/* Integration Status */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                            {t('create_bills.kpi_connection') || 'Conexión QuickBooks'}
                        </span>
                        <div className="p-2 bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 rounded-lg">
                            <ShieldCheck className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <span className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                            Tacos Gavilan
                        </span>
                        <span className="text-xs font-bold px-2 py-0.5 bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 rounded-full border border-purple-200 dark:border-purple-800">
                            PROD
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Vendor ID: 116 (Warehouse) • Cat: 50010
                    </p>
                </div>
            </div>

            {/* FILTERS & SEARCH */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Store Selector */}
                    <div className="relative">
                        <select
                            value={selectedStore}
                            onChange={(e) => setSelectedStore(e.target.value)}
                            aria-label={t('create_bills.filter_store') || 'Filtrar por Tienda'}
                            className="pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 appearance-none cursor-pointer"
                        >
                            <option value="all">{t('create_bills.all_stores') || 'Todas las Tiendas (15)'}</option>
                            {storeOptions.map((store) => (
                                <option key={store.id} value={store.id}>
                                    {store.name}
                                </option>
                            ))}
                        </select>
                        <Building2 className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    {/* Status Tabs */}
                    <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setSelectedStatus('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                selectedStatus === 'all'
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            {t('create_bills.status_all') || 'Todos'} ({displaySummary.totalCount})
                        </button>
                        <button
                            onClick={() => setSelectedStatus('pending')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                selectedStatus === 'pending'
                                    ? 'bg-amber-500 text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-200"></span>
                            {t('create_bills.status_pending') || 'Pendientes'} ({displaySummary.pendingCount})
                        </button>
                        <button
                            onClick={() => setSelectedStatus('created')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                selectedStatus === 'created'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-200"></span>
                            {t('create_bills.status_created') || 'Creados'} ({displaySummary.createdCount})
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={t('create_bills.search_placeholder') || 'Buscar por # Factura, tienda o monto...'}
                        className="w-full pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            aria-label="Limpiar búsqueda"
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* BATCH ACTION BAR (Shown when pending items are selected) */}
            {selectedDocNumbers.size > 0 && (
                <div className="sticky top-4 z-30 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/80 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-600 text-white rounded-lg shrink-0">
                            <CheckSquare className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-bold text-emerald-950 dark:text-emerald-100">
                                    {t('create_bills.batch_bar_count')?.replace('{count}', String(selectedDocNumbers.size)) || `${selectedDocNumbers.size} facturas seleccionadas`}
                                </p>
                                <span className="text-xs font-bold font-mono px-2 py-0.5 bg-emerald-200/80 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200 rounded-md">
                                    {t('create_bills.batch_bar_amount')?.replace('{amount}', formatCurrency(selectedTotalAmount)) || `Total: ${formatCurrency(selectedTotalAmount)}`}
                                </span>
                            </div>
                            <p className="text-xs text-emerald-700 dark:text-emerald-300">
                                {t('create_bills.batch_bar_desc') || 'Se registrarán en lote bajo el proveedor "Tacos El Gavilan - Warehouse" y cuenta 50010 COGS Purchases:Prep Foods.'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setSelectedDocNumbers(new Set())}
                            disabled={isSubmitting}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-50"
                        >
                            {t('create_bills.btn_deselect') || 'Deseleccionar'}
                        </button>
                        <button
                            onClick={() => setBatchModal({ isOpen: true })}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                            <Sparkles className="w-4 h-4" />
                            <span>{t('create_bills.batch_create_btn') || 'Crear Bills Seleccionados'} ({selectedDocNumbers.size})</span>
                        </button>
                    </div>
                </div>
            )}

            {/* INVOICES TABLE */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <th className="p-4 w-12 text-center">
                                    <button
                                        onClick={handleSelectAllVisiblePending}
                                        title="Seleccionar pendientes visibles"
                                        aria-label="Seleccionar o deseleccionar todas las facturas pendientes visibles"
                                        className="text-slate-500 hover:text-slate-800 dark:hover:text-white"
                                    >
                                        <CheckSquare className="w-4 h-4" />
                                    </button>
                                </th>
                                <th 
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('docNumber')}
                                    title="Ordenar por número de factura"
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.th_invoice') || 'Factura / Invoice #'}</span>
                                        {sortConfig.key === 'docNumber' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                                        )}
                                    </div>
                                </th>
                                <th 
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('txnDate')}
                                    title="Ordenar por fecha de emisión"
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.th_date') || 'Fecha Emisión'}</span>
                                        {sortConfig.key === 'txnDate' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                                        )}
                                    </div>
                                </th>
                                <th 
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('dueDate')}
                                    title="Ordenar por fecha de vencimiento"
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.th_due_date') || 'Vencimiento'}</span>
                                        {sortConfig.key === 'dueDate' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                                        )}
                                    </div>
                                </th>
                                <th 
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('storeName')}
                                    title="Ordenar por sucursal / tienda"
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.th_store') || 'Sucursal (Tienda)'}</span>
                                        {sortConfig.key === 'storeName' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                                        )}
                                    </div>
                                </th>
                                <th 
                                    className="p-4 text-right cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('totalAmount')}
                                    title="Ordenar por monto total"
                                >
                                    <div className="flex items-center justify-end gap-1.5">
                                        <span>{t('create_bills.th_amount') || 'Monto Total'}</span>
                                        {sortConfig.key === 'totalAmount' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                                        )}
                                    </div>
                                </th>
                                <th 
                                    className="p-4 text-center cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('hasBill')}
                                    title="Ordenar por estado del Bill"
                                >
                                    <div className="flex items-center justify-center gap-1.5">
                                        <span>{t('create_bills.th_status') || 'Estado del Bill'}</span>
                                        {sortConfig.key === 'hasBill' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                                        )}
                                    </div>
                                </th>
                                <th className="p-4 text-right">{t('create_bills.th_actions') || 'Acciones'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={8} className="p-12 text-center text-slate-400">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
                                            <p className="font-semibold text-slate-600 dark:text-slate-300">
                                                {t('create_bills.loading_invoices') || 'Cargando facturas desde QuickBooks Online...'}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : sortedInvoices.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="p-12 text-center text-slate-400">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <Receipt className="w-10 h-10 stroke-1 text-slate-300 dark:text-slate-600" />
                                            <p className="font-semibold text-slate-600 dark:text-slate-300">
                                                {t('create_bills.no_invoices') || 'No se encontraron facturas con los filtros seleccionados'}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                sortedInvoices.map((inv) => {
                                    const isSelected = selectedDocNumbers.has(inv.docNumber);
                                    return (
                                        <tr
                                            key={inv.invoiceId || inv.docNumber}
                                            className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                                                isSelected ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''
                                            }`}
                                        >
                                            {/* Select Checkbox */}
                                            <td className="p-4 text-center">
                                                {inv.hasBill ? (
                                                    <span className="text-emerald-500 opacity-40">
                                                        <Check className="w-4 h-4 mx-auto" />
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={() => toggleSelectDocNumber(inv.docNumber)}
                                                        disabled={isSubmitting}
                                                        aria-label={`Seleccionar factura ${inv.docNumber}`}
                                                        className="text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50"
                                                    >
                                                        {isSelected ? (
                                                            <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                                        ) : (
                                                            <Square className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                )}
                                            </td>

                                            {/* Invoice Number */}
                                            <td className="p-4 font-bold text-slate-900 dark:text-white">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-200/50 dark:border-emerald-800/50">
                                                        #{inv.docNumber}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* Invoice Date */}
                                            <td className="p-4 text-slate-600 dark:text-slate-300 font-medium">
                                                {inv.txnDate}
                                            </td>

                                            {/* Due Date */}
                                            <td className="p-4 text-slate-500 dark:text-slate-400 text-xs">
                                                {inv.dueDate}
                                            </td>

                                            {/* Store / Location */}
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-slate-900 dark:text-white">
                                                        {inv.storeName}
                                                    </span>
                                                    <span className="text-xs text-slate-400 font-mono">
                                                        {inv.customerName}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* Total Amount */}
                                            <td className="p-4 text-right font-bold text-slate-900 dark:text-white font-mono">
                                                {formatCurrency(inv.totalAmount)}
                                            </td>

                                            {/* Bill Status */}
                                            <td className="p-4 text-center">
                                                {inv.hasBill ? (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shadow-sm">
                                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                        {t('create_bills.badge_created') || 'Bill Creado'}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shadow-sm">
                                                        <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                                        {t('create_bills.badge_pending') || 'Pendiente'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Action Button */}
                                            <td className="p-4 text-right">
                                                {inv.hasBill ? (
                                                    <button
                                                        onClick={() => setViewBillModal({ isOpen: true, invoice: inv })}
                                                        disabled={isSubmitting}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                        <span>{t('create_bills.btn_view_bill') || 'Ver Bill'}</span>
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleOpenConfirmSingle(inv)}
                                                        disabled={isSubmitting}
                                                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50"
                                                    >
                                                        <Sparkles className="w-3.5 h-3.5" />
                                                        <span>{t('create_bills.btn_create_bill') || 'Crear Bill'}</span>
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* CONFIRM SINGLE BILL CREATION MODAL */}
            {confirmModal.isOpen && confirmModal.invoice && (
                <div 
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !isSubmitting) {
                            setConfirmModal({ isOpen: false });
                        }
                    }}
                >
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
                                    <Receipt className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                        {t('create_bills.modal_title') || 'Confirmar Creación de Bill'}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {t('create_bills.modal_subtitle') || 'Verifique los parámetros antes de enviar el registro a QuickBooks Online'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setConfirmModal({ isOpen: false })}
                                aria-label="Cerrar modal de confirmación"
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-sm">
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2.5 border border-slate-200/60 dark:border-slate-700/60">
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_vendor') || 'Proveedor (Vendor)'}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        Tacos El Gavilan - Warehouse
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_doc_number') || 'No. de Bill'}:
                                    </span>
                                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                        #{confirmModal.invoice.docNumber}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_location') || 'Ubicación (Location)'}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {confirmModal.invoice.departmentName || confirmModal.invoice.storeName}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_class') || 'Clase Contable (Class)'}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {confirmModal.invoice.className || confirmModal.invoice.storeName}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_account') || 'Cuenta (Account)'}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        50010 COGS Purchases:Prep Foods
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_terms') || 'Términos'}:
                                    </span>
                                    <span className="font-semibold text-slate-900 dark:text-white">
                                        15 (Net 30 Days)
                                    </span>
                                </div>
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between items-center">
                                    <span className="text-slate-700 dark:text-slate-300 font-bold text-xs uppercase">
                                        {t('create_bills.field_amount') || 'Monto Total'}:
                                    </span>
                                    <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                                        {formatCurrency(confirmModal.invoice.totalAmount)}
                                    </span>
                                </div>
                            </div>

                            {/* Dates Configuration */}
                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <div>
                                    <label htmlFor="input-bill-date" className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                        {t('create_bills.field_bill_date') || 'Bill Date'}
                                    </label>
                                    <input
                                        id="input-bill-date"
                                        type="date"
                                        value={confirmModal.billDate}
                                        onChange={(e) => setConfirmModal({ ...confirmModal, billDate: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="input-due-date" className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                        {t('create_bills.field_due_date') || 'Due Date'}
                                    </label>
                                    <input
                                        id="input-due-date"
                                        type="date"
                                        value={confirmModal.dueDate}
                                        onChange={(e) => setConfirmModal({ ...confirmModal, dueDate: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button
                                onClick={() => setConfirmModal({ isOpen: false })}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                            >
                                {t('create_bills.cancel') || 'Cancelar'}
                            </button>
                            <button
                                onClick={handleConfirmSingleCreate}
                                disabled={isSubmitting}
                                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        <span>{t('create_bills.creating') || 'Creando en QuickBooks...'}</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4" />
                                        <span>{t('create_bills.confirm_create') || 'Confirmar y Crear Bill'}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* CONFIRM BATCH BILL CREATION MODAL */}
            {batchModal.isOpen && (
                <div 
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !isSubmitting) {
                            setBatchModal({ isOpen: false });
                        }
                    }}
                >
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
                                    <Sparkles className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                        {t('create_bills.batch_create_confirm')?.replace('{count}', String(selectedDocNumbers.size)) || `¿Crear ${selectedDocNumbers.size} Bills en QuickBooks?`}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Procesamiento en lote a QuickBooks Online
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setBatchModal({ isOpen: false })}
                                aria-label="Cerrar modal de lote"
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-sm">
                            <p className="text-slate-600 dark:text-slate-300">
                                {t('create_bills.batch_create_desc') ||
                                    'Se enviarán las facturas seleccionadas a QuickBooks Online para generar sus respectivos Bills bajo el proveedor "Tacos El Gavilan - Warehouse" y la cuenta 50010 COGS Purchases:Prep Foods.'}
                            </p>

                            <div className="max-h-48 overflow-y-auto bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
                                {Array.from(selectedDocNumbers).map((doc) => {
                                    const inv = invoices.find((i) => i.docNumber === doc);
                                    return (
                                        <div key={doc} className="py-2 flex items-center justify-between text-xs">
                                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                                #{doc} ({inv?.storeName})
                                            </span>
                                            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                {inv ? formatCurrency(inv.totalAmount) : ''}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="pt-2 px-1 flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                                <span>{t('create_bills.batch_modal_total') || 'Total del Lote'}:</span>
                                <span className="font-mono text-emerald-600 dark:text-emerald-400 text-sm">
                                    {formatCurrency(selectedTotalAmount)}
                                </span>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button
                                onClick={() => setBatchModal({ isOpen: false })}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                            >
                                {t('create_bills.cancel') || 'Cancelar'}
                            </button>
                            <button
                                onClick={handleConfirmBatchCreate}
                                disabled={isSubmitting}
                                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        <span>{t('create_bills.creating') || 'Creando en QuickBooks...'}</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4" />
                                        <span>{t('create_bills.batch_create_btn') || 'Crear Bills Seleccionados'} ({selectedDocNumbers.size})</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* VIEW BILL DETAILS MODAL */}
            {viewBillModal.isOpen && viewBillModal.invoice && (
                <div 
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setViewBillModal({ isOpen: false });
                        }
                    }}
                >
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
                                    <CheckCircle2 className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                        {t('create_bills.modal_details_title') || 'Detalles del Bill en QuickBooks'}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {t('create_bills.modal_details_subtitle') || 'Registro contable confirmado en QuickBooks Online'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setViewBillModal({ isOpen: false })}
                                aria-label="Cerrar modal de detalles"
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-3 text-sm">
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2.5 border border-slate-200/60 dark:border-slate-700/60 text-xs">
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_bill_id') || 'ID de Bill en QBO'}:
                                    </span>
                                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                                        {viewBillModal.invoice.bill?.billId}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_doc_number') || 'No. de Bill'}:
                                    </span>
                                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                        #{viewBillModal.invoice.bill?.docNumber}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_vendor') || 'Proveedor'}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {viewBillModal.invoice.bill?.vendorName}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_location') || 'Ubicación'}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {viewBillModal.invoice.bill?.departmentName || viewBillModal.invoice.storeName}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_bill_date') || 'Fecha'}:
                                    </span>
                                    <span className="font-semibold text-slate-900 dark:text-white">
                                        {viewBillModal.invoice.bill?.txnDate}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_due_date') || 'Vencimiento'}:
                                    </span>
                                    <span className="font-semibold text-slate-900 dark:text-white">
                                        {viewBillModal.invoice.bill?.dueDate}
                                    </span>
                                </div>
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between items-center">
                                    <span className="text-slate-700 dark:text-slate-300 font-bold uppercase">
                                        {t('create_bills.field_amount') || 'Monto'}:
                                    </span>
                                    <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                                        {formatCurrency(viewBillModal.invoice.bill?.totalAmount || viewBillModal.invoice.totalAmount)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                            <button
                                onClick={() => setViewBillModal({ isOpen: false })}
                                className="px-5 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold rounded-xl hover:opacity-90 transition-opacity"
                            >
                                {t('create_bills.understood') || 'Entendido'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
