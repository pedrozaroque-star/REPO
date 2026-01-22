# Scripts de Utilidad

Scripts para tareas de mantenimiento y utilidades del sistema TEG.

## 📝 Scripts Disponibles

### `fill-december-cache.ts`

**Propósito:** Rellenar la caché de Supabase con datos completos de diciembre 2025.

**Qué hace:**
- Consulta Toast API para todos los días de diciembre 2025
- Calcula todas las métricas:
  - Ventas netas, brutas, descuentos, propinas, impuestos
  - Conteo de órdenes y huéspedes
  - Horas de labor y costos
  - **Ventas por hora** (para Open/Close)
  - **Ventas por plataforma** (Uber, DoorDash, GrubHub)
  - **Transacciones EBT**
- Guarda todo en `sales_daily_cache` de Supabase

**Cuándo usar:**
- Después de actualizar la lógica de cálculo
- Para forzar actualización de datos cacheados
- Si detectas inconsistencias en los reportes

**Ejecución:**

```powershell
# Opción 1: Con npx (recomendado, no requiere instalación)
npx tsx scripts/fill-december-cache.ts

# Opción 2: Si tienes tsx instalado globalmente
tsx scripts/fill-december-cache.ts
```

**Requisitos:**
- Variables de entorno configuradas (.env.local):
  - `TOAST_API_TOKEN`
  - `TOAST_STORE_IDS` (opcional, por defecto usa Lynwood)
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Tiempo estimado:** 2-5 minutos (dependiendo de la cantidad de datos)

**Salida esperada:**
```
🚀 Iniciando script de rellenado de caché para Diciembre 2025...

📅 Rango: 2025-12-01 a 2025-12-31
🏪 Store IDs: dc5dd3b4-71fa-4b41-9e32-0e6e83ebdbd4

⏳ Consultando Toast API...
✅ Obtenidos 31 registros de Toast

💾 Preparando datos para caché...
📊 Registros preparados: 31

📈 Resumen de datos:
   Total Net Sales: $45,234.56
   Uber/Postmates: $3,456.78
   DoorDash: $2,345.67
   GrubHub: $1,234.56
   EBT Transacciones: 42

💿 Guardando en Supabase...
   ✓ Guardados 31/31 registros

✅ Proceso completado exitosamente!
📊 Total de registros guardados: 31
🎉 Caché de Diciembre 2025 actualizada

🏁 Script finalizado
```

## ⚠️ Notas Importantes

1. **Este script sobrescribe datos existentes** - Usa `upsert` para actualizar registros existentes
2. **Requiere conexión a Toast API** - Asegúrate de tener token válido
3. **Requiere acceso a Supabase** - Verifica credenciales
4. **No afecta datos en vivo** - Solo modifica la caché

## 🐛 Troubleshooting

**Error: "Cannot find module '@/lib/toast-api'"**
- Asegúrate de ejecutar desde la raíz del proyecto
- Verifica que el archivo `tsconfig.json` esté configurado correctamente

**Error: "TOAST_API_TOKEN is not defined"**
- Crea/actualiza el archivo `.env.local`
- Copia las variables desde `.env.example`

**Error: "Connection timeout"**
- Toast API puede estar lento
- Intenta ejecutar de nuevo
- Considera reducir el rango de fechas

**Los datos siguen sin aparecer en el dashboard:**
1. Verifica que el script terminó exitosamente
2. Reinicia el servidor de desarrollo (`npm run dev`)
3. Limpia la caché del navegador (Ctrl+Shift+Delete)
4. Verifica en Supabase que los datos se guardaron correctamente

## 📞 Soporte

Si encuentras problemas, revisa:
1. Los logs del script
2. La consola del navegador (F12)
3. Los logs del servidor de desarrollo
