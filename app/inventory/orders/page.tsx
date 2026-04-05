'use client'

import { useState, useEffect } from 'react'
import { Check, ChevronDown, Save, Copy, ArrowLeft, ArrowRight, Link, RefreshCcw, X } from 'lucide-react'
import { fetchWeeklyOrdersData, updateWeeklyBase, updateDailyLeftover, clonePreviousWeekBases, linkExcelItem } from './actions'
import { useAuth } from '@/components/ProtectedRoute'
import { createClient } from '@/lib/supabase-client'

export function getMonday(d: Date) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff)).toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number) {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

type ItemRow = { id: string, name: string, unit_type: string, excel_reference?: string };
type BaseRecord = { inventory_item_id: string, mon_par: number, tue_par: number, wed_par: number, thu_par: number, fri_par: number, sat_par: number, sun_par: number };

const EXCEL_ITEMS = [
    "Horchata", "Tamarindo", "Jamaica", "Piña", "Salsa Roja Bag", "Salsa Verde Bag",
    "1.5 oz Salsa Roja", "1.5 oz Salsa Verde", "1.5 oz Salsa Roja Taquera",
    "Carne Asada", "Pastor", "Cabeza", "Lengua", "Buche", "Carnitas", "Pollo", "Chorizo",
    "Salchicha Bag", "Milaneza", "Jamon Pack", "Arroz", "Frijol Entero", "Frijol Molido",
    "papelitos tortas", "1 oz Bolsa de Mixta", "Onion/Cilantro Mixta", "Aguacate 2 lbs", 
    "Mulitas", "Bolsa Crema 1.5 lbs", "Mayonesa 5 lbs", "Queso Rayado 2.5 lb", "Queso Cotija",
    "Queso Tortas/Platos/Desayu", "Quesadilla Bodega", "Huevos/Eggs", "Salsa Huevos Rancheros",
    "Rajas en vinagre", "2 oz Rajas & Zanahoria", "Onion pepper mix", "Lima Bolsita", 
    "Lima Bolsa (5 lbs)", "Champurrado Mix", "Amarillo Cheese", "Tortillas, Nacho", 
    "Tortillas, Tacos y Platos", "Tortillas, Burritos", "Tortillas, Regular 8 in.",
    "Teleras", "Sopes", "Viva Lard (Manteca)", "Flan", "Cheesecake"
];

const EXCEL_PARS: Record<string, any> = {
  "Horchata": { mon: 45, tue: 55, wed: 55, thu: 55, fri: null, sat: 135, sun: null },
  "Tamarindo": { mon: 15, tue: 15, wed: 15, thu: 15, fri: null, sat: 35, sun: null },
  "Jamaica": { mon: 22, tue: 22, wed: 25, thu: 25, fri: null, sat: 60, sun: null },
  "Piña": { mon: 20, tue: 20, wed: 25, thu: 25, fri: null, sat: 50, sun: null },
  "Salsa Roja Bag": { mon: 2, tue: 2, wed: 2, thu: 2, fri: null, sat: 6, sun: null },
  "Salsa Verde Bag": { mon: 2, tue: 2, wed: 2, thu: 2, fri: null, sat: 6, sun: null },
  "1.5 oz Salsa Roja": { mon: 3, tue: 3, wed: 3, thu: 3, fri: null, sat: 5, sun: null },
  "1.5 oz Salsa Verde": { mon: 5, tue: 5, wed: 5, thu: 5, fri: null, sat: 10, sun: null },
  "1.5 oz Salsa Roja Taquera": { mon: 3, tue: 3, wed: 3, thu: 3, fri: null, sat: 8, sun: null },
  "Carne Asada": { mon: 45, tue: 50, wed: 58, thu: 58, fri: null, sat: 130, sun: null },
  "Pastor": { mon: 15, tue: 15, wed: 17, thu: 17, fri: null, sat: 40, sun: null },
  "Cabeza": { mon: 10, tue: 11, wed: 12, thu: 12, fri: null, sat: 25, sun: null },
  "Lengua": { mon: 6, tue: 7, wed: 7, thu: 7, fri: null, sat: 20, sun: null },
  "Buche": { mon: 35, tue: 35, wed: 40, thu: 40, fri: null, sat: 100, sun: null },
  "Carnitas": { mon: 40, tue: 40, wed: 50, thu: 50, fri: null, sat: 110, sun: null },
  "Pollo": { mon: 12, tue: 13, wed: 14, thu: 14, fri: null, sat: 30, sun: null },
  "Chorizo": { mon: 35, tue: 35, wed: 45, thu: 45, fri: null, sat: 110, sun: null },
  "Salchicha Bag": { mon: 3, tue: 3, wed: 3, thu: 3, fri: null, sat: 7, sun: null },
  "Milaneza": { mon: 5, tue: 5, wed: 5, thu: 5, fri: null, sat: 10, sun: null },
  "Jamon Pack": { mon: 2, tue: 2, wed: 2, thu: 2, fri: null, sat: 5, sun: null },
  "Arroz": { mon: 32, tue: 32, wed: 35, thu: 35, fri: null, sat: 85, sun: null },
  "Frijol Entero": { mon: 20, tue: 20, wed: 23, thu: 23, fri: null, sat: 55, sun: null },
  "Frijol Molido": { mon: 21, tue: 21, wed: 24, thu: 24, fri: null, sat: 55, sun: null },
  "papelitos tortas": { mon: 210, tue: 210, wed: 240, thu: 240, fri: null, sat: 600, sun: null },
  "1 oz Bolsa de Mixta": { mon: 5, tue: 5, wed: 5, thu: 5, fri: null, sat: 13, sun: null },
  "Onion/Cilantro Mixta": { mon: 3, tue: 3, wed: 4, thu: 4, fri: null, sat: 10, sun: null },
  "Aguacate 2 lbs": { mon: 38, tue: 42, wed: 45, thu: 45, fri: null, sat: 100, sun: null },
  "Mulitas": { mon: 15, tue: 15, wed: 15, thu: 15, fri: null, sat: 40, sun: null },
  "Bolsa Crema 1.5 lbs": { mon: 27, tue: 27, wed: 30, thu: 30, fri: null, sat: 60, sun: null },
  "Mayonesa 5 lbs": { mon: 4, tue: 4, wed: 5, thu: 5, fri: null, sat: 10, sun: null },
  "Queso Rayado 2.5 lb": { mon: 16, tue: 17, wed: 18, thu: 18, fri: null, sat: 38, sun: null },
  "Queso Cotija": { mon: 7, tue: 7, wed: 10, thu: 10, fri: null, sat: 13, sun: null },
  "Queso Tortas/Platos/Desayu": { mon: 2, tue: 1, wed: 2, thu: 2, fri: null, sat: 2, sun: null },
  "Quesadilla Bodega": { mon: 16, tue: 16, wed: 20, thu: 20, fri: null, sat: 40, sun: null },
  "Huevos/Eggs": { mon: 1, tue: 1, wed: 1, thu: 1, fri: null, sat: 1, sun: null },
  "Salsa Huevos Rancheros": { mon: 1, tue: 1, wed: 1, thu: 1, fri: null, sat: 3, sun: null },
  "Rajas en vinagre": { mon: 7, tue: 7, wed: 6, thu: 6, fri: null, sat: 12, sun: null },
  "2 oz Rajas & Zanahoria": { mon: 3, tue: 3, wed: 3, thu: 3, fri: null, sat: 7, sun: null },
  "Onion pepper mix": { mon: 22, tue: 22, wed: 24, thu: 24, fri: null, sat: 60, sun: null },
  "Lima Bolsita": { mon: 7, tue: 7, wed: 7, thu: 6, fri: null, sat: 15, sun: null },
  "Lima Bolsa (5 lbs)": { mon: 3, tue: 3, wed: 4, thu: 4, fri: null, sat: 10, sun: null },
  "Champurrado Mix": { mon: 12, tue: 12, wed: 12, thu: 13, fri: null, sat: 30, sun: null },
  "Amarillo Cheese": { mon: 5, tue: 0, wed: 0, thu: 0, fri: null, sat: 0, sun: null },
  "Tortillas, Nacho": { mon: 50, tue: 50, wed: 60, thu: 60, fri: null, sat: 130, sun: null },
  "Tortillas, Tacos y Platos": { mon: 80, tue: 100, wed: 85, thu: 85, fri: null, sat: 220, sun: null },
  "Tortillas, Burritos": { mon: 45, tue: 45, wed: 50, thu: 50, fri: null, sat: 115, sun: null },
  "Tortillas, Regular 8 in.": { mon: 8, tue: 8, wed: 8, thu: 8, fri: null, sat: 12, sun: null },
  "Teleras": { mon: 24, tue: 24, wed: 27, thu: 27, fri: null, sat: 77, sun: null },
  "Sopes": { mon: 12, tue: 12, wed: 15, thu: 15, fri: null, sat: 35, sun: null },
  "Viva Lard (Manteca)": { mon: 1, tue: 1, wed: 1, thu: 3, fri: null, sat: 3, sun: null },
  "Flan": { mon: 74, tue: 72, wed: null, thu: null, fri: null, sat: null, sun: null },
  "Cheesecake": { mon: 102, tue: 72, wed: null, thu: null, fri: null, sat: null, sun: null }
};

const EXCEL_SOBRANTES: Record<string, any> = {
  "Horchata": { mon: 10, tue: 22, wed: 23 },
  "Tamarindo": { mon: 7, tue: 8, wed: 9 },
  "Jamaica": { mon: 8, tue: 8, wed: 8 },
  "Piña": { mon: 13, tue: 10, wed: 15 },
  "Salsa Roja Bag": { mon: 2, tue: 0, wed: 1 },
  "Salsa Verde Bag": { mon: 1, tue: 0, wed: 0 },
  "1.5 oz Salsa Roja": { mon: 3, tue: 3, wed: 3 },
  "1.5 oz Salsa Verde": { mon: 3, tue: 3, wed: 3 },
  "1.5 oz Salsa Roja Taquera": { mon: 2, tue: 1, wed: 2 },
  "Carne Asada": { mon: 11, tue: 18, wed: 24 },
  "Pastor": { mon: 11, tue: 9, wed: 7 },
  "Cabeza": { mon: 4, tue: 5, wed: 5 },
  "Lengua": { mon: 5, tue: 4, wed: 4 },
  "Buche": { mon: 40, tue: 42, wed: 10 },
  "Carnitas": { mon: 23, tue: 16, wed: 20 },
  "Pollo": { mon: 7, tue: 7, wed: 6 },
  "Chorizo": { mon: 5, tue: 28, wed: 26 },
  "Salchicha Bag": { mon: 2, tue: 2, wed: 3 },
  "Milaneza": { mon: 3, tue: 3, wed: 3 },
  "Jamon Pack": { mon: 1, tue: 1, wed: 1 },
  "Arroz": { mon: 16, tue: 14, wed: 17 },
  "Frijol Entero": { mon: 10, tue: 8, wed: 10 },
  "Frijol Molido": { mon: 7, tue: 8, wed: 11 },
  "papelitos tortas": { mon: 60, tue: 60, wed: 60 },
  "1 oz Bolsa de Mixta": { mon: 3, tue: 3, wed: 2 },
  "Onion/Cilantro Mixta": { mon: 2, tue: 0, wed: 1 },
  "Aguacate 2 lbs": { mon: 16, tue: 14, wed: 20 },
  "Mulitas": { mon: 8, tue: 4, wed: 3 },
  "Bolsa Crema 1.5 lbs": { mon: 13, tue: 12, wed: 16 },
  "Mayonesa 5 lbs": { mon: 1, tue: 2, wed: 1 },
  "Queso Rayado 2.5 lb": { mon: 12, tue: 9, wed: 9 },
  "Queso Cotija": { mon: 2, tue: 6, wed: 5 },
  "Queso Tortas/Platos/Desayu": { mon: 2, tue: 0, wed: 0 },
  "Quesadilla Bodega": { mon: 8, tue: 10, wed: 12 },
  "Huevos/Eggs": { mon: 1, tue: 1, wed: 1 },
  "Salsa Huevos Rancheros": { mon: 0, tue: 1, wed: 0 },
  "Rajas en vinagre": { mon: 4, tue: 5, wed: 4 },
  "2 oz Rajas & Zanahoria": { mon: 2, tue: 2, wed: 1 },
  "Onion pepper mix": { mon: 7, tue: 7, wed: 6 },
  "Lima Bolsita": { mon: 3, tue: 4, wed: 1 },
  "Lima Bolsa (5 lbs)": { mon: 0, tue: 1, wed: 0 },
  "Champurrado Mix": { mon: 4, tue: 3, wed: 9 },
  "Amarillo Cheese": { mon: 5, tue: 4, wed: 4 },
  "Tortillas, Nacho": { mon: 30, tue: 20, wed: 20 },
  "Tortillas, Tacos y Platos": { mon: 25, tue: 38, wed: 16 },
  "Tortillas, Burritos": { mon: 24, tue: 13, wed: 15 },
  "Tortillas, Regular 8 in.": { mon: 7, tue: 6, wed: 6 },
  "Teleras": { mon: 3, tue: 5, wed: 3 },
  "Sopes": { mon: 4, tue: 3, wed: 3 },
  "Viva Lard (Manteca)": { mon: 2, tue: 0, wed: 2 }
};

export default function InventoryOrdersPage() {
    const { user } = useAuth()
    const supabase = createClient()
    
    const [activeMonday, setActiveMonday] = useState<string>(getMonday(new Date()))
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    
    // Tabs simulando el Excel
    const [activeTab, setActiveTab] = useState<'BASE' | 'ORDERS'>('BASE')
    
    const [loading, setLoading] = useState(true)
    const [dbItems, setDbItems] = useState<ItemRow[]>([])
    const [bases, setBases] = useState<Record<string, BaseRecord>>({})
    const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
    const [lastSundayCounts, setLastSundayCounts] = useState<Record<string, number>>({})

    const [mappingModal, setMappingModal] = useState<{ isOpen: boolean, excelName: string }>({ isOpen: false, excelName: '' })
    const [selectedDbItemId, setSelectedDbItemId] = useState('')
    const [searchTerm, setSearchTerm] = useState('')



    async function handleBulkMigrate() {
        if (!storeId || !confirm('¿Estás seguro de que quieres inyectar todos los datos del Excel permanentemente a la Base de Datos para esta semana?')) return;
        setLoading(true);
        try {
            for (const item of dbItems) {
                const excelName = item.excel_reference;
                if (!excelName) continue;
                
                const pars = EXCEL_PARS[excelName];
                if (pars) {
                    if (pars.mon !== undefined && pars.mon !== null) await updateWeeklyBase(storeId, item.id, activeMonday, 'mon_par', pars.mon);
                    if (pars.tue !== undefined && pars.tue !== null) await updateWeeklyBase(storeId, item.id, activeMonday, 'tue_par', pars.tue);
                    if (pars.wed !== undefined && pars.wed !== null) await updateWeeklyBase(storeId, item.id, activeMonday, 'wed_par', pars.wed);
                    if (pars.thu !== undefined && pars.thu !== null) await updateWeeklyBase(storeId, item.id, activeMonday, 'thu_par', pars.thu);
                    if (pars.fri !== undefined && pars.fri !== null) await updateWeeklyBase(storeId, item.id, activeMonday, 'fri_par', pars.fri);
                    if (pars.sat !== undefined && pars.sat !== null) await updateWeeklyBase(storeId, item.id, activeMonday, 'sat_par', pars.sat);
                    if (pars.sun !== undefined && pars.sun !== null) await updateWeeklyBase(storeId, item.id, activeMonday, 'sun_par', pars.sun);
                }

                const sobs = EXCEL_SOBRANTES[excelName];
                if (sobs) {
                    if (sobs.mon !== undefined) await updateDailyLeftover(storeId, item.id, addDays(activeMonday, 0), sobs.mon);
                    if (sobs.tue !== undefined) await updateDailyLeftover(storeId, item.id, addDays(activeMonday, 1), sobs.tue);
                    if (sobs.wed !== undefined) await updateDailyLeftover(storeId, item.id, addDays(activeMonday, 2), sobs.wed);
                    if (sobs.thu !== undefined) await updateDailyLeftover(storeId, item.id, addDays(activeMonday, 3), sobs.thu);
                    if (sobs.fri !== undefined) await updateDailyLeftover(storeId, item.id, addDays(activeMonday, 4), sobs.fri);
                    if (sobs.sat !== undefined) await updateDailyLeftover(storeId, item.id, addDays(activeMonday, 5), sobs.sat);
                    if (sobs.sun !== undefined) await updateDailyLeftover(storeId, item.id, addDays(activeMonday, 6), sobs.sun);
                }
            }
            alert("¡Datos inyectados a la BD correctamente!");
            await loadData();
        } catch (error) {
            alert("Error al inyectar datos");
        }
        setLoading(false);
    }

    async function loadData() {
        if (!storeId) return;
        setLoading(true)
        try {
            const data = await fetchWeeklyOrdersData(storeId, activeMonday)
            setDbItems(data.items)
            
            const bMap: Record<string, BaseRecord> = {}
            data.bases.forEach((b: any) => { bMap[b.inventory_item_id] = b })
            setBases(bMap)

            const cMap: Record<string, Record<string, number>> = {}
            const lsMap: Record<string, number> = {}
            const lastSundayD = addDays(data.lastWeekMonday, 6)
            
            data.counts.forEach((c: any) => {
                if (!cMap[c.inventory_item_id]) cMap[c.inventory_item_id] = {}
                cMap[c.inventory_item_id][c.count_date] = c.quantity_on_hand
                
                if (c.count_date === lastSundayD) {
                    lsMap[c.inventory_item_id] = c.quantity_on_hand
                }
            })
            setCounts(cMap)
            setLastSundayCounts(lsMap)
        } catch (error) {
            console.error(error)
            alert("Error cargando los datos")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name').eq('is_active', true).order('name')
            if (data) {
                setStores(data)
                const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
                if (user && !isSuper && user.store_id) {
                    setStoreId(user.store_id)
                } else {
                    const saved = localStorage.getItem('teg_preparador_store')
                    if (saved && data.find(s => s.id == saved)) setStoreId(saved)
                    else setStoreId(data[0].id)
                }
            }
        }
        if (user !== undefined) fetchStores()
    }, [supabase, user])

    useEffect(() => {
        if (storeId) loadData()
    }, [storeId, activeMonday])

    async function handleCopyPreviousWeek() {
        if (!storeId) return;
        const confirm = window.confirm("¿Seguro que deseas copiar la BASE de la semana pasada a esta semana?");
        if (confirm) {
            const res = await clonePreviousWeekBases(storeId, activeMonday)
            if (res.error) alert(res.error)
            else {
                alert('Base copiada exitosamente!')
                loadData()
            }
        }
    }

    async function handleSaveMapping() {
        if (!selectedDbItemId) return;
        setLoading(true);
        const res = await linkExcelItem(selectedDbItemId, mappingModal.excelName);
        if (res.error) alert(res.error);
        else {
            setMappingModal({ isOpen: false, excelName: '' });
            loadData(); // Recargar todo para traer la nueva liga
        }
        setLoading(false);
    }

    // Cuando carga el componente, creamos una base si no existe, o combinamos los EXCEL_PARS como default
    async function handleBaseChange(itemId: string, field: string, value: string) {
        if (!storeId) return;
        const numVal = parseFloat(value) || 0;
        
        // Obtener el item para saber su excelName original
        const linkedItem = dbItems.find(i => i.id === itemId);
        const excelName = linkedItem?.excel_reference;
        const defaultPars = excelName ? EXCEL_PARS[excelName] : {};

        const b = bases[itemId] || { 
            inventory_item_id: itemId, 
            mon_par: defaultPars.mon || 0, 
            tue_par: defaultPars.tue || 0, 
            wed_par: defaultPars.wed || 0, 
            thu_par: defaultPars.thu || 0, 
            fri_par: defaultPars.fri || 0, 
            sat_par: defaultPars.sat || 0, 
            sun_par: defaultPars.sun || 0 
        };
        
        setBases({ ...bases, [itemId]: { ...b, [field]: numVal } })
        await updateWeeklyBase(storeId, itemId, activeMonday, field, numVal)
    }

    async function handleCountChange(itemId: string, dateStr: string, value: string) {
        if (!storeId) return;
        if (value === '') {
            const itemCounts = counts[itemId] || {};
            const newCounts = { ...itemCounts };
            delete newCounts[dateStr];
            setCounts({ ...counts, [itemId]: newCounts })
            return;
        }
        const numVal = parseFloat(value) || 0;
        const itemCounts = counts[itemId] || {};
        setCounts({ ...counts, [itemId]: { ...itemCounts, [dateStr]: numVal } })
        await updateDailyLeftover(storeId, itemId, dateStr, numVal)
    }

    const weekDays = [
        { label: 'MON', key: 'mon', dateStr: activeMonday, baseField: 'mon_par' },
        { label: 'TUE', key: 'tue', dateStr: addDays(activeMonday, 1), baseField: 'tue_par' },
        { label: 'WED', key: 'wed', dateStr: addDays(activeMonday, 2), baseField: 'wed_par' },
        { label: 'THU', key: 'thu', dateStr: addDays(activeMonday, 3), baseField: 'thu_par' },
        { label: 'FRI', key: 'fri', dateStr: addDays(activeMonday, 4), baseField: 'fri_par' },
        { label: 'SAT', key: 'sat', dateStr: addDays(activeMonday, 5), baseField: 'sat_par' },
        { label: 'SUN', key: 'sun', dateStr: addDays(activeMonday, 6), baseField: 'sun_par' }
    ]

    // Color de alerta para el TAB ORDERS (Formato 3)
    function checkOrdersFormat(orderVal: number) {
        if (orderVal <= -0.4) return 'bg-red-500 text-white'; // Formato 3 Orders
        return '';
    }

    // Color de alerta para el TAB BASE (Sobrante físico) (Formatos 1 y 2)
    function checkSobranteFormat(par: number, usePercent: number | null, isWeekend: boolean) {
        if (par > 0 && usePercent !== null) {
            if (!isWeekend) {
                if (par >= 9 && (usePercent < 10 || usePercent > 50)) return 'bg-red-200 text-red-900 border-red-500';
            } else {
                if (par >= 8 && (usePercent < 10 || usePercent > 30)) return 'bg-red-200 text-red-900 border-red-500';
            }
        }
        return '';
    }

    return (
        <div className="p-4 md:p-8 max-w-[100vw] min-h-screen bg-slate-50 text-slate-800">
            {mappingModal.isOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Vincular Producto</h2>
                            <button onClick={() => setMappingModal({ isOpen: false, excelName: '' })} className="text-slate-400 hover:text-slate-700">
                                <X />
                            </button>
                        </div>
                        <p className="mb-4 text-slate-600">
                            Has seleccionado la fila del excel: <strong className="text-blue-600">"{mappingModal.excelName}"</strong>.<br/>
                            Por favor, busca de la lista de productos de Restaurante en la base de datos a continuación para enlazar sus cálculos.
                        </p>
                        
                        <input
                            type="text"
                            placeholder="🔍 Buscar insumo..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full border-2 border-slate-300 p-3 rounded-t-lg font-medium text-slate-700 outline-none focus:border-blue-500 focus:z-10 relative"
                        />
                        <div className="w-full border-2 border-t-0 border-slate-300 rounded-b-lg mb-6 font-medium text-slate-700 max-h-48 overflow-y-auto bg-white">
                            {dbItems.filter(i => (!i.excel_reference || i.excel_reference === mappingModal.excelName) && i.name.toLowerCase().includes(searchTerm.toLowerCase())).map(i => (
                                <div 
                                    key={i.id} 
                                    onClick={() => setSelectedDbItemId(i.id)}
                                    className={`p-3 border-b border-slate-100 cursor-pointer transition-colors ${selectedDbItemId === i.id ? 'bg-blue-600 text-white' : 'hover:bg-blue-50'}`}
                                >
                                    {i.name} ({i.unit_type})
                                </div>
                            ))}
                            {dbItems.filter(i => (!i.excel_reference || i.excel_reference === mappingModal.excelName) && i.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                                <div className="p-4 text-center text-slate-400">No hay resultados</div>
                            )}
                        </div>

                        <button 
                            disabled={!selectedDbItemId}
                            onClick={handleSaveMapping} 
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-3 rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                            GUARDAR VINCULACIÓN
                        </button>
                    </div>
                </div>
            )}

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b pb-4">
                <div>
                    <h1 className="text-2xl font-black text-blue-900">Módulo de Bodega</h1>
                    <p className="text-slate-500 text-sm">Listado idéntico al Excel. Celdas rojas indican productos sin vincular.</p>
                </div>
                
                <div className="flex items-center gap-3">
                    <select 
                        value={storeId} 
                        onChange={e => {
                            setStoreId(e.target.value)
                            localStorage.setItem('teg_preparador_store', e.target.value)
                        }}
                        className="bg-white border-2 border-slate-300 text-slate-700 rounded-lg p-2 font-bold focus:border-blue-500 outline-none"
                    >
                        {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    
                    <button className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-100 px-3 py-2 rounded-lg font-semibold" onClick={() => setActiveMonday(getMonday(new Date(addDays(activeMonday, -7))))}>
                        <ArrowLeft className="w-4 h-4" /> SEMANA ANT.
                    </button>
                    <span className="font-bold px-2">{activeMonday}</span>
                    <button className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-100 px-3 py-2 rounded-lg font-semibold" onClick={() => setActiveMonday(getMonday(new Date(addDays(activeMonday, 7))))}>
                        SEMANA SIG. <ArrowRight className="w-4 h-4" />
                    </button>
                    
                    {/* Botonera de herramientas */}
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={handleBulkMigrate}
                            className="flex items-center gap-2 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-4 py-2 rounded-lg font-semibold text-sm border-2 border-yellow-200 transition-colors shadow-sm"
                        >
                            <Save size={16} /> FORZAR GUARDADO TOTAL A BD
                        </button>
                        <button 
                            onClick={handleCopyPreviousWeek}
                            disabled={loading}
                            className="flex items-center gap-2 bg-blue-100 hover:bg-blue-200 text-blue-900 px-4 py-2 rounded-lg font-semibold text-sm border-2 border-blue-200 transition-colors shadow-sm"
                        >
                            <Copy size={16} /> Copiar Semana Anterior
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex gap-2 mb-4">
                <button 
                    onClick={() => setActiveTab('BASE')} 
                    className={`px-8 py-3 rounded-t-xl font-bold text-lg border-t-4 transition-colors ${activeTab === 'BASE' ? 'bg-white border-t-emerald-500 text-emerald-800 shadow-sm' : 'bg-slate-200 border-t-transparent text-slate-500 hover:bg-slate-300'}`}
                >
                    Pestaña: BASE (Captura)
                </button>
                <button 
                    onClick={() => setActiveTab('ORDERS')} 
                    className={`px-8 py-3 rounded-t-xl font-bold text-lg border-t-4 transition-colors ${activeTab === 'ORDERS' ? 'bg-white border-t-blue-500 text-blue-800 shadow-sm' : 'bg-slate-200 border-t-transparent text-slate-500 hover:bg-slate-300'}`}
                >
                    Pestaña: ORDERS (Resultados)
                </button>
            </div>

            {loading ? (
                <div className="bg-white p-12 text-center text-slate-500 rounded-xl shadow-sm border border-slate-200 flex justify-center">
                    Cargando información del Excel...
                </div>
            ) : (
                <div className="bg-white border border-slate-200 shadow-sm overflow-x-auto rounded-b-xl rounded-tr-xl">
                    <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                        <thead>
                            {activeTab === 'BASE' && (
                                <tr>
                                    <th className="bg-slate-100 border p-3 border-slate-300 sticky left-0 z-10 font-black"></th>
                                    <th colSpan={7} className="bg-emerald-100 text-emerald-900 border p-3 text-center border-emerald-200 font-black text-lg">
                                        LO QUE SE PIDE A BODEGA (BASE IDEAL)
                                    </th>
                                    <th className="w-2 bg-slate-50"></th>
                                    <th colSpan={7} className="bg-orange-100 text-orange-900 border p-3 text-center border-orange-200 font-black text-lg">
                                        SOBRANTE DEL DÍA (USO FÍSICO)
                                    </th>
                                </tr>
                            )}
                            
                            {activeTab === 'ORDERS' && (
                                <tr>
                                    <th className="bg-slate-100 border p-3 border-slate-300 sticky left-0 z-10 font-black"></th>
                                    <th colSpan={7} className="border border-blue-200 bg-blue-100/50 p-3 text-center text-blue-900 shadow-sm rounded-tr-lg">
                                        ORDERS (Base de Mañana - Sobrante de Hoy)
                                    </th>
                                </tr>
                            )}

                            <tr className="bg-slate-50 text-slate-600 font-bold border-b-2 border-slate-300">
                                <th className="sticky left-0 bg-slate-50 border p-3 min-w-[200px] z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">Producto Excel</th>
                                
                                {activeTab === 'BASE' && (
                                    <>
                                        {weekDays.map(d => <th key={`bh_${d.key}`} className="border p-3 text-center w-24">{d.label}</th>)}
                                        <th className="w-2 bg-slate-100 border-none"></th>
                                        {weekDays.map(d => <th key={`sh_${d.key}`} className="border p-3 text-center w-24">{d.label}</th>)}
                                    </>
                                )}

                                {activeTab === 'ORDERS' && (
                                    <>
                                        {weekDays.map(d => <th key={`oh_${d.key}`} className="border p-3 text-center w-24">{d.label}</th>)}
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {EXCEL_ITEMS.map((excelName) => {
                                // Buscar si hay algún item de la base de datos vinculado a este nombre
                                const linkedItem = dbItems.find(i => i.excel_reference === excelName);
                                
                                if (!linkedItem) {
                                    // Fila NO VINCULADA
                                    return (
                                        <tr key={excelName} className="bg-red-50/20 border-b border-red-100">
                                            <td className="sticky left-0 bg-white border border-slate-200 p-2 font-semibold text-slate-700 shadow-[2px_0_5px_rgba(0,0,0,0.02)] z-10">
                                                {excelName}
                                            </td>
                                            <td colSpan={15} className="py-2 px-4">
                                                <button 
                                                    onClick={() => {
                                                        setSelectedDbItemId('');
                                                        setSearchTerm('');
                                                        setMappingModal({ isOpen: true, excelName: excelName });
                                                    }}
                                                    className="flex items-center gap-2 bg-white border border-red-300 text-red-600 hover:bg-red-50 font-bold px-3 py-1.5 rounded-lg text-xs"
                                                >
                                                    <Link size={14} /> Vincular este producto con Insumo de BD
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                }

                                // Fila VINCULADA (Renderizar Inputs)
                                const item = linkedItem;
                                const b = bases[item.id];
                                const defaultPars = EXCEL_PARS[excelName] || {};
                                
                                const itemC = counts[item.id] || {};

                                return (
                                    <tr key={excelName} className="hover:bg-blue-50/50">
                                        <td className="sticky left-0 bg-white border border-slate-200 p-2 font-semibold text-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.02)] z-10">
                                            <div className="flex flex-col">
                                                <span>{excelName}</span>
                                                <span className="text-[10px] text-slate-400 font-normal">🔗 {item.name}</span>
                                            </div>
                                        </td>

                                        {activeTab === 'BASE' && (
                                            <>
                                                {/* Celdas BASES (Inputs) */}
                                                {weekDays.map(d => {
                                                    const exactVal = b ? (b as any)[d.baseField] : undefined;
                                                    const defVal = defaultPars[d.key];
                                                    const valToDisplay = exactVal !== undefined ? exactVal : defVal;
                                                    
                                                    return (
                                                        <td key={`bc_${item.id}_${d.key}`} className="border border-emerald-100 bg-emerald-50/20 p-0">
                                                            <input 
                                                                type="number" 
                                                                placeholder={defVal ? String(defVal) : '-'}
                                                                className="w-full h-full p-3 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-emerald-400 font-medium text-slate-800 placeholder:text-slate-300"
                                                                value={exactVal !== undefined ? exactVal : (defVal || '')} 
                                                                onChange={e => handleBaseChange(item.id, d.baseField, e.target.value)}
                                                            />
                                                        </td>
                                                    )
                                                })}
                                                
                                                <td className="bg-slate-50 border-y"></td>

                                                {/* Celdas SOBRANTE (Inputs) */}
                                                {weekDays.map(d => {
                                                    const sVal = itemC[d.dateStr];
                                                    const defSob = EXCEL_SOBRANTES[excelName]?.[d.key];
                                                    const currentSobrante = sVal !== undefined ? sVal : defSob;
                                                    
                                                    // Determinar Par de Hoy para el formato Alerta
                                                    const exactVal = b ? (b as any)[d.baseField] : undefined;
                                                    const defVal = defaultPars[d.key];
                                                    const pVal = exactVal !== undefined ? exactVal : (defVal || 0);

                                                    let usePercent: number | null = null;
                                                    if (currentSobrante !== undefined && currentSobrante !== '' && pVal > 0) {
                                                        const numSob = Number(currentSobrante);
                                                        // "Use" = Base - Sobrante según la lógica de % del Excel de la fila Use
                                                        usePercent = (numSob / pVal) * 100;
                                                    }

                                                    const isWeekend = ['fri', 'sat', 'sun'].includes(d.key);
                                                    const alertColor = checkSobranteFormat(pVal, usePercent, isWeekend);

                                                    const displayVal = sVal !== undefined ? (sVal !== null ? sVal : '') : (defSob !== undefined ? defSob : '');

                                                    return (
                                                        <td key={`sc_${item.id}_${d.key}`} className={`border border-orange-100 bg-orange-50/20 p-0 ${alertColor}`}>
                                                            <input 
                                                                type="number" 
                                                                placeholder="-" 
                                                                className={`w-full h-full p-3 text-center outline-none bg-transparent focus:bg-white font-bold focus:ring-2 focus:ring-orange-400 placeholder:font-medium placeholder:text-orange-900/30 ${alertColor ? '!text-red-900' : 'text-orange-900'}`}
                                                                value={displayVal} 
                                                                onChange={e => handleCountChange(item.id, d.dateStr, e.target.value)}
                                                            />
                                                        </td>
                                                    )
                                                })}
                                            </>
                                        )}

                                        {activeTab === 'ORDERS' && (
                                            <>
                                                {/* Celdas ORDERS (Calculadas y Coloreadas) */}
                                                {weekDays.map((d, i) => {
                                                    const exactSobrante = itemC[d.dateStr];
                                                    const defSobrante = EXCEL_SOBRANTES[excelName]?.[d.key];
                                                    const currentSobrante = exactSobrante !== undefined ? exactSobrante : defSobrante;

                                                    let nextBaseVal = 0;
                                                    if (d.key === 'sun') {
                                                        nextBaseVal = b ? b['mon_par'] : (defaultPars['mon'] || 0);
                                                    } else {
                                                        const nextDayKey = weekDays[i+1].baseField;
                                                        nextBaseVal = b ? (b as any)[nextDayKey] : (defaultPars[weekDays[i+1].key] || 0);
                                                    }

                                                    let orderVal: number | string = '';

                                                    if (currentSobrante !== undefined && currentSobrante !== '') {
                                                        orderVal = nextBaseVal - Number(currentSobrante);
                                                    }

                                                    if (typeof orderVal === 'number') {
                                                        const n = item.name.toUpperCase();
                                                        if (n.includes("PAPELITOS")) orderVal = Math.ceil(orderVal / 30) * 30;
                                                        else if (n.includes("MULITAS") || n.includes("QUESADILLA")) orderVal = Math.ceil(orderVal / 4) * 4;
                                                    }

                                                    const colorClass = typeof orderVal === 'number' ? checkOrdersFormat(orderVal) : '';

                                                    return (
                                                        <td key={`oc_${item.id}_${d.key}`} className={`border border-blue-100 p-3 text-center font-bold ${colorClass ? colorClass : 'text-slate-800 bg-white'}`}>
                                                            {orderVal}
                                                        </td>
                                                    )
                                                })}
                                            </>
                                        )}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
