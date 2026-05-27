const fs = require('fs');

const data = `1	8:00 AM	2 minutos	Abrir puerta y desactivar alarma	Apertura	Diario		Asistente/SL	
2	8:02 AM	1 minuto	Encender luces de cocina	Apertura	Diario		Asistente/SL	
3	8:02 AM	60 minutos	Lavar freidoras	Apertura	Viernes		Asistente/SL	
4	8:02 AM	30 minutos	Revisar y limpiar ROOF	Apertura	Domingo		Asistente/SL	
5	8:03 AM	15 minutos	Preparar las cajas registradoras	Apertura	Diario		Asistente/SL	
6	8:18 AM	20 minutos	Lavar filtros de campanas y colocarlos	Apertura	Diario		Asistente/SL	
7	8:40 AM	30 minutos	Armar y rellenar maquinas de aguas, mover tapetes y mapear	Apertura	Diario		Asistente/SL	
8	8:50 AM	10 minutos	Limpieza de vidrios de toda la linea (incluido salsabar)	Apertura	Diario		Asistente/SL	
9	9:00 AM	60 minutos	Recepcion, revision y acomodamiento de la mercancia	Apertura	Diario			
10	9:00 AM	1 minuto	Encender Steamer	Apertura	Diario			
11	9:00 AM	10 minutos	Preparacion de frijol molido y de la olla	Apertura	Diario			
12	9:10 AM	10 minutos	Acomodar los tapetes (lavados de anoche)	Apertura	Lunes			
13	9:10 AM	10 minutos	Rellenar arroz, cabeza y lengua en el steamer	Apertura	Diario			
14	9:20 AM	10 minutos	Rellenar salsa bar (limones, salsar, cebolla, chiles, frijoles)	Apertura	Diario			
15	9:00 AM	30 minutos	Rellenar refrigeradores de la linea (carnes, tortillas, jamon, salchicha, milaneza, huevos, papelitos, quesadillas, mulitas, burritos, nachos, sopes, teleras)	Apertura	Diario			
16	9:30 AM	15 minutos	Rellenar steam table (frijol, arroz, cebolla, quesos, salsas verde y roja, crema, aguacate, mayo, aluminio)	Apertura	Diario			
17	9:30 AM	20 minutos	Preparacion de champurrado	Apertura	Diario			
18	9:45 AM	15 minutos	Revision de salon y baños	Apertura	Diario			
19	9:50 AM	5 minutos	Preparacion de salsa ranchera	Apertura	Diario			
20	9:30 AM	1 minuto	Encender planchas	Apertura	Diario			
21	9:30 AM	1 minuto	Encender freidora	Apertura	Diario			
22	9:30 AM	1 minuto	Encender campanas y sus luces	Apertura	Diario			
23	9:30 AM	1 minuto	Encender Steam table (llenado de agua y calentamiento)	Apertura	Diario			
24	9:35 AM	5 minutos	Colocar cubetas rojas de sanitizer	Apertura	Diario			
25	9:40 AM	5 minutos	Colocar toallas (trapos) en la linea, cajas y preparacion	Apertura	Diario			
25.2	9:40 AM	20 minutos	Preparacion de guacamole, cremas y mayonesa	Apertura	Diario			
26	9:45 AM	7.5 minutos	Cocinar asada en plancha grande	Apertura	Diario		La carne asada se expande completamente en los 450° y se deja ahi sin moverla entre 2 a 2 ½ min, despues se junta y se le da vuelta y se deja otros 2 min. al terminar este tiempo se avienta hacia la derecha a los 300° para reposarla un minuto y luego se voltea para otro minuto, en total 2 min. Siempre verificar el reloj de pared 	
27	9:45 AM	8 minutos	Cocinar Pollo en plancha pequeña	Apertura	Diario		El pollo se expande completamente en los 450° y se deja ahi sin moverla entre 3 a 3½ min, despues se junta y se le da vuelta y se deja otros 2 min. al terminar este tiempo se avienta hacia la derecha a los 300° para reposarla un minuto y luego se voltea para otro minuto, en total 2 min. Siempre verificar el reloj de pared 	
28	9:50 AM	5 minutos	Cocinar tostadas	Apertura	Diario		El pastor se expande completamente en los 450° y se deja ahi sin moverla 2 min, despues se avienta hacia la derecha para raspar y limpiar el adobo pegado, se regresa a los 450° otros 2 min. al terminar este tiempo se avienta hacia la derecha a los 300° para reposarla un minuto y luego se voltea para otro minuto, en total 2 min. Siempre verificar el reloj de pared 	
30	9:53 AM	7.5 minutos	Cocinar Pastor en plancha grande	Apertura	Diario		La Cebolla se expande en los 450° y se deja sin moverla 1 minuto, despues se voltea y se deja 1 minuto mas.	
31	9:53 AM	2 minutos	Cocinar cebollas asadas	Apertura	Diario			
32	9:55 AM	2 minutos	Encender TVs	Apertura	Diario			
33	9:57 AM	1 minuto	Encender luces del comedor	Apertura	Diario			
34	10:00 AM	1 minuto	Abrir la puerta principal a los clientes	Apertura	Diario			
34.1	10:00 AM	3 minutos	Abrir Drive Thru	Apertura	Diario	ok		
34.2	10:00 AM	20 minutos	Limpieza del walking (limpiar, barrer y mapear)	Apertura	Diario			
34.3	10:00 AM	20 minutos	Barrer y mop cocina y linea de preparacion	Regular	Diario			
35	10:00 AM	2 minutos	Colocar charolas rojas de entrega de ordenes en la linea	Apertura	Diario			
37	10:00 AM	60 minutos	Barrer y mapear comedor de clientes	Regular	Diario			
38	10:01 AM	5 minutos	Rellenar refrigerador de postres y botellas de agua	Regular	Diario			
39	10:30 AM	5 minutos	Rellenar cucharas, tenedores, cuchillos, vasos, servilletas, popotes, palillos, cremas, azucar, sal	Apertura	Diario			
	11:00 AM	20 minutos	Tomar temperaturas y daily Check	Regular	Diario			
	11:00 AM	30 minutos	Barrer parking	Regular	Diario			
	1:00 PM	5 minutos	CASH DROP	Regular	Diario			
	3:00 PM	60 minutos	Barrer y mapear comedor de clientes	Regular	Diario			
	4:00 PM	5 minutos	CASH DROP	Regular	Diario			
	4:00 PM	20 minutos	Limpieza general de baños	Regular	Diario			
	4:30 PM	20 minutos	Tirar basura al contenedor externo	Regular	Diario			
	5:00 PM	10 minutos	Cambio de turno	Regular	Diario			
	5:50 PM	20 minutos	Tomar temperaturas y daily Check	Regular	Diario			
	7:00 PM	5 minutos	CASH DROP	Regular	Diario			
	9:00 PM	5 minutos	CASH DROP	Regular	Diario			
	11:00 PM	5 minutos	CASH DROP	Regular	Diario			
	11:00 PM	20 minutos	Limpieza general de baños	Regular	Diario			
	11:30 PM	20 minutos	Tirar basura al contenedor externo	Regular	Diario			
	12:00 AM	30 minutos	AVANZAR LINEA (lavar steam table burritos)	Zierre	Diario			
	12:30 AM	20 minutos	LAVAR PLANCHA GRANDE	Zierre	Diario			
	12:50 AM	5 minutos	LAVAR PLANCHA DE BURRITOS	Zierre	DOMINGO			
	1:00 AM	20 minutos	Lavar tapetes negros (salon y baños)	Zierre	Domingo			
	1:00 AM	60 minutos	PROFUNDO bajar filtros (acido), limpieza campana y paredes de acero inox, debajo de planchas, cajones de refrigeradores, abajo de steamtable, panera	Zierre	Jueves y Domingo			
	1:00 AM	20 minutos	Lavado de maquina de sodas	Zierre				
	1:00 AM	10 minutos	LAVAR VAPORERA (TORTILLAS)	Zierre	Diario			
	1:00 AM	50 minutos	LAVAR TRASTES Y ACOMODARLOS	Zierre	Diario			
	1:00 AM	30 minutos	LAVAR LINEA Y SALSABAR	Zierre	Diario			
	1:00 AM	30 minutos	LAVADA PROFUNDA VAPORERA DE TORTILLAS	Zierre	JUEVES			
	1:00 AM	15 minutos	CIERRE SALON, CAFETERAS, MAQUINA DE SODAS Y BAñOS	Zierre	Diario			
	1:00 AM	2 minutos	APAGAR TVS	Zierre	Diario			
	1:00 AM	30 minutos	CORTES Y DEPOSITO	Zierre	Diario			
	1:00 AM	20 minutos	CONTAR SOBRANTES Y MARCAR, CONTAR FLANES Y CK	Zierre	Diario			
	1:20 AM	10 minutos	ENVIAR LA ORDEN A LA BODEGA	Zierre	Diario			
	1:10 AM	15 minutos	LAVAR PLANCHA TORTAS	Zierre	Diario			
	1:25 AM	20 minutos	SACAR BASURAS y cambiar bolsas	Zierre	Diario			
	1:30 AM	15 minutos	LAVAR PISOS Y ACOMODAR TRASTES	Zierre	Diario			
	1:30 AM		LAVAR PANERA (SHELF)	Zierre	JUEVES			
	1:40 AM	20 minutos	PESAR CARNES	Zierre	Diario			
	1:45 AM	15 minutos	LAVAR TODOS LOS BAñOS	Zierre	Diario			
	1:45 AM	15 minutos	LAVAR BOTES BASURA Y CAJONERAS ACERO INOX	Zierre	Diario			
	1:50 AM	10 minutos	Limpieza de vidrios de toda la linea (incluido salsabar)	Zierre	Diario			
	2:00 AM	2 minutos	APAGAR LUCES SALON, COCINA	Zierre	Diario			
	2:00 AM	1 minutos	ARMAR ALARMA	Zierre	Diario			
	2:00 AM	3 minutos	CHECKLIST CIERRE	Zierre	Diario			
	2:00 AM		REVISAR BOTES DE CUARTO DE BASURA TAPAS CERRADAS 	Zierre	Diario			
	10:30 PM	15 minutos	Lavar plancha chica	Zierre	Diario			
	10:30 PM		LAVAR COLADERAS Y AVANZAR TRASTES	Zierre	Diario			
	11:40 PM	20 minutos	BAJAR FILTROS Y APAGAR PLANCHA DE BURRITOS	Zierre	Diario			
	11:40 PM	20 minutos	LAVAR FILTROS Y LIMPIAR CAMPANA Y PARED	Zierre	Diario`;

const lines = data.split('\\n');
const values = [];

for (const line of lines) {
  if (!line.trim()) continue;
  const parts = line.split('\\t');
  if (parts.length < 5) continue; // skip incomplete rows
  
  let [no, horario, tiempo, actividad, tipo, dia, dt, responsable, descripcion] = parts;
  
  // Format strings and escape quotes
  horario = horario ? \`'\${horario.trim()}'\` : 'NULL';
  tiempo = tiempo ? \`'\${tiempo.trim()}'\` : 'NULL';
  actividad = actividad ? \`'\${actividad.trim().replace(/'/g, "''")}'\` : 'NULL';
  tipo = tipo ? \`'\${tipo.trim() === 'Zierre' ? 'Cierre' : tipo.trim()}'\` : 'NULL';
  dia = dia ? \`'\${dia.trim()}'\` : "'Diario'"; // Default to Diario if empty, as per common sense in ops, but let's see. If missing, maybe Diario.
  if (dia === "''") dia = "'Diario'";
  responsable = responsable ? \`'\${responsable.trim()}'\` : 'NULL';
  descripcion = descripcion ? \`'\${descripcion.trim().replace(/'/g, "''")}'\` : 'NULL';
  
  // Format time logic to time type if possible, or just keep string for now. Let's keep as string in start_time.
  // Converting '8:00 AM' to time:
  let timeStr = "NULL";
  if (horario !== 'NULL') {
    let t = horario.replace(/'/g, "");
    try {
        let match = t.match(/(\\d+):(\\d+)\\s*(AM|PM)/i);
        if (match) {
            let h = parseInt(match[1]);
            let m = match[2];
            let ampm = match[3].toUpperCase();
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            timeStr = \`'\${String(h).padStart(2, '0')}:\${m}:00'\`;
        }
    } catch(e) {}
  }
  
  // parse duration_minutes
  let durationMins = "NULL";
  if (tiempo !== 'NULL') {
    let minMatch = tiempo.replace(/'/g, "").match(/([\\d.]+)/);
    if (minMatch) {
       durationMins = minMatch[1];
    }
  }

  values.push(\`( \${timeStr}, \${durationMins}, \${actividad}, \${tipo}, \${dia}, \${responsable}, \${descripcion} )\`);
}

const sql = \`
CREATE TABLE IF NOT EXISTS operating_procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    start_time TIME NOT NULL,
    duration_minutes NUMERIC,
    activity TEXT NOT NULL,
    shift_type TEXT NOT NULL,
    frequency TEXT NOT NULL,
    role TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE operating_procedures ENABLE ROW LEVEL SECURITY;

-- Crear políticas (lectura pública para empleados, solo admins escriben)
DROP POLICY IF EXISTS "Enable read access for all users" ON operating_procedures;
CREATE POLICY "Enable read access for all users" ON operating_procedures FOR SELECT USING (true);

TRUNCATE TABLE operating_procedures;

INSERT INTO operating_procedures (start_time, duration_minutes, activity, shift_type, frequency, role, description)
VALUES
\${values.join(',\\n')};
\`;

fs.writeFileSync('c:\\\\Users\\\\pedro\\\\Desktop\\\\teg-modernizado\\\\scripts\\\\generate_procedures_sql.sql', sql);
console.log('SQL generated successfully.');
