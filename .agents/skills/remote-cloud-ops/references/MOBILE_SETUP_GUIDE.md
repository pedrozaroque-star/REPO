# 📱 Guía de Uso en Teléfono: Google Antigravity Remote Agents (Sin depender del PC)

Esta guía explica cómo abrir y operar el repositorio de **Tacos Gavilan** (`pedrozaroque-star/REPO`) las 24 horas del día desde tu celular usando **Google Antigravity Remote Agents** (*Agentes Remotos en la nube*).

---

## ⚠️ Diferencia clave: ¿Cuál opción elegir?
- **NO uses `Remote Control` (*Control Remoto*)**: esa opción se conecta a tu computadora Windows física; si tu PC se apaga o entra en suspensión (*Sleep*), pierdes conexión.
- **SÍ usa `Remote Agents` / `New Remote Project` (*Agentes Remotos / Nuevo Proyecto Remoto*)**: ejecuta al agente dentro de un contenedor en la nube de Google conectado directo a tu GitHub. Tu PC puede estar completamente apagada.

---

## 🚀 Configuración Inicial (Solo se hace una vez)

### Paso 1: Instalar Antigravity Web como App en tu teléfono
1. Abre **Safari** (iPhone) o **Chrome** (Android) en tu celular y entra a: **https://antigravity.google.com**
2. Inicia sesión con tu misma cuenta de Google (con suscripción **Google AI Pro / Ultra**).
3. Instala el acceso directo como **PWA** (*Progressive Web App* / Aplicación web instalable):
   - **iPhone (Safari)**: Botón **Compartir** (*Share*) -> **Agregar a pantalla de inicio** (*Add to Home Screen*).
   - **Android (Chrome)**: Menú `⋮` -> **Instalar aplicación** (*Install app*) o **Agregar a pantalla de inicio** (*Add to Home screen*).
4. Activa las notificaciones si el navegador te lo pide, para enterarte cuando un agente termine una tarea o espere tu confirmación de despliegue.

### Paso 2: Conectar Plugins en `antigravity.google.com`
1. En el menú lateral izquierdo, ve a **Customizations** (*Personalizaciones*) -> **Plugins** / **Marketplace**.
2. Verifica que estén activos y conectados con tu cuenta:
   - **GitHub** (con acceso al repositorio `pedrozaroque-star/REPO`).
   - **Supabase** (proyecto `teg-tacos-gavilan`, ID `ywwwdcvgfculqmcfkihq`).
   - **Vercel** (equipo `team_gizPjG5JHpw8Bd580QMnSELN`, proyecto `tacosgavilan`).

### Paso 3: Crear el Proyecto Remoto (`New Remote Project`)
1. En proyectos haz clic en **+** -> **New Remote Project** (*Nuevo Proyecto Remoto*).
2. Ponle nombre (ejemplo: `Tacos Gavilan Cloud`).
3. En **Add Resource** (*Agregar recurso*) elige **GitHub Repository** (*Repositorio de GitHub*) y selecciona **`pedrozaroque-star/REPO`**.
4. Haz clic en **Create** (*Crear*). ¡Listo! Ese proyecto queda disponible 24/7 aunque tu PC esté apagada.

---

## 💬 Cómo trabajar desde tu teléfono en el día a día

Cuando entres desde el celular y pidas un cambio:
1. El agente remoto leerá automáticamente [`AGENTS.md`](../../../AGENTS.md), [`.agents/AGENTS.md`](../../AGENTS.md) y el skill [`remote-cloud-ops`](../SKILL.md).
2. Hará los cambios de código, aplicará SQL/migraciones en **Supabase** (si se necesitan) y correrá `npm run preflight:cloud` (`next typegen && tsc --noEmit`) en la nube.
3. **Nunca hará commit ni push por su cuenta**: te mostrará el resumen y esperará tu orden.
4. Cuando estés listo para publicar en producción, simplemente respóndele:
   > **"Haz commit, sube a main y verifica el deploy en Vercel"**
5. El agente hará `git push` a `main`, **Vercel** compilará y publicará automáticamente en producción, y el agente confirmará vía Vercel MCP que el estado quedó en `READY`.
