-- ============================================================================
-- MIGRACIÓN: SISTEMA DE INVENTARIO Y PAR (Restaurant365-lite)
-- FECHA: 2026-02-12
-- DESCRIPCIÓN: Estructura base para el control de inventario, recetas y PAR.
-- ============================================================================

-- 1. CATEGORÍAS DE INVENTARIO (Ej: Carnes, Verduras, Desechables)
create table if not exists inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz default now()
);

-- 2. ITEMS DE INVENTARIO (SKU Maestro)
-- Estos son los ingredientes reales que compras (Ej: Caja Limón, Bolsa Carne Asada)
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references inventory_categories(id),
  name text not null, -- Ej: "Limón Persa (Caja 40lb)"
  sku text, -- Código interno o de proveedor
  unit_type text not null, -- Unidad de compra: 'lb', 'oz', 'kg', 'pza', 'caja', 'gal'
  purchase_unit_cost numeric(10,4), -- Costo última compra
  yield_percent numeric(5,2) default 100.00, -- Rendimiento (Merma). Ej: 85% para aguacate
  alert_threshold numeric(10,2), -- Alerta global de stock bajo (opcional)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. UNIDADES DE MEDIDA CONVERSIONES (Opcional pero recomendado para Recetas vs Compras)
-- Por simplicidad inicial, asumiremos que las recetas usan la misma unidad base o una convertible simple.

-- 4. ITEMS DE MENÚ TOAST (Cache local para mapeo)
-- Se llena vía API de Toast (Menus API)
create table if not exists toast_menu_items (
  guid text primary key, -- GUID de Toast
  name text not null,
  sku text, -- SKU de Toast (PLU)
  price numeric(10,2),
  group_name text, -- Grupo de menú (Ej: Tacos, Burritos)
  is_modifier boolean default false, -- Si es un modificador (Ej: "Extra Carne")
  active boolean default true,
  last_synced_at timestamptz default now()
);

-- 5. RECETAS (Mapeo: Item de Menú -> Insumos)
-- Un item de menú puede tener n ingredientes
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  toast_menu_item_guid text references toast_menu_items(guid) not null,
  inventory_item_id uuid references inventory_items(id) not null,
  quantity numeric(10,4) not null, -- Cantidad consumida
  unit text not null, -- Unidad de consumo (debe ser compatible con unit_type del item)
  created_at timestamptz default now(),
  
  unique(toast_menu_item_guid, inventory_item_id) -- Un ingrediente solo aparece una vez por receta
);

-- 6. REGLAS DE MODIFICADORES
-- Cómo afecta un modificador al inventario.
-- Ej: Modificador "Sin Cebolla" -> inventory_item "Cebolla" -> quantity_adjustment: -0.5 (resta consumo, o sea suma inventario)
-- Ej: Modificador "Extra Carne" -> inventory_item "Carne Asada" -> quantity_adjustment: +0.25 (suma consumo)
create table if not exists modifier_rules (
  id uuid primary key default gen_random_uuid(),
  modifier_guid text references toast_menu_items(guid) not null, -- El modificador en Toast
  inventory_item_id uuid references inventory_items(id) not null, -- El insumo afectado
  quantity_adjustment numeric(10,4) not null, -- Cantidad a SUMAR al consumo teórico (+0.1 o -0.1)
  unit text not null,
  created_at timestamptz default now()
);

-- 7. CONTEOS DE INVENTARIO FÍSICO
create table if not exists inventory_counts (
  id uuid primary key default gen_random_uuid(),
  store_id text not null, -- Store ID de Toast o interno
  inventory_item_id uuid references inventory_items(id) not null,
  count_date date not null, -- Fecha del conteo
  quantity_on_hand numeric(10,4) not null, -- Cantidad contada
  counted_by text, -- Usuario que contó
  notes text,
  created_at timestamptz default now(),
  
  unique(store_id, inventory_item_id, count_date) -- Un conteo por item por día por tienda
);

-- 8. CONFIGURACIÓN PAR POR TIENDA
create table if not exists par_settings (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  inventory_item_id uuid references inventory_items(id) not null,
  min_par numeric(10,4), -- Nivel mínimo (Safety Stock)
  max_par numeric(10,4), -- Nivel máximo (llenado ideal)
  lead_time_days integer default 1, -- Días que tarda en llegar proveedor
  safety_stock numeric(10,4) default 0, -- Stock de seguridad extra
  updated_at timestamptz default now(),
  
  unique(store_id, inventory_item_id)
);

-- 9. CONSUMO DIARIO CALCULADO (LOG)
-- Histórico de consumo teórico basado en ventas + recetas
create table if not exists inventory_usage_log (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  business_date date not null,
  inventory_item_id uuid references inventory_items(id) not null,
  theoretical_usage numeric(10,4) default 0, -- Calculado por recetas
  waste_usage numeric(10,4) default 0, -- Merma reportada manually (opcional futuro)
  total_usage numeric(10,4) generated always as (theoretical_usage + waste_usage) stored,
  created_at timestamptz default now(),
  
  unique(store_id, business_date, inventory_item_id)
);

-- ÍNDICES PARA RENDIMIENTO
create index idx_recipes_menu_guid on recipes(toast_menu_item_guid);
create index idx_inventory_counts_date on inventory_counts(count_date);
create index idx_inventory_usage_date on inventory_usage_log(business_date);

-- POLÍTICAS RLS (Row Level Security) - Básico por ahora (Service Role Admin total)
alter table inventory_categories enable row level security;
alter table inventory_items enable row level security;
alter table toast_menu_items enable row level security;
alter table recipes enable row level security;
alter table modifier_rules enable row level security;
alter table inventory_counts enable row level security;
alter table par_settings enable row level security;
alter table inventory_usage_log enable row level security;

-- Permitir lectura pública autenticada (ajustar según roles reales después)
create policy "Enable read access for authenticated users" on inventory_items for select using (auth.role() = 'authenticated');
create policy "Enable read access for authenticated users" on inventory_categories for select using (auth.role() = 'authenticated');
create policy "Enable read access for authenticated users" on toast_menu_items for select using (auth.role() = 'authenticated');
create policy "Enable read access for authenticated users" on recipes for select using (auth.role() = 'authenticated');
create policy "Enable read access for authenticated users" on modifier_rules for select using (auth.role() = 'authenticated');
create policy "Enable read access for authenticated users" on inventory_counts for select using (auth.role() = 'authenticated');
create policy "Enable read access for authenticated users" on par_settings for select using (auth.role() = 'authenticated');
create policy "Enable read access for authenticated users" on inventory_usage_log for select using (auth.role() = 'authenticated');

-- Permitir escritura solo a roles internos o service role (por definir, abierto a auth por ahora para desarrollo)
create policy "Enable insert for authenticated users" on inventory_counts for insert with check (auth.role() = 'authenticated');
create policy "Enable update for authenticated users" on inventory_counts for update using (auth.role() = 'authenticated');
