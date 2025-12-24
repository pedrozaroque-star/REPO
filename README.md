# 🌮 Sistema TEG - Tacos Gavilan

Sistema de gestión empresarial completo para la cadena de restaurantes Tacos Gavilan.

## 📊 Características Principales

### ✅ Módulos Completados (95%)

1. **🔐 Autenticación**
   - Login con validación
   - Roles: Admin, Supervisor, Manager, Usuario
   - Sesión persistente con localStorage

2. **📊 Dashboard**
   - Estadísticas en tiempo real
   - Gráficas circulares SVG
   - Alertas inteligentes
   - Búsqueda rápida global
   - Barras de progreso con metas

3. **🏪 Tiendas (15 ubicaciones)**
   - Domicilios reales verificados
   - Estadísticas por tienda
   - Búsqueda y filtros
   - NPS y scores de inspección

4. **👥 Usuarios (54 cuentas)**
   - 4 roles diferentes
   - Gestión completa
   - Filtros por rol
   - Búsqueda avanzada

5. **📋 Inspecciones (104 registros)**
   - 7 áreas evaluadas
   - Score general: 98.6%
   - Formulario para nuevas inspecciones
   - Filtros por tienda

6. **✅ Checklists (288 registros)**
   - 6 tipos diferentes
   - Turnos AM/PM
   - Tiempos de inicio/fin/duración
   - Filtros avanzados

7. **💬 Feedback de Clientes (168 registros)**
   - NPS Score: 86
   - Análisis por área
   - Formulario para nuevo feedback
   - Categorización automática

8. **📈 Reportes**
   - Generación por período
   - Filtros por tienda
   - Exportación a Excel
   - Gráficas con Recharts

9. **📉 Estadísticas Avanzadas**
   - Gráficas de barras
   - Gráficas de líneas
   - Gráficas circulares
   - Top 10 por tienda

10. **⚙️ Configuración**
    - Edición de perfil
    - Cambio de contraseña
    - Preferencias del sistema

11. **🔍 Búsqueda Global**
    - Busca en todas las tablas
    - Resultados categorizados
    - Enlaces directos

## 🗄️ Base de Datos

**Supabase PostgreSQL**
- 12 tablas
- 635 registros históricos
- Relaciones con foreign keys
- RLS (Row Level Security) configurado

### Tablas:
- users (54)
- stores (15)
- customer_feedback (168)
- supervisor_inspections (104)
- assistant_checklists (288)
- manager_checklists (2)
- staff_evaluations (4)

## 🛠️ Stack Tecnológico

- **Frontend**: Next.js 14 (App Router)
- **UI**: Tailwind CSS
- **Base de Datos**: Supabase (PostgreSQL)
- **Gráficas**: Recharts
- **Exportación**: XLSX (SheetJS)
- **Lenguaje**: TypeScript

## 📦 Instalación
```bash
# Clonar repositorio
git clone [URL]
cd teg-modernizado

# Instalar dependencias
npm install

# Configurar variables de entorno
# Crear archivo .env.local con:
NEXT_PUBLIC_SUPABASE_URL=tu_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_key

# Ejecutar en desarrollo
npm run dev

# Abrir en navegador
http://localhost:3000
```

## 👤 Usuarios de Prueba

**Admin:**
- Email: roque@tacosgavilan.com
- Password: admin123

**Supervisor:**
- Email: carlos@tacosgavilan.com
- Password: super123

**Manager:**
- Email: aaron@tacosgavilan.com
- Password: manager123

## 📂 Estructura del Proyecto
```
teg-modernizado/
├── app/
│   ├── page.tsx                 # Login
│   ├── dashboard/
│   ├── tiendas/
│   ├── usuarios/
│   ├── inspecciones/
│   │   └── nueva/
│   ├── checklists/
│   ├── feedback/
│   │   └── nuevo/
│   ├── reportes/
│   ├── estadisticas/
│   ├── configuracion/
│   ├── buscar/
│   ├── loading.tsx
│   └── not-found.tsx
├── components/
│   ├── Sidebar.tsx
│   ├── LoadingSkeleton.tsx
│   └── Toast.tsx
├── public/
├── .env.local
├── package.json
└── README.md
```

## 🚀 Funcionalidades Destacadas

### Formularios Interactivos
- Validación en tiempo real
- Cálculo automático de scores
- Categorización NPS automática

### Reportes Avanzados
- Filtros por fecha y tienda
- Exportación a Excel
- Gráficas interactivas

### Búsqueda Global
- Busca en todas las secciones
- Resultados categorizados
- Enlaces directos

### Dashboard Inteligente
- Alertas basadas en métricas
- Acciones rápidas
- Actividad reciente

## 📊 Progreso del Proyecto

**Completado: 95%**

**Tiempo invertido: ~14 horas**

### ✅ Completado:
- 11 módulos funcionales
- 635 registros migrados
- Autenticación completa
- Reportes con gráficas
- Formularios de captura
- Búsqueda global
- Configuración de usuario

### 🔄 Pendiente (5%):
- Deploy a producción
- Optimización de rendimiento
- Testing automatizado
- Documentación API
- Políticas RLS avanzadas

## 🎨 Diseño

- Responsive design
- Mobile-friendly
- Sidebar colapsable
- Tema consistente rojo/gris
- Animaciones suaves

## 📈 Métricas del Sistema

- **15 Tiendas** activas
- **54 Usuarios** en 4 roles
- **168 Feedbacks** con NPS 86
- **104 Inspecciones** con score 98.6%
- **288 Checklists** en 6 tipos

## 🔒 Seguridad

- Autenticación requerida
- Sesiones persistentes
- Validación de datos
- Sanitización de inputs
- Roles y permisos

## 📞 Soporte

Para soporte o dudas sobre el sistema:
- Email: soporte@tacosgavilan.com
- Sistema creado en Diciembre 2024

## 📄 Licencia

Propiedad de Tacos Gavilan - Todos los derechos reservados