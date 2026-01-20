# Notificaciones de Horarios: Estrategia SMTP (Solo Email)

Debido a bloqueos masivos por parte de las operadoras telefónicas (específicamente Verizon y AT&T) hacia los gateways de SMS gratuitos, hemos optado por una estrategia **100% Email Institucional**.

## 1. Arquitectura de Envío
El sistema utiliza **Nodemailer** conectado a la cuenta corporativa `carlos@tacosgavilan.com`.
- **Límite:** Google Workspace permite aprox. **2,000 correos/día**.
- **Fiabilidad:** Alta. Los correos llegan a la bandeja de entrada sin ser marcados como SPAM.

## 2. Flujo de Notificaciones
Cuando se publica un horario:

### A. Correo Personal (HTML)
Se envía el horario formateado al correo del empleado.
- **Formato:** HTML limpio y responsivo, compatible con móviles.
- **Costo:** $0.

### B. SMS (Desactivado)
La funcionalidad de SMS gratuitos ha sido **desactivada** para evitar que la cuenta de correo principal caiga en listas negras (Blacklists) de SPAM, lo cual afectaría la operatividad de la empresa.
*Si en el futuro se requiere SMS, se deberá integrar Twilio API ($0.0079/msg).*

## 3. Configuración Requerida
El archivo `.env.local` debe contener:
```env
SMTP_EMAIL=carlos@tacosgavilan.com
SMTP_PASSWORD=[App Password dada por Google]
```

## 4. Código Relevante
La lógica se encuentra en: `app/api/notifications/publish-schedule/route.ts`
