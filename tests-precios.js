const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const keyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);
const key = keyMatch ? keyMatch[1] : env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];
const supabase = createClient(url, key);

async function checkPrices() {
  console.log("🔍 Escaneando todas las actualizaciones de precios de HOY a fondo...");
  
  const { data: historyData } = await supabase.from('inventory_price_history')
    .select('inventory_item_id, purchase_unit_cost, effective_date')
    .gte('effective_date', '2026-03-23T00:00:00Z')
    .order('effective_date', { ascending: false });
    
  if (historyData && historyData.length > 0) {
      // Tomamos solo el ultimo update por item
      const idMap = new Map();
      historyData.forEach(d => {
          if (!idMap.has(d.inventory_item_id)) idMap.set(d.inventory_item_id, d);
      });
      const uniqueData = Array.from(idMap.values());
      const ids = uniqueData.map(d => d.inventory_item_id);
      
      const { data: invData, error } = await supabase.from('inventory_items')
        .select('*')
        .in('id', ids);
        
      if (error) {
          console.error("Error fetching inventory_items:", error.message);
          return;
      }
      
      const tableData = uniqueData.map(h => {
          const item = invData ? invData.find(i => i.id === h.inventory_item_id) : null;
          
          if(!item) return null;
          
          return {
              "🆔 ID (Short)": item.id.split('-')[0],
              "🟢 Nombre del Producto": item.name,
              "📁 Categoría": item.category || 'N/A',
              "🏷️ Tipo (Restaurante/Bodega)": item.type || item.item_type || item.purchase_type || 'N/A',
              "⛔ Costo FANTASMA (El que arruinó el reporte)": `$${h.purchase_unit_cost}`,
              "✅ Costo Real en Pantalla (UI)": `$${item.purchase_unit_cost || 0}`,
              "📦 Presentación": `${item.quantity_per_unit || 1} ${item.unit_measure || 'pza'}`,
              "🕒 Hora del Problema": new Date(h.effective_date).toLocaleTimeString()
          };
      }).filter(Boolean);
      
      console.table(tableData);
      
  } else {
      console.log("No hubieron cambios descubiertos.");
  }
}

checkPrices();
