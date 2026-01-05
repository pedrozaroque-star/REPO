# 🎯 Sistema de Notificaciones Inteligentes

## 📋 ¿Qué hace este sistema?

Cuando un Manager o Asistente completa un checklist con problemas (score < 100%), el sistema:

1. **Cuenta los problemas** (respuestas "NO")
2. **Crea notificación específica**: "Manager reportó 3 problemas en Lynwood"
3. **Envía link directo** al detalle del checklist
4. **Resalta en ROJO** las respuestas que fallaron

---

## 📦 Archivos incluidos:

### 1. Páginas de Detalle
- `app/checklists-manager/ver/[id]/page.tsx` - Ver manager checklists
- `app/checklists/ver/[id]/page.tsx` - Ver assistant checklists

### 2. Trigger SQL Inteligente
- `TRIGGER_INTELIGENTE.sql` - Cuenta problemas y genera notificaciones

### 3. Instrucciones
- `INSTRUCCIONES_BOTON_VER.md` - Cómo agregar el botón "Ver"

---

## 🚀 Instalación:

### PASO 1: Copiar páginas
```
Copia las carpetas:
app/checklists-manager/ver/[id]/  → Tu proyecto
app/checklists/ver/[id]/          → Tu proyecto
```

### PASO 2: Ejecutar SQL
1. Abre **Supabase SQL Editor**
2. Pega el contenido de `TRIGGER_INTELIGENTE.sql`
3. **Ejecuta** (Run)

### PASO 3: Agregar botón "Ver"
Sigue las instrucciones en `INSTRUCCIONES_BOTON_VER.md`

---

## 🎬 Cómo funciona:

### Escenario 1: Manager completa checklist

1. Manager responde 53 preguntas
2. 3 son "NO" (problemas)
3. Score = 94%

**Trigger detecta:**
- ✅ Score < 100%
- ✅ 3 respuestas "NO"

**Notificación creada:**
```
Título: 🔴 Manager reportó 3 problemas
Mensaje: Manager Carlos encontró 3 problemas en Tacos Gavilan Lynwood. 
         Score: 94%. Requiere atención.
Link: /checklists-manager/ver/123
```

**Destinatarios:**
- ✅ Supervisores de esa tienda
- ✅ Admins

### Escenario 2: Asistente completa checklist

1. Asistente completa "Daily"
2. 2 respuestas "NO"
3. Score = 85%

**Notificación creada:**
```
Título: ⚠️ 2 problemas en DAILY
Mensaje: El asistente Cruz Castillo reportó 2 problemas en daily 
         de Tacos Gavilan Lynwood. Score: 85%. Click para ver detalles.
Link: /checklists/ver/456
```

**Destinatarios:**
- ✅ Managers de esa tienda
- ✅ Supervisores de esa tienda

---

## 🎨 Página de Detalle

Al hacer click en la notificación o en "Ver":

1. **Información general:**
   - Sucursal, Usuario, Score, Turno

2. **Respuestas:**
   - ✅ Verde = "SI"
   - ❌ Rojo = "NO" (problemas)
   - ⚪ Gris = "N/A"

3. **Comentarios** (si existen)

4. **Fotos** (si existen)

---

## 🔔 Notificaciones NO se envían cuando:

- ❌ Score = 100% y sin comentarios
- ✅ Todo está perfecto, no hay nada que revisar

---

## ✅ Testing:

### Prueba 1: Checklist con problemas
1. Inicia sesión como **Manager**
2. Crea checklist con 3 respuestas "NO"
3. Guarda (score < 100%)
4. **Verifica:** Supervisor recibe notificación
5. Click en notificación → Ve detalle con problemas en ROJO

### Prueba 2: Checklist perfecto
1. Crea checklist con todas "SI"
2. Guarda (score = 100%, sin comentarios)
3. **Verifica:** NO se envía notificación

### Prueba 3: Checklist con comentarios
1. Crea checklist con score 100%
2. Agrega comentarios
3. Guarda
4. **Verifica:** SÍ se envía notificación (por los comentarios)

---

## 🎯 Beneficios:

1. ✅ **Menos spam**: Solo notifica cuando hay problemas
2. ✅ **Más específico**: Dice cuántos problemas hay
3. ✅ **Acceso directo**: Link al detalle del checklist
4. ✅ **Visual**: Resalta en rojo lo que falló
5. ✅ **Trazabilidad**: Se ve quién reportó y cuándo

---

## 🐛 Troubleshooting:

**Problema:** Notificación no se crea
- Verifica que el trigger esté instalado
- Revisa logs en Supabase

**Problema:** Link de notificación no funciona
- Verifica que las páginas de detalle estén copiadas
- Revisa la ruta en el navegador

**Problema:** No muestra respuestas
- Verifica que `DetailsModal.tsx` esté actualizado
- Revisa que el campo `answers` exista en la BD

---

## 📞 Soporte:

Si algo no funciona, comparte:
1. Captura de la consola (F12)
2. Captura de la notificación
3. Query de Supabase que muestre el checklist

---

¡Listo! 🎉
