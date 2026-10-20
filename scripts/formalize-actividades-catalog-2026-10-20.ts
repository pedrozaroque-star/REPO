/**
 * @module formalize-actividades-catalog-2026-10-20
 * @description Script de estandarización ejecutiva (Nombre Corto 2-5 palabras + Descripción Detallada en Detalles)
 * para las 200 actividades de `operating_procedures` (140 del Catálogo Corporativo + 60 de ROLES_MODULE),
 * preservando trazabilidad de títulos anteriores en `overrides.previous_activity_titles` y sincronizando
 * todos los snapshots históricos en `station_assignments.tasks`.
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface ProcedureUpdateSpec {
  activity: string;
  description: string;
  frequency?: string;
}

// Mapa exacto por UUID de las 200 actividades (140 Catálogo + 60 ROLES_MODULE)
// Regla de negocio: `activity` = Nombre Corto ejecutivo (2 a 5 palabras en Title Case);
// `description` = Instrucción operativa detallada y completa.
const CATALOG_UPDATES_BY_ID: Record<string, ProcedureUpdateSpec> = {
  // ══════════════════════════════════════════════════════════════════════════
  // BLOQUE 1: APERTURA (44)
  // ══════════════════════════════════════════════════════════════════════════
  'e4067695-7a2f-4000-b1df-ab5cac3ab1b4': {
    activity: 'Lavar Refrigerador de Mercancía',
    description:
      'Limpiar y desinfectar el interior, repisas, empaques y puertas del refrigerador de mercancía antes de acomodar el producto nuevo.',
  },
  '33501d9a-00bb-4170-a48c-b7b23a744e99': {
    activity: 'Surtir Refrigeradores de Línea',
    description:
      'Rellenar los refrigeradores de la línea con carnes, tortillas, jamón, salchicha, milanesa, huevos, papelitos, quesadillas, mulitas, burritos, nachos, sopes, teleras, covers, containers, desechables y bolsas. Colocar las charolas rojas de entrega en la línea.',
  },
  '0aaec28e-cad0-4251-9035-38d0c7e3df05': {
    activity: 'Recibir y Acomodar Mercancía',
    description:
      'Recibir el pedido de La Bodega, revisar que las cantidades estén completas y acomodar la mercancía en el cuarto frío y almacén poniendo el producto nuevo atrás.',
  },
  '3ff78a6a-67ea-4a0e-bb4a-4668b8cbe501': {
    activity: 'Abrir Puerta y Desactivar Alarma',
    description:
      'Ingresar a la sucursal en el horario de apertura programado, desactivar el sistema de alarma y realizar inspección visual de seguridad del local.',
  },
  '124b2338-12cd-4273-b2ec-fa60de626535': {
    activity: 'Preparar Frijol Molido y Olla',
    description:
      'Preparar y calentar las bolsas de frijol molido y frijol entero (de la olla) recibidas de La Bodega hasta alcanzar la consistencia y temperatura de servicio.',
  },
  '00ce5503-861d-4cb0-aa20-d97d93e0d81f': {
    activity: 'Encender Vaporera de Cabeza',
    description:
      'Llenar con agua al nivel indicado y encender la vaporera destinada a calentar el arroz, la cabeza y la lengua.',
  },
  '9af2cb82-aa6a-430a-a262-55713516a520': {
    activity: 'Encender Luces de Cocina',
    description:
      'Encender la iluminación general de cocina, área de preparación, cuarto frío y pasillos de servicio al iniciar el turno.',
  },
  '1b39b267-c4e1-4d7a-8a25-5aef37c32d0d': {
    activity: 'Lavar Freidoras',
    description:
      'Lavar y secar completamente las tinas y canastillas de las freidoras antes de colocar aceite limpio para la jornada.',
  },
  'd1b80509-58a3-4a67-af0e-750bfb54f638': {
    activity: 'Revisar y Limpiar Roof',
    description:
      'Subir al techo (Roof) para inspeccionar extractores y equipo, retirar grasa acumulada y dejar el área limpia y segura.',
  },
  '5d0a2128-dfbd-4c16-be82-daf194bbbfd4': {
    activity: 'Preparar Cajas Registradoras',
    description:
      'Contar los fondos fijos de apertura, colocarlos en las gavetas de las cajas registradoras y verificar rollos de papel térmico para tickets.',
  },
  '91fcd551-5f31-485a-b95c-f41551ac05b7': {
    activity: 'Montar Arroz, Cabeza y Lengua',
    description:
      'Rellenar y colocar los contenedores de arroz, cabeza y lengua dentro de la vaporera caliente para que alcancen su temperatura.',
  },
  'c4e3f430-c660-40e8-aa1e-51dfe9c96597': {
    activity: 'Colocar Tapetes Limpios',
    description:
      'Acomodar en cocina, línea, área de bebidas y cajas los tapetes que quedaron lavados y escurridos la noche anterior.',
  },
  '96c27d13-9992-4c78-ac32-cbefd61dceb7': {
    activity: 'Lavar y Colocar Filtros',
    description:
      'Sacar los filtros de las campanas del contenedor con líquido limpiador (ácido), enjuagarlos, escurrirlos y colocarlos en la campana.',
  },
  '23f87cb3-7d7f-4999-afb6-0c759eb61c24': {
    activity: 'Surtir Salsa Bar',
    description:
      'Rellenar la barra de salsas (Salsa Bar) con limones, salsa roja, salsa verde, cebolla con cilantro (mixta), chiles (rajas con zanahoria) y frijoles de la olla.',
  },
  '8c2e3bc4-efc9-48d2-afe2-462c1f607c8c': {
    activity: 'Limpiar Vidrios de Línea',
    description:
      'Limpiar con líquido limpiavidrios todos los vidrios de la línea de servicio y de la barra de salsas (Salsa Bar) por ambos lados.',
  },
  '3dc39e84-a169-481d-b080-0f09ae971905': {
    activity: 'Montar Vaporeras de Línea',
    description:
      'Rellenar en las vaporeras de carnes los contenedores de frijol, arroz, cebolla, quesos (rayado, cotija y de tortas), salsa verde, salsa roja, crema, aguacate, mayonesa y papel aluminio.',
  },
  '73fee4d0-6b42-42be-9d63-ed87b234799a': {
    activity: 'Encender Freidora',
    description:
      'Verificar que el nivel de aceite sea el adecuado y encender la freidora para que se caliente.',
  },
  'b57beb62-c7da-4ed4-b570-d36183f36a95': {
    activity: 'Encender Campanas y Luces',
    description:
      'Encender todas las campanas de extracción y sus luces sobre el área de planchas y vaporeras.',
  },
  '23741aba-44ed-43c6-94aa-777028be7a9c': {
    activity: 'Encender Planchas',
    description:
      'Encender la plancha grande, plancha pequeña y plancha de tortas/burritos para que se calienten a su temperatura de trabajo.',
  },
  'ba131617-8b0b-412e-87f8-fd5f90674812': {
    activity: 'Preparar Champurrado',
    description:
      'Calentar y preparar el Champurrado Mix del día cuidando la temperatura para evitar que se pegue.',
  },
  '7feec502-f55b-4ab4-a937-bee63c647ba6': {
    activity: 'Barrer y Trapear Cocina',
    description:
      'Barrer y trapear todo el piso de la cocina y de la línea de preparación antes de abrir.',
  },
  'd4a24a36-1d7b-412c-a240-2715460a322f': {
    activity: 'Encender Vaporeras de Carnes',
    description:
      'Llenar de agua limpia las vaporeras (Steam Table) de las carnes y encenderlas para su calentamiento.',
  },
  '9d2e883b-1b38-49b9-834a-2c20c618801c': {
    activity: 'Colocar Cubetas de Sanitizer',
    description:
      'Preparar las cubetas rojas con agua y Sanitizer y colocarlas en cocina, línea y cajas.',
  },
  '4303bf47-c1fa-4b7b-be23-68c8dcf5d386': {
    activity: 'Preparar Guacamole y Cremas',
    description:
      'Vaciar y preparar en sus contenedores las bolsas de aguacate (guacamole), crema y mayonesa recibidas de La Bodega para surtir la línea.',
  },
  '3266af07-acd2-4b3d-bc51-968a7b4afab8': {
    activity: 'Colocar Toallas de Limpieza',
    description:
      'Colocar toallas (trapos) limpias en las cubetas de Sanitizer de la línea, cajas y área de preparación.',
  },
  '4cbe4bcb-5ef6-4987-ad95-8859713c012e': {
    activity: 'Surtir Máquinas de Aguas Frescas',
    description:
      'Preparar y rellenar las máquinas de aguas frescas (horchata, jamaica, piña y tamarindo), mover los tapetes del área y trapear el piso.',
  },
  'e802c5cc-20e3-44ad-a476-fe73e7a3504b': {
    activity: 'Cocinar Pollo en Plancha',
    description:
      'El pollo se extiende completamente a 450°F y se deja sin mover de 3 a 3½ min; después se junta, se le da vuelta y se deja otros 2 min. Al terminar este tiempo, se pasa hacia la derecha a 300°F para reposarlo 1 min y luego se voltea por otro minuto (2 min en total). Siempre verificar el reloj de pared.',
  },
  '9382d62a-21fb-4d19-b2e9-936984c6b6cc': {
    activity: 'Revisión de Salón y Baños',
    description:
      'Revisar que el salón comedor y los baños estén limpios, con papel, jabón, toallas y mesas listas antes de abrir.',
  },
  '904f8b10-9ae7-4a51-b4bf-ed02015c3866': {
    activity: 'Cocinar Asada en Plancha',
    description:
      'La carne asada se extiende completamente a 400°F y se deja sin mover de 2 a 2½ min; después se junta, se le da vuelta y se deja otros 2 min. Al terminar este tiempo, se pasa hacia la derecha a 300°F para reposarla 1 min y luego se voltea por otro minuto (2 min en total). Siempre verificar el reloj de pared.',
  },
  'f11d057a-7886-4196-bbe2-0432fb94006b': {
    activity: 'Surtir Cubiertos y Desechables',
    description:
      'Rellenar cucharas, tenedores, cuchillos, vasos, servilletas, popotes, palillos, cremas para café, azúcar y sal.',
  },
  '24d96359-b9fa-4523-b2f4-b88ef35d459a': {
    activity: 'Surtir Jaboneras y Toallas',
    description:
      'Surtir jabón para manos y rollos de toalla de papel en todos los lavamanos de cocina y baños.',
  },
  'c08b73b0-38d1-4ab3-b5a0-23e05dbe143e': {
    activity: 'Preparar Salsa Ranchera',
    description:
      'Calentar y preparar la bolsa de salsa para huevos rancheros y colocarla en su contenedor caliente en la línea.',
  },
  'd903e25d-a5a0-4109-b020-ebbd5848fbd7': {
    activity: 'Cocinar Tostadas',
    description:
      'Freír en aceite limpio las tostadas necesarias para los huevos rancheros y desayunos, escurrirlas y colocarlas en su contenedor.',
  },
  '1941ce99-d445-411c-95e7-94e254621175': {
    activity: 'Barrer Estacionamiento',
    description:
      'Barrer todo el estacionamiento, las banquetas y la entrada principal retirando basura y hojas.',
  },
  'ab7d4a7c-80c4-4d30-aa91-873cf9f24997': {
    activity: 'Cocinar Cebollas Asadas',
    description:
      'La cebolla se extiende a 350°F y se deja sin mover 1 minuto; después se voltea y se deja 1 minuto más.',
  },
  'ed7d23e9-500f-4f3d-885d-7006a2633b25': {
    activity: 'Cocinar Pastor en Plancha',
    description:
      'El pastor se extiende completamente a 450°F y se deja sin mover 2 min; después se pasa hacia la derecha para raspar y limpiar el adobo pegado, y se regresa a 450°F por otros 2 min. Al terminar este tiempo, se pasa hacia la derecha a 300°F para reposarlo 1 min y luego se voltea por otro minuto (2 min en total). Siempre verificar el reloj de pared.',
  },
  'f04b9d24-8ae6-435b-be05-33188b645f68': {
    activity: 'Encender Pantallas de TV',
    description:
      'Encender todas las pantallas de menú digital y televisores del comedor, verificando que muestren el contenido correcto.',
  },
  '77608c79-b12a-4df2-a0d1-9645347a8b23': {
    activity: 'Encender Luces del Comedor',
    description:
      'Encender la iluminación completa del salón comedor, letreros luminosos y área de atención al cliente antes de abrir puertas.',
  },
  'bd9b7311-204f-4ee3-ac5a-cc07bc6700bc': {
    activity: 'Limpiar Acero y Tile Negro',
    description:
      'Limpiar y detallar todas las superficies de acero inoxidable del frente y el azulejo negro (Tile Negro) para eliminar manchas de agua o grasa.',
  },
  '79d96bfc-59dd-4ce1-a16e-8da0bd3fb6f1': {
    activity: 'Abrir Drive-Thru',
    description:
      'Habilitar el carril de Drive-Thru, encender diademas (headsets), pantallas de pedidos y abrir ventanillas puntualmente a la hora de apertura.',
  },
  'bf5b089c-d14e-4e22-8722-7c3edb0987e3': {
    activity: 'Abrir Puerta Principal',
    description:
      'Retirar el seguro de las puertas de entrada principal puntualmente en el horario de apertura para recibir a los clientes.',
  },
  '07c82345-a242-4450-820c-f0a93bc78704': {
    activity: 'Limpieza del Walk-in',
    description:
      'Ordenar las tarimas y estantes del cuarto frío (Walk-in), limpiar derrames en repisas, barrer y trapear el piso interior.',
  },
  '3173b376-a0f4-45df-9e60-ba8ef3fee1b3': {
    activity: 'Preparar Cremas, Aguacate y Nachos',
    description:
      'Porcionar vasos de crema, salsa de aguacate y charolas/bolsas de nachos para abastecer la línea y los pedidos para llevar.',
  },
  'f63efdd5-4cc1-4a77-9cc8-8d7305596afa': {
    activity: 'Porcionar Chorizo (2 oz)',
    description:
      'Pesar y porcionar el chorizo en medidas estándar de 2 oz, acomodándolo en charolas etiquetadas dentro del refrigerador.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOQUE 2: REGULAR CON HORA (45)
  // ══════════════════════════════════════════════════════════════════════════
  '771c066c-fdb4-4d0c-b27b-f3512613ec86': {
    activity: 'Retiro de Efectivo (Cash Drop)',
    description:
      'Realizar retiro parcial de efectivo de las cajas registradoras y depositarlo en la caja fuerte (programado para viernes y sábados a medianoche).',
  },
  'cf0d9156-8b39-4d23-b173-9db6208b8230': {
    activity: 'Barrer y Trapear Comedor',
    description:
      'Barrer debajo de las mesas y pasillos del comedor de clientes y trapear con solución limpiadora colocando conos preventivos de piso mojado.',
  },
  'fe15d699-ceb9-440f-bee6-c011b31f1dca': {
    activity: 'Preparar Burritos, Sopes y Nachos',
    description:
      'Elaborar al momento burritos, sopes, nachos y órdenes de sides cuidando las porciones, presentación y temperatura de cada platillo.',
  },
  '54d9eb1f-9552-4c57-a329-21a82862ae1f': {
    activity: 'Barrer y Trapear Línea',
    description:
      'Mantener el piso de la línea de servicio libre de restos de comida o líquidos, barriendo de forma continua y trapeando cuando sea necesario.',
  },
  'd24f3ee1-7f64-4166-91c0-9344643b84c1': {
    activity: 'Servicio de Tacos y Línea',
    description:
      'Preparar tacos, entregar órdenes completas al cliente, mover constantemente las carnes en la vaporera para conservar su jugosidad y llevar el control de tortillas.',
  },
  '3d3feee5-ac7c-4282-aef1-45b2d834886e': {
    activity: 'Lavar Utensilios de Crema y Guacamole',
    description:
      'Retirar, lavar y desinfectar periódicamente las cucharas, pinzas y bases de los contenedores de crema y guacamole en la línea.',
  },
  '04e23772-4c80-46ee-a6eb-7dee5e2a4728': {
    activity: 'Hacer Covers',
    description:
      'Doblar y preparar los covers para tacos y órdenes de entrega en la estación de línea y empaque.',
  },
  'd1f27779-9856-41cc-9f66-ed227f073df8': {
    activity: 'Preparar Tortas, Quesadillas y Mulitas',
    description:
      'Elaborar en plancha las órdenes de quesadillas, mulitas y tortas, cuidando el dorado del pan/tortilla, fundido del queso y limpieza de la estación.',
  },
  '4f1b69dc-f1e0-4fa6-9903-83c9cc851333': {
    activity: 'Vaciar Depósitos de Grasa',
    description:
      'Remover y vaciar con cuidado la grasa acumulada en las canaletas y depósitos ubicados debajo de las planchas.',
  },
  '50edc21e-199a-4a2b-a347-6fdb147c68c8': {
    activity: 'Cocinar Carnes y Tortillas',
    description:
      'Cocinar carnes y cebollas asadas, calentar tortillas adecuadamente, escurrir las carnes antes de pasarlas a la línea y cambiar las charolas.',
  },
  '4bfac285-4210-4e48-9e02-c072efd25baa': {
    activity: 'Limpiar Mesas, Puertas y Vidrios',
    description:
      'Limpiar continuamente las mesas y bancas del comedor, así como las puertas de entrada y sus vidrios.',
  },
  '77fa903a-54c2-4487-b8c7-dc2d8a79fffd': {
    activity: 'Preparar Bebidas para Uber',
    description:
      'Servir, tapar y colocar en su bolsa sellada (Bolsa Agua Uber 22 oz / 32 oz) o portavasos las bebidas de los pedidos de Uber Eats y entregas.',
  },
  'c2485454-d965-4a7b-9087-51ca0a31e854': {
    activity: 'Rellenar Aguas Frescas',
    description:
      'Revisar el nivel de las máquinas de aguas frescas (horchata, jamaica, piña y tamarindo) y rellenarlas manteniendo limpia el área.',
  },
  '5808a8f0-69ef-40ef-86ad-986df9e6dffb': {
    activity: 'Lavar Charolas de Servicio',
    description:
      'Lavar, desinfectar y secar las charolas rojas de entrega de la línea.',
  },
  'ddb578c0-e39b-4f0a-a68c-d4e5308ec215': {
    activity: 'Limpiar Barril de Grasa',
    description:
      'Lavar la base del barril de la grasa sobrante y limpiar el exterior del barril.',
  },
  'c5713479-8c1c-4f75-a8e8-43d5f7779752': {
    activity: 'Surtir Postres y Agua Embotellada',
    description:
      'Rellenar el refrigerador exhibidor con los postres (Flan y Cheesecake) y botellas de Agua Gavilan, cuidando su orden y rotación.',
  },
  '2194a47e-b36c-4ca2-81cb-a061e0671e1e': {
    activity: 'Temperaturas y Daily Check (AM)',
    description:
      'Tomar las temperaturas de alimentos y refrigeradores en la mañana y llenar la hoja del Daily Check.',
  },
  'f2bdb532-aedb-40b3-a434-d486d60df33b': {
    activity: 'Barrer y Trapear Comedor',
    description:
      'Barrer y trapear el comedor de clientes haciendo énfasis sobre el pasillo de las aguas frescas y frente a la línea del Salsa Bar.',
  },
  'd63d477e-48ff-4382-8543-84d571d2dffd': {
    activity: 'Rellenar Líquidos',
    description:
      'Revisar niveles y rellenar los contenedores y dispensadores de líquidos de operación y limpieza en el área asignada.',
  },
  'e46cc2a4-5a03-4102-a39a-9e1adcbc19b8': {
    activity: 'Retiro de Efectivo (Cash Drop)',
    description:
      'Realizar retiro de efectivo acumulado en las cajas registradoras, registrarlo en el sistema POS y resguardarlo en la caja fuerte.',
  },
  '56f77ad0-3e3f-41c7-82ef-46a3866a6f2e': {
    activity: 'Limpieza de Baños',
    description:
      'Revisar y limpiar sanitarios, lavamanos, espejos y pisos de los baños, vaciar botes de basura y reponer papel y jabón.',
  },
  'ee0ce02d-21c4-406c-837d-e3f76be318a4': {
    activity: 'Pulir Superficies de Cobre',
    description:
      'Limpiar y pulir con producto especial las superficies y detalles decorativos de cobre para mantener su brillo.',
    frequency: 'Sábado',
  },
  '1c946d8a-8d77-448d-b16d-a215c9413dbf': {
    activity: 'Pulir Acero Inoxidable',
    description:
      'Limpiar y pulir a detalle las paredes, puertas y frentes de acero inoxidable en línea y cocina.',
    frequency: 'Miércoles',
  },
  'be455962-1f60-4234-b02e-2e3a005f653a': {
    activity: 'Revisar Contenedor de Basura',
    description:
      'Inspeccionar el área del contenedor externo (Dumpster), acomodar bolsas dentro del contenedor y barrer cualquier residuo alrededor.',
  },
  '0ed6fb5c-e70a-4a6e-bcbb-26ba65fbf627': {
    activity: 'Barrer y Trapear Comedor',
    description:
      'Barrer y trapear el piso del salón comedor después de la hora pico de comida para mantener la tienda impecable.',
  },
  '3c0bbe4a-614f-428a-95e4-ed9c85bfaa98': {
    activity: 'Limpieza General de Baños',
    description:
      'Lavar y desinfectar tazas, lavamanos, espejos y pisos de los baños antes del cambio de turno.',
  },
  '44aa6968-38b1-41d7-a964-d5036221db45': {
    activity: 'Corte de Cajas (Cambio de Turno)',
    description:
      'Realizar el corte de las cajas registradoras del turno de la mañana, contando y cuadrando el efectivo y el fondo de caja.',
  },
  'fa744a0d-00de-4c67-a734-d563af6de56e': {
    activity: 'Barrer Estacionamiento',
    description:
      'Dar recorrido vespertino por el estacionamiento y banquetas para recoger basura y mantener limpia la imagen exterior.',
  },
  '0f09dece-b6d7-4d65-82ec-7fa55736841b': {
    activity: 'Sacar Basura al Contenedor',
    description:
      'Retirar las bolsas llenas de todos los botes de cocina, línea y salón antes del cambio de turno, llevarlas al contenedor externo y colocar bolsas nuevas.',
  },
  'cc046e67-421f-46a3-8246-aec2d7728170': {
    activity: 'Surtir Cubiertos y Desechables',
    description:
      'Reabastecer al 100% cucharas, tenedores, servilletas, cuchillos, sal, popotes, vasos y bolsas para entregar el turno completo.',
  },
  'a2b10878-d062-4686-965b-f4ef853ff584': {
    activity: 'Cambio de Turno',
    description:
      'Recorrido conjunto entre el encargado saliente (AM) y el entrante (PM) para verificar que todas las estaciones queden limpias, abastecidas y sin pendientes.',
  },
  'fec4ecb6-f983-4cc9-8e3e-c798d1fbebd1': {
    activity: 'Solicitar Órdenes a Bodega y Viele',
    description:
      'Revisar existencias físicas y enviar la Orden de Líquidos (químicos, bolsas, café y suministros) a La Bodega y el pedido de desechables, químicos y sodas a Viele & Sons.',
  },
  '641a375c-4d1f-40fb-bcb7-59de003aadbe': {
    activity: 'Temperaturas y Daily Check (PM)',
    description:
      'Tomar y registrar las temperaturas de alimentos calientes en línea y cámaras de refrigeración correspondientes a la revisión del turno vespertino.',
  },
  '5a31011b-6b84-4567-9881-8255b3931321': {
    activity: 'Retiro de Efectivo (Cash Drop)',
    description:
      'Realizar retiro de efectivo de las cajas registradoras durante el turno de la tarde y resguardarlo en la caja fuerte.',
  },
  'fdd71b8d-a26c-4829-9379-bef43ea824d0': {
    activity: 'Limpieza de Baños',
    description:
      'Inspeccionar y limpiar los baños de clientes, reponer papel sanitario, toallas y jabón, y trapear el piso.',
  },
  'c2065bf3-797b-42cc-84eb-d92f311141c7': {
    activity: 'Limpiar Campana de Cocina',
    description:
      'Limpiar con desengrasante el frente y los bordes interiores de la campana de extracción de cocina.',
  },
  '5c86a48e-6d9c-4694-a6bb-85032dee59fa': {
    activity: 'Lavar Coladera y Máquina de Hielo',
    description:
      'Lavar la coladera grande, la pared de al lado y limpiar la máquina de hielo.',
  },
  'e99822c9-c6b6-4e3b-b0dd-299c49d28c88': {
    activity: 'Lavar Botes y Carros Negros',
    description:
      'Lavar con agua y jabón desengrasante los botes de basura de la línea y los carros negros.',
  },
  '48e83794-8365-4e24-9582-5c3fcfe0bf73': {
    activity: 'Lavar Cuarto Frío por Dentro',
    description:
      'Lavar por completo las paredes, estantes y piso del interior del cuarto frío (Walk-in).',
    frequency: 'Miércoles',
  },
  'e4d5fdb4-4ae7-4bcc-8907-b91c7d893a1e': {
    activity: 'Retiro de Efectivo (Cash Drop)',
    description:
      'Realizar retiro nocturno de efectivo de las cajas registradoras y depositarlo en la caja fuerte.',
  },
  '63586800-1c21-41fe-b2e3-8ba55fe5e66a': {
    activity: 'Barrer Estacionamiento Nocturno',
    description:
      'Barrer el estacionamiento y área exterior en el turno nocturno. Fines de semana a las 12:00 AM (realizado únicamente por personal masculino por seguridad).',
  },
  'a972bbe2-076e-42af-ba45-b2416ddfbc9c': {
    activity: 'Limpiar Lockers y Área de Empleados',
    description:
      'Limpiar y ordenar los casilleros (Lockers), depurar y lavar el refrigerador de empleados y limpiar por dentro y por fuera el horno de microondas.',
  },
  '720bd11e-d968-4632-a468-d2616046e4f4': {
    activity: 'Limpieza General de Baños',
    description:
      'Realizar limpieza completa y desinfección de los baños de clientes en el turno nocturno.',
  },
  '020dcda5-8186-40c6-805f-7ccfbdf12770': {
    activity: 'Sacar Basura al Contenedor',
    description:
      'Retirar las bolsas de basura acumuladas en la noche y depositarlas en el contenedor externo antes de la medianoche.',
  },
  '328e9230-46c5-44fb-8136-8055753f20b9': {
    activity: 'Lavar Compactadora de Basura',
    description:
      'Limpiar, desengrasar y lavar por dentro y por fuera la compactadora de basura, verificando que quede libre de residuos orgánicos.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOQUE 3: CIERRE (31)
  // ══════════════════════════════════════════════════════════════════════════
  '12c7c462-e761-4a99-b766-08b00df24d55': {
    activity: 'Lavar Tapetes de Salón y Baños',
    description:
      'Retirar, tallar con desengrasante, enjuagar a presión y dejar escurriendo los tapetes negros del salón comedor y de los baños.',
  },
  '49152bb5-2b69-451d-9781-b7a80e57d54c': {
    activity: 'Lavar Plancha de Burritos',
    description:
      'Apagar y lavar a fondo la plancha de burritos, quitando todo lo que quede pegado.',
  },
  '84441f82-9082-46ed-a77f-850d8d717acd': {
    activity: 'Lavar Vaporera de Cabeza y Lengua',
    description:
      'Drenar el agua, tallar con jabón y fibra de acero el interior y exterior de la vaporera de arroz, cabeza y lengua, y secarla.',
  },
  'cf0702d2-51a0-4c69-8d39-e801ea93a866': {
    activity: 'Lavar Plancha Grande',
    description:
      'Desconectar/apagar la plancha grande de carnes, tallar la placa hasta dejarla limpia, vaciar las charolas de grasa y limpiar bordes.',
  },
  'c3e24cb9-fff4-4850-9f09-bfae071eb831': {
    activity: 'Avanzar Línea y Steam Table',
    description:
      'Adelantar el desmontaje de la línea y lavar la mesa caliente (Steam Table) del área de burritos.',
  },
  '394585b4-6108-4439-8103-f0b6c59d7df8': {
    activity: 'Llenar Inspección de Cierre',
    description:
      'Completar la hoja o checklist de inspección de cierre verificando equipos apagados, puertas cerradas, limpieza y temperaturas.',
  },
  'd5487f0b-3f45-46c9-8a3b-9dde6c8cb578': {
    activity: 'Lavar Coladera de Reciclaje',
    description:
      'Retirar residuos sólidos, tallar con cepillo y desinfectar la coladera ubicada junto al bote de reciclaje.',
  },
  '510f6c85-fde5-45f3-a146-ec88681dbe6f': {
    activity: 'Limpiar Campana y Pared',
    description:
      'Tallar con desengrasante el interior y exterior de la campana de extracción y lavar la pared de acero inoxidable detrás de las planchas.',
  },
  '1b07d432-5a58-47df-8dd0-54efd7f306d8': {
    activity: 'Cortes de Caja y Depósito',
    description:
      'Realizar el cierre final de todas las cajas registradoras, cuadrar las ventas del día y preparar el sobre de depósito bancario en caja fuerte.',
  },
  'acdee8d4-e078-4ea5-bcbe-755081eeace5': {
    activity: 'Limpieza Profunda de Cocina',
    description:
      'Bajar filtros en ácido, limpiar campana y paredes de acero inoxidable, lavar debajo de las planchas, cajones de refrigeradores, debajo del Steam Table y panera (Shelf de tortas). Realizar lavado profundo de piso en cocina trasera y pulir acero inoxidable.',
  },
  '9eaf8676-79d5-4f4a-8b68-e402d6d00496': {
    activity: 'Lavar Línea y Salsa Bar',
    description:
      'Quitar todos los contenedores y charolas, drenar el agua y lavar con jabón toda la línea de servicio y la barra de salsas (Salsa Bar).',
  },
  'f295e2da-52c7-4f5b-9d2c-b12931371369': {
    activity: 'Bajar Filtros de Campana',
    description:
      'Quitar los filtros de las campanas y meterlos en el contenedor con líquido limpiador (ácido) durante la noche.',
  },
  'a73a8e52-26aa-4427-8215-4a1819def338': {
    activity: 'Lavar Vaporera de Tortillas',
    description:
      'Apagar, vaciar el agua y lavar por dentro y por fuera la vaporera de tortillas de la línea.',
  },
  'fd1807a2-a8fb-43c7-a2f9-9545d9bc37d7': {
    activity: 'Contar Sobrantes y Postres',
    description:
      'Pesar o contar los sobrantes de carnes e insumos al cierre, marcarlos y realizar el conteo físico final de postres (Flan y Cheesecake) para la Orden Diaria.',
  },
  '062b7089-d8ab-4c45-b888-6405feff4022': {
    activity: 'Activar Alarma y Cerrar Local',
    description:
      'Revisar que todas las puertas y ventanas de Drive-Thru estén bien cerradas, poner la alarma y cerrar con llave la puerta principal.',
  },
  '4ca678dd-f6eb-4b18-928c-2c550b454c73': {
    activity: 'Lavado de Piso Completo',
    description:
      'Tallar con cepillo y desengrasante, enjuagar y secar con jalador todo el piso de cocina, línea de servicio y pasillos.',
  },
  '3625ba34-5b28-4fef-8023-b3ed780be299': {
    activity: 'Lavar Trastes y Máquinas de Aguas',
    description:
      'Lavar todos los trastes, ollas y contenedores del cierre, así como las máquinas de aguas frescas.',
  },
  '4e3b653b-34f1-46d7-aecd-074f1e4f0925': {
    activity: 'Lavado Profundo de Vaporera de Tortillas',
    description:
      'Quitar la tapa de la vaporera de tortillas para lavarla profundamente.',
    frequency: 'Miércoles',
  },
  '46e74624-bb6a-4731-9918-2ae457676a34': {
    activity: 'Apagar Pantallas de TV',
    description:
      'Apagar todas las pantallas de menú y televisores del comedor al terminar la venta.',
  },
  'c3825773-a6f8-41e6-b03c-a1d125d67e82': {
    activity: 'Lavar Máquina de Sodas',
    description:
      'Quitar las boquillas y piezas de la máquina de sodas para lavarlas, y limpiar la charola y la máquina.',
  },
  '51ab8b54-c054-4c63-af66-d5a4931f1076': {
    activity: 'Lavar Plancha de Tortas',
    description:
      'Apagar, raspar, tallar y desengrasar por completo la plancha de tortas y quesadillas al finalizar la venta.',
  },
  'eae402fb-6344-4ed8-91ee-51cd9fb07fdc': {
    activity: 'Enviar Orden a La Bodega',
    description:
      'Registrar los sobrantes del cierre en el sistema y enviar la Orden Diaria de carnes, salsas, tortillas e insumos a La Bodega.',
  },
  'a6c454f7-3161-47a0-9f1e-cead0fd73deb': {
    activity: 'Sacar Basura y Cambiar Bolsas',
    description:
      'Vaciar absolutamente todos los botes de basura de la tienda en el contenedor externo, lavarlos si es necesario y dejarlos con bolsa limpia.',
  },
  '6daf0348-d113-45ec-94c4-af3c45983a29': {
    activity: 'Lavar Baños de Clientes y Empleados',
    description:
      'Tallar, desinfectar y secar los baños de clientes y el baño de empleados para dejarlos listos para la apertura del día siguiente.',
  },
  '7f269795-376d-41e9-90f5-908a49251410': {
    activity: 'Lavar Panera (Shelf)',
    description:
      'Vaciar, lavar con desengrasante y secar por completo el estante de pan (Shelf de tortas).',
    frequency: 'Jueves',
  },
  '15436a28-707c-46d0-8ee9-12858313e1e9': {
    activity: 'Lavar Coladeras de Piso',
    description:
      'Quitar las rejillas de todas las coladeras de piso, retirar residuos sólidos, tallar con cepillo, cloro y desengrasante y volver a colocarlas.',
  },
  '71ae953b-ca22-4d0d-bdae-7b72c6996bb8': {
    activity: 'Limpiar Vidrios de Línea (Cierre)',
    description:
      'Limpiar y desengrasar todos los vidrios de la línea de servicio y de la barra de salsas (Salsa Bar) al terminar el lavado de cierre.',
  },
  'f0c0954e-ed3e-47ec-b869-62bd918d8d3e': {
    activity: 'Cerrar Tapas del Cuarto de Basura',
    description:
      'Revisar el cuarto de basura antes de salir, asegurando que todos los contenedores tengan las tapas cerradas y la puerta quede asegurada.',
  },
  '978b7965-c3dd-413b-a1c5-d2f43039cb60': {
    activity: 'Apagar Luces de Salón y Cocina',
    description:
      'Apagar todas las luces de salón comedor, anuncios exteriores y cocina al concluir las labores de cierre.',
  },
  '1ddd13b8-3db2-4596-8148-498ad89ec887': {
    activity: 'Lavado Profundo de Campana y Piso',
    description:
      'Realizar lavado profundo de fin de jornada en campana de extracción, pared de acero, cajones refrigerados y pisos de cocina.',
  },
  'f4b96851-0fac-4013-81ff-f7bebce6ba31': {
    activity: 'Lavar Plancha Chica',
    description:
      'Apagar y lavar a fondo la plancha chica (pre-cierre), retirando grasa acumulada y limpiando sus bordes de acero.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOQUE 4: ACTIVIDADES SIN HORA FIJA (20)
  // ══════════════════════════════════════════════════════════════════════════
  'd648fff2-5827-405f-9355-c646ce65aea6': {
    activity: 'Acomodar Mercancía',
    description:
      'Ordenar y acomodar la mercancía en los estantes del almacén y del cuarto frío poniendo el producto nuevo atrás.',
  },
  'fc62c4ce-5743-4166-8528-542a16c270e0': {
    activity: 'Barrer Estacionamiento y Jardinera',
    description:
      'Barrer el estacionamiento completo y quitar la basura y hojas secas de las jardineras.',
  },
  'f6a25d88-460c-4334-837e-0a74a2b2604f': {
    activity: 'Lavar Baños',
    description:
      'Lavar y desinfectar tazas, lavamanos, espejos y pisos de los baños.',
  },
  'bf6583c1-88dc-4f7d-8b70-2477c40a0a95': {
    activity: 'Barrer y Trapear Piso',
    description:
      'Barrer y trapear el piso del área asignada.',
  },
  'df3ac85d-e682-4e3a-9143-4fba5b93259d': {
    activity: 'Lavar Tapetes y Piso de Sodas',
    description:
      'Retirar y lavar los tapetes del área de bebidas y lavar el piso debajo de la máquina de sodas.',
  },
  'b87a8b07-c90c-42d9-862b-86232b44bb9c': {
    activity: 'Cierre de Planchas, Filtros y Panera',
    description:
      '1. Bajar filtros y apagar plancha de burritos. 2. Lavar plancha de tortas. 3. Lavar filtros y limpiar campana y pared. 4. Lavar piso del área y panera.',
  },
  '0df32a03-84d3-4a88-8340-4e67ae380a86': {
    activity: 'Lavar Filtros de Campana',
    description:
      'Lavar con desengrasante y enjuagar los filtros de las campanas.',
  },
  '22797020-2a4f-4c26-b913-ca17bb0753d7': {
    activity: 'Cierre de Planchas, Filtros y Piso',
    description:
      '1. Bajar filtros y apagar plancha de burritos. 2. Lavar plancha de tortas. 3. Lavar filtros y limpiar campana y pared. 4. Lavar piso del área.',
  },
  '2b92799e-56cd-4e93-9f13-b1494d14aadf': {
    activity: 'Atención y Limpieza Ventana 1',
    description:
      'Cobrar y atender pedidos en la Ventana 1 de Drive-Thru, manteniendo limpia y surtida el área.',
  },
  '2e480a51-8108-403b-8dd4-7d13b071a4c1': {
    activity: 'Montar Arroz y Cabeza en Steamer',
    description:
      'Colocar el arroz, la cabeza y la lengua dentro de la vaporera (Steamer) para que se mantengan calientes.',
  },
  '06fe5562-2ea9-42c0-82f0-90ae2e1027b9': {
    activity: 'Barrer y Trapear Cocina y Walk-in',
    description:
      'Barrer y trapear los pisos de la línea, la cocina y el cuarto frío (Walk-in).',
  },
  '94e8607f-7326-434d-a388-2393cbed9bda': {
    activity: 'Sacar Basura',
    description:
      'Sacar las bolsas de basura llenas al contenedor de afuera y poner bolsas nuevas en los botes.',
  },
  '7ec5d6bc-9a0b-45dd-9b2a-fad1b63be333': {
    activity: 'Lavar Pisos Falsos de Acero',
    description:
      'Levantar, lavar con desengrasante y enjuagar los pisos falsos de acero inoxidable.',
  },
  'f57b2ec8-488a-449c-b579-b21b4d6589be': {
    activity: 'Limpiar Lavamanos',
    description:
      'Lavar los lavamanos y revisar que tengan jabón y toallas de papel.',
  },
  '8c57fa45-d246-413e-b71d-48a9d94cd586': {
    activity: 'Lavar Panera, Vidrios y Campanas',
    description:
      'Lavar y desengrasar la panera (Shelf de tortas), los vidrios de la línea y las campanas.',
  },
  '12a7e189-a994-40d1-a542-4a9dcd7b892c': {
    activity: 'Limpieza de Baños',
    description:
      'Limpiar los baños, poner papel, jabón y toallas, y trapear el piso.',
  },
  '8eac6bb5-0fd5-41ed-8bbe-4cb85a36a5b7': {
    activity: 'Cocinar Champurrado y Salsa Ranchera',
    description:
      'Calentar y preparar el champurrado y la salsa para huevos rancheros para surtir la línea.',
  },
  '7b74b004-5c88-425c-9d10-cbee010a1dc2': {
    activity: 'Lavar Piso',
    description:
      'Tallar con agua y jabón desengrasante el piso del área y secar con jalador.',
  },
  'c3467c93-9a88-493c-b9a4-4d0fbf75a716': {
    activity: 'Retiro de Efectivo (Cash Drop)',
    description:
      'Hacer retiro de efectivo de la caja registradora y guardarlo en la caja fuerte.',
  },
  '13a20630-1d83-4abb-8deb-d8e4b2f9eec1': {
    activity: 'Lavar Línea, Salsa Bar y Trastes',
    description:
      'Lavar la línea de servicio y el Salsa Bar, y lavar y acomodar todos los trastes.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOQUE EXTRA: 60 FILAS DE ROLES_MODULE (Homologadas con Nombre Corto + Detalle)
  // ══════════════════════════════════════════════════════════════════════════
  'ac933729-62a9-43e6-8e39-773cbc792e20': {
    activity: 'Cocinar Carnes de Apertura',
    description:
      'Cocinar las carnes necesarias en la plancha para abrir la tienda.',
  },
  '23daf7ac-38c8-4e42-b3c6-a227809514a7': {
    activity: 'Guardar Mercancía en Refrigerador',
    description:
      'Guardar en el cuarto frío toda la mercancía recibida de La Bodega.',
  },
  '05f1c463-0512-47a2-a3ae-486586a53ee0': {
    activity: 'Surtir Salsa Bar y Cajones',
    description:
      'Rellenar la barra de salsas (Salsa Bar) con limones, salsa roja, salsa verde, cebolla con cilantro (mixta), chiles (rajas con zanahoria) y frijoles de la olla, y surtir los cajones de refrigeración de verdura.',
  },
  '0dd0beb4-e682-438a-a02b-9cc01b484dcb': {
    activity: 'Limpiar Plafón (Ceiling)',
    description:
      'Limpiar el polvo y la grasa de las rejillas y del techo (Ceiling).',
  },
  'a7a4d6eb-aaca-4ace-acac-9cb75814900c': {
    activity: 'Lavar Contenedores de Aguas Frescas',
    description:
      'Lavar bien los contenedores antes de preparar las aguas frescas del día.',
  },
  '6d44e233-ca19-4737-bc91-7a757545a7e6': {
    activity: 'Armar y Surtir Salsa Bar',
    description:
      'Poner los contenedores limpios y rellenar la barra de salsas (Salsa Bar) con limones, salsa roja, salsa verde, cebolla con cilantro (mixta), chiles (rajas con zanahoria) y frijoles de la olla.',
  },
  '545a45e2-69c3-4bd1-9855-187b13aaf616': {
    activity: 'Armar y Surtir Línea',
    description:
      'Armar las vaporeras de la línea de servicio y rellenar todos los contenedores de carnes, arroz, frijol, salsas, quesos, crema y aguacate.',
  },
  'cf175290-709c-45f0-b329-20ca266b3b6f': {
    activity: 'Preparar Tostadas para Huevos Rancheros',
    description:
      'Freír y escurrir las tostadas necesarias para las órdenes de huevos rancheros del turno matutino.',
  },
  '7c7466ec-dfb7-42e6-96b8-c3953f646b97': {
    activity: 'Surtir Vasos en Estación',
    description:
      'Rellenar los dispensadores de vasos y tapas de todos los tamaños en el área de cajas y bebidas.',
  },
  'b12bbd90-e0b8-42a0-b6b5-278bb8bb8d49': {
    activity: 'Apoyo en Cajas Registradoras',
    description:
      'Apoyar en el cobro y atención de clientes en caja cuando se incremente la fila en horas pico.',
  },
  '802b5a99-636f-4b9d-a586-d3922b0b8e19': {
    activity: 'Preparar y Etiquetar Café',
    description:
      'Preparar el café fresco de la mañana y colocar su etiqueta con la hora de elaboración y caducidad.',
  },
  'cb3e8521-3d90-4269-ac6c-3dad32e61d55': {
    activity: 'Limpiar Tile Negro del Salón',
    description:
      'Limpiar y detallar el azulejo negro (Tile Negro) de las paredes y barra del salón comedor.',
  },
  '02de7adc-2b89-44d3-bd7f-21bb946e3a3d': {
    activity: 'Limpiar Vidrios de Entrada',
    description:
      'Limpiar por dentro y por fuera los cristales de las puertas de entrada principal.',
  },
  '6ffaa582-d2b5-417b-ba80-24d2df00e150': {
    activity: 'Cierre de Fregadero y Cocina',
    description:
      'Lavar ollas de frijoles, Steamer, trastes y botes de basura; colocar bolsas nuevas, sacar racks y tirar la basura en el contenedor.',
  },
  'b675a36d-5714-43fe-84e9-99e22a2ef57a': {
    activity: 'Avanzar Limpieza de Línea',
    description:
      'Adelantar la limpieza y desmontaje de los módulos de la línea de servicio previo al cierre.',
  },
  'ef27e480-605f-4895-8443-b361863cdafc': {
    activity: 'Lavar Plancha Grande',
    description:
      'Tallar, desengrasar y limpiar la plancha grande de carnes al cierre.',
  },
  '53a9755d-27d8-4e5b-977d-db4943655b7e': {
    activity: 'Lavar Plancha de Burritos',
    description:
      'Apagar y limpiar a fondo la plancha de burritos al finalizar el servicio.',
    frequency: 'Domingo',
  },
  'e9f3afd5-5b0f-4878-b97f-31a8b952d1e7': {
    activity: 'Cortes e Inspección de Cierre',
    description:
      'Realizar los cortes de caja, apoyar al equipo con las actividades finales y completar la inspección de cierre.',
  },
  '5b1cc2ed-47d9-408d-949e-c46d941c7a59': {
    activity: 'Lavado Profundo de Vaporera de Tortillas',
    description:
      'Quitar la tapa de la vaporera de tortillas para lavarla profundamente.',
    frequency: 'Jueves',
  },
  'f8ecca59-f3b2-461b-aa6b-4d036d0a0e26': {
    activity: 'Lavar Tapetes y Piso de Sodas',
    description:
      'Lavar los tapetes antideslizantes, tallar el piso del área de sodas y desechar las cajas de cartón.',
  },
  '2f14e211-9f54-4ea9-892a-6d29eadf8b1f': {
    activity: 'Lavar y Acomodar Trastes',
    description:
      'Lavar, desinfectar y acomodar en sus estantes todos los trastes y utensilios del cierre.',
  },
  '9ac57321-64d4-4f91-8811-a579ede79fa7': {
    activity: 'Cierre de Salón, Bebidas y Baños',
    description:
      'Realizar el cierre y limpieza del salón comedor, cafeteras, máquina de sodas y baños.',
  },
  '72f1a148-54e3-450d-8752-568e18b2ff88': {
    activity: 'Lavar Pisos y Acomodar Trastes',
    description:
      'Tallar y secar los pisos de cocina y terminar de acomodar los trastes limpios.',
  },
  'fe7ae44c-5c2e-4c8f-b399-3e1d64508037': {
    activity: 'Pesar Carnes Sobrantes',
    description:
      'Pesar todas las carnes sobrantes al cierre y registrarlas en el control de inventario.',
  },
  '9562cbb3-0194-49e3-b58c-2d5eef54065b': {
    activity: 'Lavar Botes y Cajoneras de Acero',
    description:
      'Lavar con agua y jabón desengrasante los botes de basura y las cajoneras de acero inoxidable.',
  },
  '4aae2d81-5bfc-4a41-875f-aeb09c6c36b9': {
    activity: 'Lavar Todos los Baños',
    description:
      'Realizar el lavado y desinfección nocturna de todos los baños de la sucursal.',
  },
  '1c7ae14b-ac96-4f1e-a43f-10d993a9f6e3': {
    activity: 'Cambiar Aceite de Freidoras',
    description:
      'Drenar y desechar de forma segura el aceite quemado de las freidoras para dejarlas listas para lavado.',
  },
  '4ca2f741-4cb5-4e39-880d-00b9c5d6332a': {
    activity: 'Cierre Completo de Línea y Salsa Bar',
    description:
      '1. Lavar vaporera de tortillas. 2. Lavar coladeras y avanzar trastes. 3. Lavar línea y Salsa Bar. 4. Quitar y limpiar bases de acero inoxidable bajo la línea. 5. Limpiar vidrios de línea y Salsa Bar.',
  },
  '6d8e4b04-d5bb-47df-8977-9cd85c6b8fe4': {
    activity: 'Surtir Aguas Frescas y Uber',
    description:
      'Rellenar las máquinas de aguas frescas y preparar las bebidas para las órdenes de Uber Eats y plataformas.',
  },
  'cb27bdd6-3422-4d2e-a923-1cea352b319b': {
    activity: 'Surtir Salsa Bar y Empacar Órdenes',
    description:
      'Mantener abastecida la barra de salsas (Salsa Bar), empaquetar correctamente las órdenes para llevar y confirmar cada pedido.',
  },
  '50912ee1-4fee-4b46-a5e5-728dbaddf841': {
    activity: 'Preparar Burritos, Sopes y Platos',
    description:
      'Elaborar las órdenes de burritos, nachos, sopes, platos combinados y sides en la línea de servicio.',
  },
  'dfb09401-bbbb-4477-8da7-f242823ae3e4': {
    activity: 'Cocinar Carnes y Limpiar Planchas',
    description:
      'Cocinar carnes y cebollas asadas, calentar tortillas adecuadamente, escurrir carnes, mantener limpias las planchas y vaciar las canaletas de grasa.',
  },
  'e7b5428b-d38f-4786-b705-8b15064f4eb3': {
    activity: 'Preparación General de Cocina',
    description:
      'Calentar arroz, frijoles, cabeza, lengua y champurrado; elaborar guacamole, cremas, mayonesa y porciones de nachos.',
  },
  'e2deb6df-e422-43cb-ba13-c165f1653646': {
    activity: 'Limpiar Pared Blanca y Lockers',
    description:
      'Lavar y desmanchar la pared blanca y limpiar los casilleros (Lockers) de empleados.',
  },
  '0c645048-6cb6-49a1-b716-713ac8319095': {
    activity: 'Limpiar y Lavar Walk-in',
    description:
      'Ordenar estantes, limpiar paredes y lavar el piso interior del cuarto frío (Walk-in).',
  },
  '98ca37c0-a3f2-4a33-9ad3-42b2b0e088fb': {
    activity: 'Lavar Botes de Basura',
    description:
      'Lavar con agua, jabón y cloro los contenedores y botes de basura de la tienda.',
  },
  'd27ef765-d510-4079-aa13-4b99892df793': {
    activity: 'Limpiar Campana de Extracción',
    description:
      'Desengrasar y limpiar la campana de extracción sobre el área de cocción.',
  },
  '459a007a-2991-4058-b297-f19cbeca9170': {
    activity: 'Lavar Carros Amarillos y Conos',
    description:
      'Lavar con desengrasante las cubetas exprimidoras (carros amarillos) y los conos preventivos de piso mojado.',
  },
  '842d2e62-3d8e-4f94-ac76-143a26647b45': {
    activity: 'Hacer Orden de Viele & Sons',
    description:
      'Revisar existencias de abarrotes, desechables y productos de limpieza para elaborar el pedido de Viele & Sons.',
  },
  '81ec7af4-a3ed-4973-8aeb-bbd9d2ee5564': {
    activity: 'Colocar Cubetas de Sanitizer',
    description:
      'Preparar y colocar las cubetas rojas con solución desinfectante (Sanitizer) en las estaciones.',
  },
  'a9ae6f7a-c944-4d28-a066-fec8794c0a4a': {
    activity: 'Rellenar Líquidos',
    description:
      'Verificar niveles y rellenar los contenedores y dispensadores de líquidos de operación y limpieza en el área asignada.',
  },
  '58a4b30f-8fa4-40dc-9c64-b3ef4bec4b1e': {
    activity: 'Cobro y Atención al Cliente',
    description:
      'Recibir al cliente con amabilidad, tomar y cobrar su orden con exactitud y entregar su ticket.',
  },
  '0f4782bb-501a-435b-a31d-beca81971789': {
    activity: 'Surtir Servilletas y Cubiertos',
    description:
      'Abastecer servilleteros, cucharas, tenedores, cuchillos y popotes en el mostrador de servicio.',
  },
  '8defe4b9-4282-441e-b514-29bfb2ea079a': {
    activity: 'Trapear Salón Comedor',
    description:
      'Trapear el piso del salón comedor cada vez que se requiera para mantenerlo limpio y seco.',
  },
  'ad0c6b39-d310-4bd3-9a37-7255d38e4155': {
    activity: 'Limpiar Mesas, Bancas y Vidrios',
    description:
      'Limpiar y sanitizar mesas, bancas y vidrios del salón comedor de manera continua durante el turno.',
  },
  'b0abaf5a-03cf-4632-be63-844a21f04941': {
    activity: 'Preparar Tortas, Quesadillas y Mulitas',
    description:
      'Elaborar tortas, quesadillas y mulitas manteniendo siempre abastecida y limpia la estación de plancha.',
  },
  '54dc7f5f-6b55-42ff-924b-2b6dbea8ac3b': {
    activity: 'Servicio de Tacos y Control de Tortillas',
    description:
      'Preparar tacos, entregar órdenes completas, llevar el control de tortillas y mover las carnes constantemente.',
  },
  'e359fe7b-092b-4e5f-892b-90b0fd2f2822': {
    activity: 'Orden y Limpieza de Cocina y Walk-in',
    description:
      'Mantener limpia toda el área de cocina, conservar ordenado el cuarto frío (Walk-in) y retirar la basura.',
  },
  '8a58c12b-863e-4d78-acb3-77f0eecfe48b': {
    activity: 'Limpiar Sillas para Bebés',
    description:
      'Lavar y desinfectar las sillas altas para bebés (High Chairs) del salón comedor.',
  },
  '56899940-e969-4fb8-aa6e-046c15377647': {
    activity: 'Limpiar Refrigerador de Empleados',
    description:
      'Retirar recipientes olvidados y limpiar por dentro y por fuera el refrigerador de empleados.',
  },
  '52d33cad-daaa-4a35-90c2-8d4977903e71': {
    activity: 'Lavar Coladera y Máquina de Hielo',
    description:
      'Lavar la coladera grande del área de bebidas y limpiar la máquina de hielo.',
  },
  'd13ad906-7229-48e6-a494-811a273f2079': {
    activity: 'Lavar Carros Negros',
    description:
      'Lavar y desengrasar los carros negros de cocina y salón.',
  },
  'a8793815-a128-48e1-8abb-714efa9da147': {
    activity: 'Limpiar Lavamanos y Surtir Papel',
    description:
      'Lavar los lavamanos de cocina y baños y poner rollos de papel y jabón.',
  },
  'b7b7a47c-450f-48f4-a3b8-edc572b58047': {
    activity: 'Limpiar Ventanas Exteriores',
    description:
      'Lavar y secar por fuera todas las ventanas de la tienda.',
  },
  'ca8505b4-4c9f-4325-aff1-3dcce1e16fca': {
    activity: 'Abastecer Línea de Producción',
    description:
      'Revisar y mantener abastecida de carnes, salsas, verduras y tortillas toda la línea de producción durante el turno.',
  },
  'f74f9d9d-685a-4ae8-8025-417c5ca2a365': {
    activity: 'Cortar Manteca y Porcionar Chorizo',
    description:
      'Cortar bloques de manteca y elaborar las porciones individuales de chorizo de 2 oz.',
  },
  '3f29be92-4166-454a-986f-e03831b3d181': {
    activity: 'Recibir Orden de Viele & Sons',
    description:
      'Verificar contra factura, recibir y acomodar en almacén el pedido entregado por Viele & Sons.',
  },
  '207e5cd8-0cbb-4c81-8a9f-978ee11e7de2': {
    activity: 'Trapear Salón (3:00 PM)',
    description:
      'Trapear el piso del salón comedor a las 3:00 PM después de la hora pico de comida.',
  },
  '887de803-3acd-4cb1-b11b-3380630750df': {
    activity: 'Limpieza del Cuarto de Basura',
    description:
      'Barrer, lavar con manguera y desengrasante y ordenar el cuarto de contenedores de basura.',
  },
  '3b82a7a6-72e9-4d47-9ef3-954ad9fe9c62': {
    activity: 'Pulir Acero Inoxidable',
    description:
      'Limpiar y pulir las superficies de acero inoxidable de cocina y línea en el turno nocturno.',
  },
};

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('✨ ESTANDARIZACIÓN DE NOMBRES CORTOS + DETALLES — CATÁLOGO DE ACTIVIDADES');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const { data: currentProcs, error: fetchErr } = await supabase
    .from('operating_procedures')
    .select('*');

  if (fetchErr || !currentProcs) {
    console.error('❌ Error consultando operating_procedures:', fetchErr);
    process.exit(1);
  }

  // 1. Guardar respaldo previo sin sobrescribir el respaldo original
  const backupPath = path.join(
    'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\scratch',
    'operating_procedures_backup_before_orden_diaria_fix_2026_10_20.json'
  );
  fs.writeFileSync(backupPath, JSON.stringify(currentProcs, null, 2), 'utf-8');
  console.log(`💾 Respaldo previo guardado en: ${backupPath} (${currentProcs.length} filas)`);

  const normalizePhrase = (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();

  const oldToNewTitleMap = new Map<string, string>();
  const normalizedToNewTitleMap = new Map<string, string>([
    [normalizePhrase('Cocinar Carnes, Cebollas Poner Tortillas Escurrir Carnes'), 'Cocinar Carnes y Tortillas'],
    [normalizePhrase('Cocinar Carnes y Cebollas, Poner Tortillas y Escurrir Carnes'), 'Cocinar Carnes y Tortillas'],
    [normalizePhrase('Cocinar Carnes, Cebollas, Poner Tortillas y Escurrir Carnes'), 'Cocinar Carnes y Tortillas'],
    [normalizePhrase('ACOMODAR Y CONTAR MERCANCIA'), 'Recibir y Acomodar Mercancía'],
    [normalizePhrase('Acomodar y Contar Mercancía de Bodega'), 'Recibir y Acomodar Mercancía'],
    [normalizePhrase('Acomodar y Contar Mercancía'), 'Recibir y Acomodar Mercancía'],
    [normalizePhrase('BARRER PARKING'), 'Barrer Estacionamiento'],
    [normalizePhrase('Lavar o Barrer Parking'), 'Barrer Estacionamiento'],
    [normalizePhrase('Lavar y Barrer Parking'), 'Barrer Estacionamiento'],
  ]);

  const procUpdateJobs: Array<{
    id: string;
    activity: string;
    description: string;
    frequency: string;
    overrides: Record<string, any>;
  }> = [];

  for (const proc of currentProcs) {
    const spec = CATALOG_UPDATES_BY_ID[proc.id];
    if (!spec) continue;

    const oldTitle = String(proc.activity || '');
    const prevOverrideTitle = String(proc.overrides?.previous_activity_title || '');
    const prevOverrideTitlesArr: string[] = Array.isArray(proc.overrides?.previous_activity_titles)
      ? proc.overrides.previous_activity_titles
      : [];
    const newTitle = spec.activity;
    const oldDesc = String(proc.description || '');
    const newDesc = spec.description !== undefined ? spec.description : oldDesc;
    const oldFreq = String(proc.frequency || 'Diario');
    const newFreq = spec.frequency !== undefined ? spec.frequency : oldFreq;

    const allHistoricalTitles = Array.from(
      new Set(
        [prevOverrideTitle, ...prevOverrideTitlesArr, oldTitle]
          .map((s) => String(s || '').trim())
          .filter((s) => s && s !== newTitle)
      )
    );

    for (const candidate of [
      oldTitle,
      oldTitle.trim(),
      prevOverrideTitle,
      prevOverrideTitle.trim(),
      ...allHistoricalTitles,
      newTitle,
    ]) {
      if (candidate) {
        oldToNewTitleMap.set(candidate, newTitle);
        normalizedToNewTitleMap.set(normalizePhrase(candidate), newTitle);
      }
    }

    const currentOverrides =
      proc.overrides && typeof proc.overrides === 'object' ? { ...proc.overrides } : {};
    if (allHistoricalTitles.length > 0) {
      currentOverrides.previous_activity_title = allHistoricalTitles[0];
      currentOverrides.previous_activity_titles = allHistoricalTitles;
    }

    if (
      oldTitle !== newTitle ||
      oldDesc !== newDesc ||
      oldFreq !== newFreq ||
      JSON.stringify(proc.overrides?.previous_activity_titles || []) !==
        JSON.stringify(currentOverrides.previous_activity_titles || [])
    ) {
      procUpdateJobs.push({
        id: proc.id,
        activity: newTitle,
        description: newDesc,
        frequency: newFreq,
        overrides: currentOverrides,
      });
    }
  }

  let updatedProcsCount = 0;
  const procBatchSize = 25;
  for (let i = 0; i < procUpdateJobs.length; i += procBatchSize) {
    const chunk = procUpdateJobs.slice(i, i + procBatchSize);
    await Promise.all(
      chunk.map(async (job) => {
        const { error: updErr } = await supabase
          .from('operating_procedures')
          .update({
            activity: job.activity,
            description: job.description,
            frequency: job.frequency,
            overrides: job.overrides,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        if (updErr) {
          console.error(`❌ Error actualizando ${job.id}:`, updErr);
          process.exit(1);
        }
        updatedProcsCount++;
      })
    );
  }

  console.log(`✅ operating_procedures actualizados: ${updatedProcsCount} de ${currentProcs.length} filas.`);

  // 2. Sincronizar snapshots de texto en station_assignments.tasks (paginando de 1000 en 1000)
  const allAssignmentsWithTasks: Array<{ id: any; tasks: string[] }> = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error: assignErr } = await supabase
      .from('station_assignments')
      .select('id, tasks')
      .not('tasks', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (assignErr) {
      console.error('❌ Error leyendo station_assignments:', assignErr);
      break;
    }
    if (!page || page.length === 0) break;
    allAssignmentsWithTasks.push(...(page as any[]));
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  let updatedSnapshots = 0;
  const pendingUpdates: Array<{ id: any; tasks: string[] }> = [];

  for (const row of allAssignmentsWithTasks) {
    if (!Array.isArray(row.tasks) || row.tasks.length === 0) continue;
    let changed = false;
    const newTasks = row.tasks.map((t: string) => {
      const raw = String(t || '');
      const mapped =
        oldToNewTitleMap.get(raw) ||
        oldToNewTitleMap.get(raw.trim()) ||
        normalizedToNewTitleMap.get(normalizePhrase(raw));
      if (mapped && mapped !== raw) {
        changed = true;
        return mapped;
      }
      return raw;
    });
    if (changed) {
      pendingUpdates.push({ id: row.id, tasks: newTasks });
    }
  }

  const batchSize = 25;
  for (let i = 0; i < pendingUpdates.length; i += batchSize) {
    const chunk = pendingUpdates.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (item) => {
        const { error: taskUpdErr } = await supabase
          .from('station_assignments')
          .update({ tasks: item.tasks })
          .eq('id', item.id);
        if (!taskUpdErr) updatedSnapshots++;
      })
    );
  }
  console.log(
    `✅ Snapshots sincronizados en station_assignments.tasks: ${updatedSnapshots} filas actualizadas (de ${allAssignmentsWithTasks.length} filas leídas).`
  );

  console.log('\n🎉 Estandarización de Nombres Cortos y Detalles completada con éxito.');
}

main();
