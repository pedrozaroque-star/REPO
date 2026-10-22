/**
 * @module VieleWholesailBillsTab
 * @description Pestaña interactiva dentro del módulo Crear Bills para sincronizar las 3 facturas semanales
 *              de Viele & Sons por sucursal (Sodas, Insumos Generales y Químicos Imperial Chemical) desde Wholesail
 *              y registrarlas automáticamente como Bills en QuickBooks Online (Vendor ID '1': "Viele & Sons").
 *
 * @businessRules
 * - Muestra las 3 facturas semanales por sucursal desde Wholesail:
 *   1) Sodas (BIB 5 Gal) -> Cuenta QBO '50001 COGS Purchases:Beverages' (ID: '103').
 *   2) Insumos Generales (Wxxxxxx) -> Cuenta QBO '53050 Restaurant Supplies' (ID: '22').
 *      * Si contiene Cloro ('3BLEA'), divide automáticamente el Bill en 2 líneas:
 *        - Monto de '3BLEA' ($12.01) a '51170 Janitorial Supplies' (ID: '79')
 *        - Resto de la factura a '53050 Restaurant Supplies' (ID: '22')
 *   3) Químicos (50xxxxx / PO CHEMICAL) -> Cuenta QBO '51170 Janitorial Supplies' (ID: '79').
 * - Todos los Bills de Viele & Sons se registran con Terms = 'Net 60' (SalesTermRef = '4', DueDate = TxnDate + 60 días)
 *   y el número de factura sin el sufijo '-IN' (ej. 'W150396-IN' -> 'W150396').
 *
 * @dataFlow
 * - Consume `GET /api/quickbooks/viele-bills` y `POST /api/quickbooks/viele-bills`.
 * - Soporta vinculación de nuevas sucursales pegando el enlace `_wsrt` de Wholesail o mediante código enviado a `ap@tacosgavilan.com`.
 *
 * @notes
 * - Soporta internacionalización completa (`es` / `en`) vía `useLanguage()`.
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    Receipt,
    RefreshCw,
    CheckCircle2,
    Clock,
    Search,
    Building2,
    Calendar,
    ExternalLink,
    ShieldCheck,
    X,
    Sparkles,
    CheckSquare,
    Square,
    DollarSign,
    Eye,
    AlertCircle,
    Check,
    ChevronUp,
    ChevronDown,
    ArrowUpDown,
    Link2,
    Mail,
    KeyRound,
    Layers
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import {
    STORE_QB_MAPPINGS,
    VieleInvoiceCategory,
    VieleWholesailInvoiceRecord,
    WholesailStoreConnectionStatus
} from '@/types/quickbooks-bills';

type SortKey = 'docNumber' | 'txnDate' | 'dueDate' | 'storeName' | 'category' | 'totalAmount' | 'hasBill';

interface SortConfig {
    key: SortKey;
    direction: 'asc' | 'desc';
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
});

function formatCurrency(val: number): string {
    return currencyFormatter.format(val || 0);
}

interface VieleWholesailBillsTabProps {
    onNotify: (toast: { type: 'success' | 'error'; text: string }) => void;
}

export default function VieleWholesailBillsTab({ onNotify }: VieleWholesailBillsTabProps) {
    const { t, language } = useLanguage();

    const [records, setRecords] = useState<VieleWholesailInvoiceRecord[]>([]);
    const [storeStatuses, setStoreStatuses] = useState<WholesailStoreConnectionStatus[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSyncing, setIsSyncing] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    // Filters
    const [selectedStore, setSelectedStore] = useState<string>('5'); // Default LA Broadway (#5) which is pre-linked in Wholesail
    const [selectedStatus, setSelectedStatus] = useState<'all' | 'pending' | 'created'>('all');
    const [selectedCategory, setSelectedCategory] = useState<'all' | VieleInvoiceCategory>('all');
    const [startDate, setStartDate] = useState<string>('2026-07-01');
    const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
    const [searchTerm, setSearchTerm] = useState<string>('');

    // Batch selection (keyed by `${storeId}_${docNumber}`)
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

    // Sorting
    const [sortConfig, setSortConfig] = useState<SortConfig>({
        key: 'txnDate',
        direction: 'desc'
    });

    // Modals
    const [confirmSingleModal, setConfirmSingleModal] = useState<{
        isOpen: boolean;
        record?: VieleWholesailInvoiceRecord;
    }>({ isOpen: false });

    const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false);

    const [viewModal, setViewModal] = useState<{
        isOpen: boolean;
        record?: VieleWholesailInvoiceRecord;
    }>({ isOpen: false });

    const [connectModalOpen, setConnectModalOpen] = useState<boolean>(false);
    const [wholesailUrlInput, setWholesailUrlInput] = useState<string>('');
    const [passcodeEmail, setPasscodeEmail] = useState<string>('ap@tacosgavilan.com');
    const [passcodeInput, setPasscodeInput] = useState<string>('');
    const [passcodeSent, setPasscodeSent] = useState<boolean>(false);
    const [isConnecting, setIsConnecting] = useState<boolean>(false);

    const loadVieleData = async (isManualSync = false) => {
        try {
            if (isManualSync) setIsSyncing(true);
            else setIsLoading(true);

            const params = new URLSearchParams();
            if (startDate) params.set('startDate', startDate);
            if (endDate) params.set('endDate', endDate);

            const res = await fetch(`/api/quickbooks/viele-bills?${params.toString()}`);
            const data = await res.json().catch(() => null);

            if (!res.ok || !data?.success) {
                throw new Error(data?.error || `HTTP ${res.status}: Error al sincronizar facturas de Viele & Sons`);
            }

            setRecords(Array.isArray(data.records) ? data.records : []);
            setStoreStatuses(Array.isArray(data.storeStatuses) ? data.storeStatuses : []);

            if (isManualSync) {
                onNotify({
                    type: 'success',
                    text: t('create_bills.toast_synced')
                });
            }
        } catch (err: any) {
            console.error('[VieleWholesailBillsTab] Error loading data:', err);
            onNotify({
                type: 'error',
                text: err?.message || 'Error al cargar facturas de Viele & Sons'
            });
        } finally {
            setIsLoading(false);
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        loadVieleData(false);
    }, [startDate, endDate]);

    useEffect(() => {
        setSelectedKeys(new Set());
    }, [selectedStore, selectedCategory]);

    // Store options sorted A-Z
    const storeOptions = useMemo(() => {
        const connectedMap = new Map<number, boolean>();
        for (const s of storeStatuses) {
            connectedMap.set(s.storeId, s.connected);
        }
        return Object.values(STORE_QB_MAPPINGS)
            .map((m) => ({
                id: m.storeId,
                name: m.storeName,
                connected: connectedMap.get(Number(m.storeId)) ?? m.storeId === '5'
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [storeStatuses]);

    const connectedStoresCount = useMemo(() => {
        if (storeStatuses.length === 0) return 1;
        return storeStatuses.filter((s) => s.connected).length;
    }, [storeStatuses]);

    // Scoped records by store + category for reactive KPIs
    const scopedRecords = useMemo(() => {
        return records.filter((r) => {
            if (selectedStore !== 'all' && r.storeId !== selectedStore) return false;
            if (selectedCategory !== 'all' && r.category !== selectedCategory) return false;
            return true;
        });
    }, [records, selectedStore, selectedCategory]);

    const displaySummary = useMemo(() => {
        let pendingCount = 0;
        let createdCount = 0;
        let pendingAmount = 0;
        let createdAmount = 0;
        let totalAmount = 0;
        let sodasCount = 0;
        let suppliesCount = 0;
        let chemicalsCount = 0;

        for (const r of scopedRecords) {
            const amt = Number(r.totalAmount) || 0;
            totalAmount += amt;
            if (r.hasBill) {
                createdCount++;
                createdAmount += amt;
            } else {
                pendingCount++;
                pendingAmount += amt;
            }
            if (r.category === 'SODAS') sodasCount++;
            else if (r.category === 'CHEMICALS') chemicalsCount++;
            else suppliesCount++;
        }

        return {
            totalCount: scopedRecords.length,
            pendingCount,
            createdCount,
            pendingAmount: Math.round(pendingAmount * 100) / 100,
            createdAmount: Math.round(createdAmount * 100) / 100,
            totalAmount: Math.round(totalAmount * 100) / 100,
            sodasCount,
            suppliesCount,
            chemicalsCount
        };
    }, [scopedRecords]);

    // Filtered & searched records
    const filteredRecords = useMemo(() => {
        return scopedRecords.filter((r) => {
            if (selectedStatus === 'pending' && r.hasBill) return false;
            if (selectedStatus === 'created' && !r.hasBill) return false;

            if (searchTerm.trim() !== '') {
                const term = searchTerm.toLowerCase().replace(/[#$,]/g, '').trim();
                const matchDoc = r.docNumber.toLowerCase().includes(term) || r.documentId.toLowerCase().includes(term);
                const matchPo = (r.poNumber || '').toLowerCase().includes(term);
                const matchStore = r.storeName.toLowerCase().includes(term) || r.sageCustomerCode.toLowerCase().includes(term);
                const rawAmt = r.totalAmount.toString();
                const fmtAmt = formatCurrency(r.totalAmount).toLowerCase().replace(/[$,]/g, '');
                const matchAmt = rawAmt.includes(term) || fmtAmt.includes(term);
                const matchDate = r.txnDate.includes(term) || r.dueDate.includes(term);
                const matchItems = r.lineItems.some(
                    (li) => li.productId.toLowerCase().includes(term) || li.productName.toLowerCase().includes(term)
                );

                if (!matchDoc && !matchPo && !matchStore && !matchAmt && !matchDate && !matchItems) {
                    return false;
                }
            }

            return true;
        });
    }, [scopedRecords, selectedStatus, searchTerm]);

    // Sorted records
    const sortedRecords = useMemo(() => {
        const list = [...filteredRecords];
        return list.sort((a, b) => {
            const dir = sortConfig.direction === 'asc' ? 1 : -1;

            if (sortConfig.key === 'txnDate') {
                const cmp = a.txnDate.localeCompare(b.txnDate);
                if (cmp !== 0) return cmp * dir;
                return a.docNumber.localeCompare(b.docNumber) * dir;
            }
            if (sortConfig.key === 'dueDate') {
                const cmp = a.dueDate.localeCompare(b.dueDate);
                if (cmp !== 0) return cmp * dir;
                return a.docNumber.localeCompare(b.docNumber) * dir;
            }
            if (sortConfig.key === 'docNumber') {
                return a.docNumber.localeCompare(b.docNumber) * dir;
            }
            if (sortConfig.key === 'storeName') {
                const cmp = a.storeName.localeCompare(b.storeName);
                if (cmp !== 0) return cmp * dir;
                return b.txnDate.localeCompare(a.txnDate);
            }
            if (sortConfig.key === 'category') {
                const cmp = a.category.localeCompare(b.category);
                if (cmp !== 0) return cmp * dir;
                return b.txnDate.localeCompare(a.txnDate);
            }
            if (sortConfig.key === 'totalAmount') {
                const diff = a.totalAmount - b.totalAmount;
                if (diff !== 0) return diff * dir;
                return b.txnDate.localeCompare(a.txnDate);
            }
            if (sortConfig.key === 'hasBill') {
                const valA = a.hasBill ? 1 : 0;
                const valB = b.hasBill ? 1 : 0;
                if (valA !== valB) return (valA - valB) * dir;
                return b.txnDate.localeCompare(a.txnDate);
            }
            return 0;
        });
    }, [filteredRecords, sortConfig]);

    const requestSort = (key: SortKey) => {
        setSortConfig((prev) => ({
            key,
            direction: prev.key === key ? (prev.direction === 'asc' ? 'desc' : 'asc') : 'desc'
        }));
    };

    const getRecordKey = (r: VieleWholesailInvoiceRecord) => `${r.storeId}_${r.docNumber}`;

    const toggleSelectRecord = (r: VieleWholesailInvoiceRecord) => {
        const key = getRecordKey(r);
        setSelectedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const handleSelectAllVisiblePending = () => {
        const pendingVisible = sortedRecords.filter((r) => !r.hasBill);
        const allSelected = pendingVisible.length > 0 && pendingVisible.every((r) => selectedKeys.has(getRecordKey(r)));

        setSelectedKeys((prev) => {
            const next = new Set(prev);
            if (allSelected) {
                pendingVisible.forEach((r) => next.delete(getRecordKey(r)));
            } else {
                pendingVisible.forEach((r) => next.add(getRecordKey(r)));
            }
            return next;
        });
    };

    const selectedRecordsList = useMemo(() => {
        return records.filter((r) => !r.hasBill && selectedKeys.has(getRecordKey(r)));
    }, [records, selectedKeys]);

    const selectedTotalAmount = useMemo(() => {
        const sum = selectedRecordsList.reduce((acc, r) => acc + r.totalAmount, 0);
        return Math.round(sum * 100) / 100;
    }, [selectedRecordsList]);

    const handleCreateSingleBill = async () => {
        const rec = confirmSingleModal.record;
        if (!rec) return;
        setIsSubmitting(true);

        try {
            const res = await fetch('/api/quickbooks/viele-bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_bills',
                    invoices: [
                        {
                            docNumber: rec.docNumber,
                            txnDate: rec.txnDate,
                            totalAmount: rec.totalAmount,
                            storeId: rec.storeId,
                            poNumber: rec.poNumber,
                            expenseSplits: rec.expenseSplits
                        }
                    ]
                })
            });

            const data = await res.json();
            const firstResult = data?.results?.[0];

            if (!res.ok || !firstResult?.success) {
                throw new Error(firstResult?.error || data?.error || 'Error al crear el Bill en QuickBooks Online');
            }

            onNotify({
                type: 'success',
                text: t('create_bills.success_single').replace('{id}', String(firstResult.billId || rec.docNumber))
            });

            setConfirmSingleModal({ isOpen: false });
            setSelectedKeys((prev) => {
                const next = new Set(prev);
                next.delete(getRecordKey(rec));
                return next;
            });

            await loadVieleData(false);
        } catch (err: any) {
            onNotify({
                type: 'error',
                text: err?.message || 'Error al crear el Bill'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCreateBatchBills = async () => {
        if (selectedRecordsList.length === 0) return;
        setIsSubmitting(true);

        try {
            const payload = selectedRecordsList.map((rec) => ({
                docNumber: rec.docNumber,
                txnDate: rec.txnDate,
                totalAmount: rec.totalAmount,
                storeId: rec.storeId,
                poNumber: rec.poNumber,
                expenseSplits: rec.expenseSplits
            }));

            const res = await fetch('/api/quickbooks/viele-bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_bills',
                    invoices: payload
                })
            });

            const data = await res.json();
            const successCount = (data?.results || []).filter((r: any) => r.success).length;

            if (successCount > 0) {
                onNotify({
                    type: 'success',
                    text: t('create_bills.success_batch').replace('{success}', String(successCount))
                });
                setBatchModalOpen(false);
                setSelectedKeys(new Set());
                await loadVieleData(false);
            } else {
                throw new Error(data?.results?.[0]?.error || data?.error || t('create_bills.error_batch'));
            }
        } catch (err: any) {
            onNotify({
                type: 'error',
                text: err?.message || t('create_bills.error_batch')
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConnectWholesailLink = async () => {
        if (!wholesailUrlInput.trim()) return;
        setIsConnecting(true);
        try {
            const res = await fetch('/api/quickbooks/viele-bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'connect_wholesail_link',
                    urlOrToken: wholesailUrlInput.trim(),
                    storeId: selectedStore !== 'all' ? Number(selectedStore) : undefined
                })
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || 'No se pudo vincular el enlace de Wholesail');
            }
            onNotify({
                type: 'success',
                text: t('create_bills.viele_link_saved_toast').replace(
                    '{count}',
                    String(data.connectedStores?.length || 1)
                )
            });
            setWholesailUrlInput('');
            setConnectModalOpen(false);
            await loadVieleData(true);
        } catch (err: any) {
            onNotify({
                type: 'error',
                text: err?.message || 'Error al vincular enlace de Wholesail'
            });
        } finally {
            setIsConnecting(false);
        }
    };

    const handleSendPasscode = async () => {
        setIsConnecting(true);
        try {
            const res = await fetch('/api/quickbooks/viele-bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'request_wholesail_passcode',
                    emailAddress: passcodeEmail
                })
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || 'Error al enviar código de verificación');
            }
            setPasscodeSent(true);
            onNotify({
                type: 'success',
                text: t('create_bills.viele_code_sent_toast').replace('{email}', data.emailAddress || passcodeEmail)
            });
        } catch (err: any) {
            onNotify({
                type: 'error',
                text: err?.message || 'Error al solicitar código'
            });
        } finally {
            setIsConnecting(false);
        }
    };

    const handleVerifyPasscode = async () => {
        if (!passcodeInput.trim()) return;
        setIsConnecting(true);
        try {
            const res = await fetch('/api/quickbooks/viele-bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'verify_wholesail_passcode',
                    emailAddress: passcodeEmail,
                    code: passcodeInput.trim()
                })
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || 'Código inválido o expirado');
            }
            onNotify({
                type: 'success',
                text: t('create_bills.viele_link_saved_toast').replace(
                    '{count}',
                    String(data.connectedStores?.length || 15)
                )
            });
            setPasscodeInput('');
            setPasscodeSent(false);
            setConnectModalOpen(false);
            await loadVieleData(true);
        } catch (err: any) {
            onNotify({
                type: 'error',
                text: err?.message || 'Error al verificar código'
            });
        } finally {
            setIsConnecting(false);
        }
    };

    const renderCategoryBadge = (rec: VieleWholesailInvoiceRecord) => {
        if (rec.category === 'SODAS') {
            return (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                    <span>🥤</span>
                    <span>{t('create_bills.viele_badge_sodas')}</span>
                </span>
            );
        }
        if (rec.category === 'CHEMICALS') {
            return (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                    <span>🧼</span>
                    <span>{t('create_bills.viele_badge_chemicals')}</span>
                </span>
            );
        }
        if (rec.category === 'SUPPLIES_SPLIT') {
            return (
                <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                        <span>🧪</span>
                        <span>{t('create_bills.viele_badge_supplies_split')}</span>
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                        {rec.expenseSplits.map((sp, idx) => (
                            <span
                                key={idx}
                                className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                            >
                                {sp.accountId === '79' ? '51170' : '53050'}: {formatCurrency(sp.amount)}
                            </span>
                        ))}
                    </div>
                </div>
            );
        }
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                <span>📦</span>
                <span>{t('create_bills.viele_badge_supplies')}</span>
            </span>
        );
    };

    return (
        <div className="space-y-6">
            {/* SUBHEADER & SYNC BAR */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <div className="space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600 text-white">
                            Vendor ID: 1 • Viele & Sons
                        </span>
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            Terms: Net 60 (+60 {language === 'en' ? 'days' : 'días'})
                        </span>
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            50001 Beverages • 53050 Supplies • 51170 Janitorial
                        </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
                        {t('create_bills.viele_subtitle')}
                    </p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                        onClick={() => setConnectModalOpen(true)}
                        className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-xl transition-all border border-indigo-200 dark:border-indigo-800 cursor-pointer"
                    >
                        <Link2 className="w-4 h-4" />
                        <span>{t('create_bills.viele_connect_btn')}</span>
                    </button>

                    <button
                        onClick={() => loadVieleData(true)}
                        disabled={isSyncing || isLoading}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all border border-slate-200 dark:border-slate-700 shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-emerald-600' : ''}`} />
                        <span>{isSyncing ? t('create_bills.syncing') : t('create_bills.viele_sync_btn')}</span>
                    </button>
                </div>
            </div>

            {/* SUMMARY KPIS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Pending Bills */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                            {t('create_bills.kpi_pending')}
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
                        {t('create_bills.kpi_pending_sub')}
                    </p>
                </div>

                {/* Created Bills */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                            {t('create_bills.kpi_created')}
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
                        {t('create_bills.kpi_created_sub')}
                    </p>
                </div>

                {/* Total Invoiced (with 3-type breakdown) */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                            {t('create_bills.kpi_total')}
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
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        <span>🥤 {displaySummary.sodasCount}</span>
                        <span>•</span>
                        <span>📦 {displaySummary.suppliesCount}</span>
                        <span>•</span>
                        <span>🧼 {displaySummary.chemicalsCount}</span>
                    </div>
                </div>

                {/* Wholesail Connection Status */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                            {t('create_bills.viele_kpi_wholesail')}
                        </span>
                        <div className="p-2 bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 rounded-lg">
                            <ShieldCheck className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <span className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                            Wholesail API
                        </span>
                        <span className="text-xs font-bold px-2 py-0.5 bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 rounded-full border border-purple-200 dark:border-purple-800">
                            3/3 Semanal
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {t('create_bills.viele_kpi_stores_linked').replace('{count}', String(connectedStoresCount))}
                    </p>
                </div>
            </div>

            {/* FILTERS & SEARCH BAR */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                        {/* Store Selector */}
                        <div className="relative">
                            <select
                                value={selectedStore}
                                onChange={(e) => setSelectedStore(e.target.value)}
                                aria-label={t('create_bills.filter_store')}
                                className="pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 appearance-none cursor-pointer"
                            >
                                <option value="all">{t('create_bills.all_stores')}</option>
                                {storeOptions.map((store) => (
                                    <option key={store.id} value={store.id}>
                                        {store.name} {store.connected ? '• WS ✓' : ''}
                                    </option>
                                ))}
                            </select>
                            <Building2 className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>

                        {/* Category Selector */}
                        <div className="relative">
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value as 'all' | VieleInvoiceCategory)}
                                aria-label={t('create_bills.viele_th_category')}
                                className="pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 appearance-none cursor-pointer"
                            >
                                <option value="all">{t('create_bills.viele_cat_all')}</option>
                                <option value="SODAS">{t('create_bills.viele_cat_sodas')}</option>
                                <option value="SUPPLIES">{t('create_bills.viele_cat_supplies')}</option>
                                <option value="SUPPLIES_SPLIT">{t('create_bills.viele_cat_supplies_split')}</option>
                                <option value="CHEMICALS">{t('create_bills.viele_cat_chemicals')}</option>
                            </select>
                            <Layers className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>

                        {/* Date Range */}
                        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-slate-500 font-semibold">{t('create_bills.viele_date_from')}:</span>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="bg-transparent font-bold text-slate-800 dark:text-slate-200 focus:outline-none"
                            />
                            <span className="text-slate-400">—</span>
                            <span className="text-slate-500 font-semibold">{t('create_bills.viele_date_to')}:</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="bg-transparent font-bold text-slate-800 dark:text-slate-200 focus:outline-none"
                            />
                        </div>

                        {/* Status Tabs */}
                        <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                            <button
                                onClick={() => setSelectedStatus('all')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                    selectedStatus === 'all'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                {t('create_bills.status_all')} ({displaySummary.totalCount})
                            </button>
                            <button
                                onClick={() => setSelectedStatus('pending')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                    selectedStatus === 'pending'
                                        ? 'bg-amber-500 text-white shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-200"></span>
                                {t('create_bills.status_pending')} ({displaySummary.pendingCount})
                            </button>
                            <button
                                onClick={() => setSelectedStatus('created')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                    selectedStatus === 'created'
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-200"></span>
                                {t('create_bills.status_created')} ({displaySummary.createdCount})
                            </button>
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="relative flex-1 min-w-[240px] max-w-md">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder={t('create_bills.search_placeholder')}
                            className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* BATCH ACTION BAR */}
            {selectedRecordsList.length > 0 && (
                <div className="sticky top-4 z-30 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/80 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-600 text-white rounded-lg shrink-0">
                            <CheckSquare className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-bold text-emerald-950 dark:text-emerald-100">
                                    {t('create_bills.batch_bar_count').replace('{count}', String(selectedRecordsList.length))}
                                </p>
                                <span className="text-xs font-bold font-mono px-2 py-0.5 bg-emerald-200/80 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200 rounded-md">
                                    {t('create_bills.batch_bar_amount').replace('{amount}', formatCurrency(selectedTotalAmount))}
                                </span>
                            </div>
                            <p className="text-xs text-emerald-700 dark:text-emerald-300">
                                {t('create_bills.viele_batch_bar_desc')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setSelectedKeys(new Set())}
                            disabled={isSubmitting}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-50 cursor-pointer"
                        >
                            {t('create_bills.btn_deselect')}
                        </button>
                        <button
                            onClick={() => setBatchModalOpen(true)}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                        >
                            <Sparkles className="w-4 h-4" />
                            <span>
                                {t('create_bills.batch_create_btn')} ({selectedRecordsList.length})
                            </span>
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
                                        className="text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                                    >
                                        <CheckSquare className="w-4 h-4" />
                                    </button>
                                </th>
                                <th
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('docNumber')}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.th_invoice')}</span>
                                        {sortConfig.key === 'docNumber' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40" />
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('txnDate')}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.th_date')}</span>
                                        {sortConfig.key === 'txnDate' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40" />
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('dueDate')}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.th_due_date')} (Net 60)</span>
                                        {sortConfig.key === 'dueDate' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40" />
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('storeName')}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.th_store')}</span>
                                        {sortConfig.key === 'storeName' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40" />
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="p-4 cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('category')}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span>{t('create_bills.viele_th_category')}</span>
                                        {sortConfig.key === 'category' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40" />
                                        )}
                                    </div>
                                </th>
                                <th className="p-4">{t('create_bills.viele_th_po')}</th>
                                <th
                                    className="p-4 text-right cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('totalAmount')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">
                                        <span>{t('create_bills.th_amount')}</span>
                                        {sortConfig.key === 'totalAmount' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40" />
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="p-4 text-center cursor-pointer hover:bg-slate-100/75 dark:hover:bg-slate-800/80 transition-colors select-none group"
                                    onClick={() => requestSort('hasBill')}
                                >
                                    <div className="flex items-center justify-center gap-1.5">
                                        <span>{t('create_bills.th_status')}</span>
                                        {sortConfig.key === 'hasBill' ? (
                                            sortConfig.direction === 'asc' ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-emerald-600" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-emerald-600" />
                                            )
                                        ) : (
                                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40" />
                                        )}
                                    </div>
                                </th>
                                <th className="p-4 text-right">{t('create_bills.th_actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={10} className="p-12 text-center text-slate-400">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
                                            <p className="font-semibold text-slate-600 dark:text-slate-300">
                                                {t('create_bills.loading_invoices')}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : sortedRecords.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-12 text-center text-slate-400">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <Receipt className="w-10 h-10 stroke-1 text-slate-300 dark:text-slate-600" />
                                            <p className="font-semibold text-slate-600 dark:text-slate-300">
                                                {t('create_bills.no_invoices')}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                sortedRecords.map((rec) => {
                                    const rKey = getRecordKey(rec);
                                    const isSelected = selectedKeys.has(rKey);
                                    return (
                                        <tr
                                            key={rKey}
                                            className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                                                isSelected ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''
                                            }`}
                                        >
                                            {/* Select Checkbox */}
                                            <td className="p-4 text-center">
                                                {rec.hasBill ? (
                                                    <span className="text-emerald-500 opacity-40">
                                                        <Check className="w-4 h-4 mx-auto" />
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={() => toggleSelectRecord(rec)}
                                                        disabled={isSubmitting}
                                                        className="text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50 cursor-pointer"
                                                    >
                                                        {isSelected ? (
                                                            <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                                        ) : (
                                                            <Square className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                )}
                                            </td>

                                            {/* Invoice # */}
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                                                        #{rec.docNumber}
                                                    </span>
                                                    <span className="text-[11px] font-mono text-slate-400">
                                                        WS: {rec.documentId}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* Invoice Date */}
                                            <td className="p-4 text-slate-700 dark:text-slate-300 font-medium font-mono text-xs">
                                                {rec.txnDate}
                                            </td>

                                            {/* Due Date (+60 days) */}
                                            <td className="p-4 text-slate-500 dark:text-slate-400 font-mono text-xs">
                                                {rec.dueDate}
                                            </td>

                                            {/* Store */}
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-slate-900 dark:text-white">
                                                        {rec.storeName}
                                                    </span>
                                                    <span className="text-[11px] font-mono text-slate-400">
                                                        {rec.departmentName} • {rec.sageCustomerCode}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* Category & GL Split */}
                                            <td className="p-4">{renderCategoryBadge(rec)}</td>

                                            {/* PO # & Wholesail Status */}
                                            <td className="p-4">
                                                <div className="flex flex-col gap-1">
                                                    {rec.poNumber ? (
                                                        <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                                                            {rec.poNumber}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-slate-400">—</span>
                                                    )}
                                                    <span
                                                        className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                                            rec.wholesailStatus === 'PAID'
                                                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                                : rec.overdue
                                                                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                                                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                                        }`}
                                                    >
                                                        {rec.wholesailStatus === 'PAID'
                                                            ? t('create_bills.viele_ws_paid')
                                                            : rec.overdue
                                                              ? t('create_bills.viele_ws_overdue')
                                                              : t('create_bills.viele_ws_unpaid')}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* Total Amount */}
                                            <td className="p-4 text-right font-bold text-slate-900 dark:text-white font-mono">
                                                {formatCurrency(rec.totalAmount)}
                                            </td>

                                            {/* QBO Bill Status */}
                                            <td className="p-4 text-center">
                                                {rec.hasBill ? (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shadow-sm">
                                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                        {t('create_bills.badge_created')}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shadow-sm">
                                                        <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                                        {t('create_bills.badge_pending')}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="p-4 text-right">
                                                {rec.hasBill ? (
                                                    <button
                                                        onClick={() => setViewModal({ isOpen: true, record: rec })}
                                                        disabled={isSubmitting}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                        <span>{t('create_bills.btn_view_bill')}</span>
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => setConfirmSingleModal({ isOpen: true, record: rec })}
                                                        disabled={isSubmitting}
                                                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-sm hover:shadow transition-all cursor-pointer"
                                                    >
                                                        <Sparkles className="w-3.5 h-3.5" />
                                                        <span>{t('create_bills.btn_create_bill')}</span>
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

            {/* CONFIRM SINGLE BILL MODAL */}
            {confirmSingleModal.isOpen && confirmSingleModal.record && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !isSubmitting) {
                            setConfirmSingleModal({ isOpen: false });
                        }
                    }}
                >
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
                                    <Receipt className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                        {t('create_bills.modal_title')}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {t('create_bills.modal_subtitle')}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setConfirmSingleModal({ isOpen: false })}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-sm overflow-y-auto">
                            {confirmSingleModal.record.category === 'SUPPLIES_SPLIT' && (
                                <div className="p-3.5 rounded-xl bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 text-xs space-y-1">
                                    <p className="font-bold text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                                        <span>🧪</span>
                                        <span>{t('create_bills.viele_split_notice_title')}</span>
                                    </p>
                                    <p className="text-purple-700 dark:text-purple-300">
                                        {t('create_bills.viele_split_notice_desc')}
                                    </p>
                                </div>
                            )}

                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2.5 border border-slate-200/60 dark:border-slate-700/60">
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_vendor')}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        Viele & Sons (ID: 1)
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_doc_number')}:
                                    </span>
                                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                        #{confirmSingleModal.record.docNumber}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_location')} / {t('create_bills.field_class')}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {confirmSingleModal.record.departmentName}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                                        {t('create_bills.field_bill_date')} → {t('create_bills.field_due_date')}:
                                    </span>
                                    <span className="font-mono font-semibold text-slate-900 dark:text-white text-xs">
                                        {confirmSingleModal.record.txnDate} → {confirmSingleModal.record.dueDate} (Net 60)
                                    </span>
                                </div>
                            </div>

                            {/* GL Account Lines Breakdown */}
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    {t('create_bills.viele_lines_preview')}
                                </h4>
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
                                    {confirmSingleModal.record.expenseSplits.map((sp, idx) => (
                                        <div
                                            key={idx}
                                            className="p-3 bg-white dark:bg-slate-900 flex items-center justify-between text-xs"
                                        >
                                            <div>
                                                <p className="font-bold text-slate-900 dark:text-white">
                                                    {sp.accountName}
                                                </p>
                                                <p className="text-[11px] text-slate-400">
                                                    Class: {confirmSingleModal.record?.className}
                                                </p>
                                            </div>
                                            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                                                {formatCurrency(sp.amount)}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/70 flex items-center justify-between text-xs font-bold">
                                        <span className="text-slate-700 dark:text-slate-300 uppercase">
                                            {t('create_bills.field_amount')}:
                                        </span>
                                        <span className="font-mono text-base text-emerald-600 dark:text-emerald-400">
                                            {formatCurrency(confirmSingleModal.record.totalAmount)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Wholesail Line Items Preview */}
                            {confirmSingleModal.record.lineItems.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        {t('create_bills.viele_items_preview').replace(
                                            '{count}',
                                            String(confirmSingleModal.record.lineItems.length)
                                        )}
                                    </h4>
                                    <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-2 text-xs">
                                        {confirmSingleModal.record.lineItems.map((li, idx) => (
                                            <div key={idx} className="py-1.5 px-2 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${
                                                            li.isBleach
                                                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                                                : 'bg-slate-200/70 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                                                        }`}
                                                    >
                                                        {li.productId}
                                                    </span>
                                                    <span className="text-slate-700 dark:text-slate-300 truncate max-w-[240px]">
                                                        {li.productName}
                                                    </span>
                                                    <span className="text-slate-400 font-mono">x{li.quantity}</span>
                                                </div>
                                                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                                                    {formatCurrency(li.totalAmount)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button
                                onClick={() => setConfirmSingleModal({ isOpen: false })}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                                {t('create_bills.cancel')}
                            </button>
                            <button
                                onClick={handleCreateSingleBill}
                                disabled={isSubmitting}
                                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                            >
                                {isSubmitting ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        <span>{t('create_bills.creating')}</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4" />
                                        <span>{t('create_bills.confirm_create')}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* BATCH CREATE MODAL */}
            {batchModalOpen && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !isSubmitting) {
                            setBatchModalOpen(false);
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
                                        {t('create_bills.batch_create_confirm').replace(
                                            '{count}',
                                            String(selectedRecordsList.length)
                                        )}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Viele & Sons (Vendor ID: 1 • Net 60)
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setBatchModalOpen(false)}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-sm">
                            <p className="text-slate-600 dark:text-slate-300 text-xs">
                                {t('create_bills.viele_batch_bar_desc')}
                            </p>

                            <div className="max-h-56 overflow-y-auto bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
                                {selectedRecordsList.map((rec) => (
                                    <div key={getRecordKey(rec)} className="py-2 flex items-center justify-between text-xs">
                                        <div>
                                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                                                #{rec.docNumber}
                                            </span>
                                            <span className="ml-2 text-slate-500">
                                                {rec.storeName} • {rec.txnDate}
                                            </span>
                                        </div>
                                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                            {formatCurrency(rec.totalAmount)}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-2 px-1 flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                                <span>{t('create_bills.batch_modal_total')}:</span>
                                <span className="font-mono text-emerald-600 dark:text-emerald-400 text-sm">
                                    {formatCurrency(selectedTotalAmount)}
                                </span>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                            <button
                                onClick={() => setBatchModalOpen(false)}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                                {t('create_bills.cancel')}
                            </button>
                            <button
                                onClick={handleCreateBatchBills}
                                disabled={isSubmitting}
                                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                            >
                                {isSubmitting ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        <span>{t('create_bills.creating')}</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4" />
                                        <span>
                                            {t('create_bills.batch_create_btn')} ({selectedRecordsList.length})
                                        </span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* VIEW BILL DETAILS MODAL */}
            {viewModal.isOpen && viewModal.record && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setViewModal({ isOpen: false });
                        }
                    }}
                >
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
                                    <CheckCircle2 className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                        {t('create_bills.modal_details_title')}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {t('create_bills.modal_details_subtitle')}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setViewModal({ isOpen: false })}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-sm overflow-y-auto">
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2.5 border border-slate-200/60 dark:border-slate-700/60 text-xs">
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_bill_id')}:
                                    </span>
                                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                                        {viewModal.record.bill?.billId}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_doc_number')}:
                                    </span>
                                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                        #{viewModal.record.bill?.docNumber || viewModal.record.docNumber}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_vendor')}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {viewModal.record.bill?.vendorName || 'Viele & Sons'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_location')}:
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {viewModal.record.bill?.departmentName || viewModal.record.departmentName}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 dark:text-slate-400">
                                        {t('create_bills.field_bill_date')} → {t('create_bills.field_due_date')}:
                                    </span>
                                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                                        {viewModal.record.bill?.txnDate || viewModal.record.txnDate} →{' '}
                                        {viewModal.record.bill?.dueDate || viewModal.record.dueDate}
                                    </span>
                                </div>
                            </div>

                            {/* GL Account Lines */}
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    {t('create_bills.viele_lines_preview')}
                                </h4>
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
                                    {(viewModal.record.bill?.lines || viewModal.record.expenseSplits).map((sp, idx) => (
                                        <div
                                            key={idx}
                                            className="p-3 bg-white dark:bg-slate-900 flex items-center justify-between text-xs"
                                        >
                                            <span className="font-bold text-slate-900 dark:text-white">
                                                {sp.accountName}
                                            </span>
                                            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                {formatCurrency(sp.amount)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                            <button
                                onClick={() => setViewModal({ isOpen: false })}
                                className="px-5 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold rounded-xl hover:opacity-90 transition-opacity cursor-pointer"
                            >
                                {t('create_bills.understood')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* CONNECT WHOLESAIL STORES MODAL */}
            {connectModalOpen && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !isConnecting) {
                            setConnectModalOpen(false);
                        }
                    }}
                >
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
                                    <Link2 className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                        {t('create_bills.viele_connect_title')}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {t('create_bills.viele_kpi_stores_linked').replace(
                                            '{count}',
                                            String(connectedStoresCount)
                                        )}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setConnectModalOpen(false)}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-5 text-sm overflow-y-auto">
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                                {t('create_bills.viele_connect_desc')}
                            </p>

                            {/* Option 1: Paste Wholesail Statement Link */}
                            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                    {t('create_bills.viele_paste_link_label')}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={wholesailUrlInput}
                                        onChange={(e) => setWholesailUrlInput(e.target.value)}
                                        placeholder={t('create_bills.viele_paste_link_placeholder')}
                                        className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                                    />
                                    <button
                                        onClick={handleConnectWholesailLink}
                                        disabled={isConnecting || !wholesailUrlInput.trim()}
                                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer shrink-0"
                                    >
                                        {t('create_bills.viele_btn_save_link')}
                                    </button>
                                </div>
                            </div>

                            {/* Option 2: Email Passcode for ap@tacosgavilan.com */}
                            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                    {t('create_bills.viele_passcode_label')}
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <input
                                        type="email"
                                        value={passcodeEmail}
                                        onChange={(e) => setPasscodeEmail(e.target.value)}
                                        className="flex-1 min-w-[180px] px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                                    />
                                    <button
                                        onClick={handleSendPasscode}
                                        disabled={isConnecting}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer"
                                    >
                                        <Mail className="w-3.5 h-3.5" />
                                        <span>{t('create_bills.viele_btn_send_code')}</span>
                                    </button>
                                </div>

                                {passcodeSent && (
                                    <div className="flex gap-2 pt-2">
                                        <input
                                            type="text"
                                            value={passcodeInput}
                                            onChange={(e) => setPasscodeInput(e.target.value)}
                                            placeholder={t('create_bills.viele_code_placeholder')}
                                            className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                                        />
                                        <button
                                            onClick={handleVerifyPasscode}
                                            disabled={isConnecting || !passcodeInput.trim()}
                                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer"
                                        >
                                            <KeyRound className="w-3.5 h-3.5" />
                                            <span>{t('create_bills.viele_btn_verify_code')}</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Store Status Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                                {storeStatuses.map((st) => (
                                    <div
                                        key={st.storeId}
                                        className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                                            st.connected
                                                ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                                                : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-500'
                                        }`}
                                    >
                                        <div className="truncate">
                                            <p className="font-bold truncate">{st.storeName}</p>
                                            <p className="text-[10px] font-mono opacity-75">{st.sageCustomerCode}</p>
                                        </div>
                                        {st.connected ? (
                                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                        ) : (
                                            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                            <button
                                onClick={() => setConnectModalOpen(false)}
                                className="px-5 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold rounded-xl hover:opacity-90 transition-opacity cursor-pointer"
                            >
                                {t('create_bills.understood')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
