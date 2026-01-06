# 📘 TEG Modernizado: Manual Oficial de Usuario

**Versión 2.0 - Guía Integral**

Bienvenido al sistema de Gestión Operativa de Tacos Gavilan. Este documento es la fuente única de verdad para entender, operar y administrar la plataforma.

---

## 📑 Tabla de Contenidos

1.  [Introducción y Acceso](#1-introducción-y-acceso)
2.  [El Dashboard (Centro de Mando)](#2-el-dashboard-centro-de-mando)
3.  [Módulo de Operaciones](#3-módulo-de-operaciones)
    *   [Checklists (Asistentes y Managers)](#31-checklists)
    *   [Inspecciones (Supervisores)](#32-inspecciones)
    *   [Horarios y Cobertura](#33-horarios)
4.  [Módulo de Gestión (Admin)](#4-módulo-de-gestión)
    *   [Usuarios y Roles](#41-usuarios-y-roles)
    *   [Tiendas y Sucursales](#42-tiendas)
    *   [Plantillas y Preguntas](#43-plantillas)
5.  [Módulo de Análisis](#5-módulo-de-análisis)
6.  [Kioscos Públicos y Códigos QR](#6-kioscos-públicos-y-códigos-qr)
7.  [Solución de Problemas Frecuentes](#7-solución-de-problemas-frecuentes)

---

## 1. Introducción y Acceso

### ¿Qué es este sistema?
Es una plataforma web progresiva (PWA) diseñada para digitalizar la operación diaria de las sucursales. Centraliza la asistencia, calidad de alimentos, mantenimiento y recursos humanos en una sola herramienta accesible desde celulares, tablets y computadoras.

### Niveles de Acceso (Roles)
El sistema adapta lo que ves según tu cargo:
*   **Asistente:** Puede realizar Checklists operativos (frio, limpieza).
*   **Manager:** Acceso total a la tienda, Checklists gerenciales y Horarios.
*   **Supervisor:** Auditoría de múltiples tiendas (Inspecciones) y reportes regionales.
*   **Admin:** Configuración total (Usuarios, Plantillas, Tiendas globales).

### Cómo Iniciar Sesión de Forma Segura
1.  Ingresa a la URL del sistema.
2.  Usa tu correo corporativo (`@tacosgavilan.com`) y contraseña asignada.
3.  **Conflictos de Identidad:**
    *   *Situación:* El sistema detecta que tu usuario no coincide con tu perfil de base de datos (común si usas múltiples cuentas).
    *   *Solución:* Verás una pantalla roja de "Conflicto". Pulsa el botón **"REPARAR SESIÓN"** para cerrar todo y reingresar limpio.

`[INSERTAR CAPTURA DE PANTALLA: PANTALLA DE LOGIN O ALERTA DE CONFLICTO]`

---

## 2. El Dashboard (Centro de Mando)

El **Dashboard** es la primera pantalla que ves. Su función es darte un "pulso" inmediato del negocio.

### Elementos Clave:
*   **Tarjetas de Resumen:** Contadores en tiempo real de Feedback de Clientes hoy, Inspecciones del mes y Checklists completados.
*   **Gráfica de Tendencias:** Muestra visualmente si el rendimiento está subiendo o bajando.
*   **Panel de Actividad Reciente:** Un "feed" tipo red social que muestra quién hizo qué hace unos minutos (ej. *"Juan completó el Checklist AM hace 5 min"*).
*   **Alertas Críticas:** Caja roja que aparece solo si algo urge atención (ej. "NPS bajo en Lynwood").

`[INSERTAR CAPTURA DE PANTALLA: VISTA GENERAL DEL DASHBOARD]`

---

## 3. Módulo de Operaciones

### 3.1 Checklists
Herramienta diaria para asegurar estándares. Existen dos tipos principales:
*   **Asistente (Operativo):** Tareas rutinarias, temperaturas, limpieza básica.
*   **Manager (Gerencial):** Revisión de caja, personal, depósitos y cierre.

#### 📝 Guía Paso a Paso: Crear un Checklist
1.  Ve al menú **"Checklists"**.
2.  Pulsa **"+ NUEVO CHECKLIST"**.
3.  **Selección:** Verás tarjetas con los tipos disponibles para tu rol (ej. "Daily", "Temperaturas"). Elige uno.
4.  **Llenado del Formulario:**
    *   Responde **SI/NO**.
    *   **NO = Justificación:** Si marcas NO, es *obligatorio* escribir por qué.
    *   **Fotos 📷:** Las preguntas críticas (marcadas con cámara roja) exigen evidencia fotográfica.
5.  **Enviar:** Al finalizar, el sistema calculará tu calificación (0-100%) y guardará el registro con fecha y hora.

`[INSERTAR CAPTURA DE PANTALLA: FORMULARIO DE CHECKLIST CON CAMPO DE FOTO]`

### 3.2 Inspecciones
Auditorías formales realizadas por Supervisores. A diferencia de los checklists, estas afectan el "Score" mensual de la tienda.

#### 📝 Guía Paso a Paso: Realizar Inspección
1.  Ve al menú de **"Inspecciones"**.
2.  Selecciona la tienda a auditar.
3.  **Evaluación por Categorías:**
    *   El formulario se divide en pestañas: *Servicio, Calidad, Limpieza, Mantenimiento*.
    *   Puedes pausar y continuar después (guardado local temporal).
4.  **Cierre:** Al enviar, se genera un reporte PDF (versión digital) que el Manager de tienda puede ver inmediatamente.

`[INSERTAR CAPTURA DE PANTALLA: INTERFAZ DE INSPECCIÓN CON PESTAÑAS]`

### 3.3 Horarios
El sistema no es solo un calendario, es un **Validador de Cobertura**.

#### ¿Qué significan los colores?
*   🟢 **VERDE (Cubierto):** La tienda tiene asegurada la apertura (AM) y el cierre (PM).
*   🔴 **ROJO (Riesgo):** Falta cubrir un turno clave (ej. hay Manager AM pero nadie cierra).
*   ⚪ **GRIS:** Sin programación.

#### 📝 Guía: Consultar Turnos
1.  Entra a **"Horarios"**.
2.  Verás la "Semana Actual".
3.  Haz clic en la tarjeta de tu tienda para expandir y ver nombres específicos: *"¿Quién abre hoy?"*.

`[INSERTAR CAPTURA DE PANTALLA: SEMÁFORO DE HORARIOS]`

---

## 4. Módulo de Gestión

*(Sección Exclusiva para Administradores y Supervisores)*

### 4.1 Usuarios y Roles
Controla quién entra al sistema.

#### 📝 Guía Paso a Paso: Alta/Edición
1.  Ve a **"Usuarios"**.
2.  Para **CREAR**: Botón "+ NUEVO USUARIO".
    *   *Tip:* Asigna la tienda correcta. Si es un "Supervisor", asigna sus tiendas en el campo "Alcance" (o múltiple).
3.  Para **EDITAR**:
    *   Toca la tarjeta del usuario.
    *   **Cambio de Contraseña:** Escribe la nueva contraseña en el campo correspondiente solo si deseas cambiarla. Si lo dejas vacío, se mantiene la actual.

### 4.2 Tiendas
Catálogo maestro de sucursales.
*   **Nota Importante:** Actualmente las tiendas son de "Solo Lectura" en la interfaz para evitar errores contables. Para abrir una nueva sucursal, solicita soporte técnico a nivel base de datos.
*   Aquí puedes ver rápidamente el **NPS** y **Score** promedio de cada local.

`[INSERTAR CAPTURA DE PANTALLA: LISTADO DE TIENDAS CON MÉTRICAS]`

### 4.3 Plantillas
El corazón flexible del sistema. Aquí decides qué se pregunta en los Checklists e Inspecciones.

#### 📝 Guía Paso a Paso: Editar Preguntas
1.  Ve a **"Plantillas"**.
2.  Elige el formato a modificar (ej. "Checklist AM").
3.  **Interfaz de Edición Rápida:**
    *   **Cambiar Texto:** Haz clic sobre la pregunta y escribe.
    *   **Reordenar:** Arrastra el ícono de 6 puntos a la izquierda de la pregunta para subirla o bajarla.
    *   **Foto Obligatoria:** Marca la casilla "Cámara" si quieres forzar al usuario a subir evidencia.
4.  Pulsa "Guardar Orden" si moviste elementos de lugar.

`[INSERTAR CAPTURA DE PANTALLA: EDITOR DE PLANTILLAS ARRASTRABLE]`

---

## 5. Módulo de Análisis

Aquí convertimos datos en decisiones.

*   **Reportes:** Tablas detalladas exportables (Excel/PDF) de todas las operaciones.
*   **Estadísticas:** Gráficos avanzados cruzando variables (ej. *¿Afecta la falta de personal en el NPS de ese día?*).
*   **Feedback:** Lista cruda de todos los comentarios de clientes recibidos por QR.

---

## 6. Kioscos Públicos y Códigos QR

Estas herramientas no requieren login y están diseñadas para iPad o celulares personales.

### A. Feedback de Clientes (`/clientes`)
*   **Uso:** QR en mesas o caja.
*   **Geolocalización:** El sistema pide permiso de GPS para saber automáticamente en qué sucursal está el cliente.
*   **NPS:** Pregunta clave *"¿Nos recomendarías?"* (0-10).

### B. Evaluación de Staff (`/evaluacion`)
*   **Uso:** QR interno en cocina/oficina.
*   **Evaluación 360:** Un empleado evalúa a otro.
*   **Seguridad GPS:** ¡Ojo! Si intentas evaluar desde tu casa, el sistema te bloqueará. **Debes estar físicamente en la tienda** (max 200 metros) para que el envío sea válido.
*   **Lógica Dinámica:** Las preguntas cambian si evalúas a un Cocinero vs. un Manager.

`[INSERTAR CAPTURA DE PANTALLA: PANTALLA DE BLOQUEO GPS O FORMULARIO QR]`

---

## 7. Solución de Problemas Frecuentes

**P: ¿Por qué no puedo subir fotos en el Checklist?**
R: Verifica que diste permiso de cámara al navegador. En iPhone (iOS), a veces Safari bloquea esto por defecto. Intenta usar Chrome o revisar Configuración > Privacidad.

**P: Soy Supervisor pero no veo todas las tiendas.**
R: Pide a un Admin que revise tu configuración de "Scope" en el módulo de Usuarios. Debes tener asignada explícitamente cada tienda o el permiso global.

**P: La ubicación del Kiosco falla.**
R: Asegúrate de que el dispositivo tenga el GPS encendido y que estés en un navegador seguro (HTTPS). El GPS no funciona en modo incógnito a veces.

**P: ¿Cómo recupero una contraseña olvidada?**
R: Actualmente el reseteo es manual por seguridad. Contacta a un Administrador; él puede entrar al módulo de Usuarios y escribirte una nueva contraseña al instante.

---
*Documento confidencial para uso interno de Tacos Gavilan.*
