# 📋 GUÍA DE INSTALACIÓN - SISTEMA CON AUTENTICACIÓN

## ⚠️ IMPORTANTE: Sigue estos pasos EN ORDEN

---

## PASO 1: ACTUALIZAR TABLAS EN SUPABASE

1. Abre **Supabase** en tu navegador
2. Ve a tu proyecto
3. Haz clic en **SQL Editor** (menú izquierdo)
4. Pega el siguiente SQL y haz clic en **RUN**:

```sql
-- Agregar columnas de usuario a manager_checklists
ALTER TABLE manager_checklists
ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_manager_checklists_user ON manager_checklists(user_id);

UPDATE manager_checklists 
SET created_by = manager_name 
WHERE created_by IS NULL;

-- Agregar columnas de usuario a assistant_checklists
ALTER TABLE assistant_checklists
ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_assistant_checklists_user ON assistant_checklists(user_id);

UPDATE assistant_checklists 
SET created_by = assistant_name 
WHERE created_by IS NULL;
```

5. Deberías ver: **Success. No rows returned**

---

## PASO 2: COPIAR ARCHIVOS NUEVOS A TU PROYECTO

Extrae el ZIP **archivos-autenticacion.zip** y copia los archivos así:

```
TU_PROYECTO/
├── middleware.ts                          ← COPIAR (archivo nuevo)
├── components/
│   └── ProtectedRoute.tsx                 ← COPIAR (archivo nuevo)
├── app/
    └── checklists/
        ├── page.tsx                       ← REEMPLAZAR (modificado)
        └── crear/
            └── page.tsx                   ← COPIAR (archivo nuevo)
```

**IMPORTANTE:** 
- `middleware.ts` va en la **raíz del proyecto** (mismo nivel que `package.json`)
- `app/checklists/page.tsx` → **REEMPLAZAR** el existente
- Los demás son **nuevos**

---

## PASO 3: ELIMINAR PÁGINAS PÚBLICAS INCORRECTAS

**Elimina estas carpetas completas:**

```
app/manager/          ← ELIMINAR toda la carpeta
app/asistente/        ← ELIMINAR toda la carpeta
```

**¿Por qué?** Esas páginas eran públicas (sin login). Ahora todo está dentro del sistema con autenticación.

---

## PASO 4: REINICIAR SERVIDOR

1. **Detén** el servidor (Ctrl+C en la terminal)
2. **Borra** la carpeta `.next`:
   ```bash
   rmdir /s /q .next
   ```
3. **Reinicia** el servidor:
   ```bash
   npm run dev
   ```

---

## PASO 5: PROBAR EL SISTEMA

1. Abre: `http://localhost:3000/login`
2. Inicia sesión con un usuario de tu tabla `users`
3. Te redirige a: `/dashboard`
4. Haz clic en **"Checklists"** en el menú
5. Deberías ver un botón **"+ Crear Nuevo Checklist"**
6. Haz clic y verás las opciones según tu rol

---

## ✅ CHECKLIST DE VERIFICACIÓN

- [ ] SQL ejecutado en Supabase sin errores
- [ ] `middleware.ts` copiado en la raíz del proyecto
- [ ] `components/ProtectedRoute.tsx` copiado
- [ ] `app/checklists/page.tsx` reemplazado
- [ ] `app/checklists/crear/page.tsx` copiado
- [ ] Carpetas `/manager` y `/asistente` eliminadas
- [ ] Carpeta `.next` borrada
- [ ] Servidor reiniciado con `npm run dev`
- [ ] Login funciona y redirige a dashboard
- [ ] Botón "Crear Nuevo Checklist" visible en `/checklists`

---

## ❓ PROBLEMAS COMUNES

**Error: "middleware.ts not found"**
→ Asegúrate de copiarlo en la **raíz**, no dentro de `/app`

**Error: "ProtectedRoute not found"**
→ Verifica que esté en `/components/ProtectedRoute.tsx`

**Páginas sin protección**
→ Borra la carpeta `.next` y reinicia el servidor

**No aparece el botón "Crear Nuevo"**
→ Verifica que reemplazaste correctamente `/app/checklists/page.tsx`

---

## 📞 SIGUIENTE PASO

Una vez que todo funcione:
1. Avísame que ya está listo
2. Continuaré creando las páginas individuales de cada checklist
   (daily, temperaturas, sobrante, etc.) dentro del sistema con autenticación

---

**¿Alguna duda? Pregunta antes de continuar.**
