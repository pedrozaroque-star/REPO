/**
 * @module ReunionPage
 * @description Presentación ejecutiva de Homologación de Procedimientos y Ecosistema Digital de Tacos Gavilan
 *   para Supervisores y Gerentes de Sucursal.
 * @businessRules
 *   - Nombre oficial de la marca: Tacos Gavilan (sin tilde)
 *   - 2 Modelos de Tienda: Modelo A (Regular, 9 tiendas) y Modelo B (Con Drive-Thru, 6 tiendas)
 *   - Fases 1, 2 y 3 activas en toda la cadena (Manual Digital, Checklist Operativo con Estación/Responsable, Reportes y Patrones de Omisión)
 * @dataFlow
 *   - Página informativa estática de alineación corporativa y estado real de módulos en producción.
 * @notes
 *   - Actualizado para reflejar las 5 Tabletas Operativas + Pantalla TV Order Ready, Caja Fuerte, Uniformes,
 *     Orden Automática Bodega/QuickBooks & Viele & Sons, Basecamp y Fases 1-3 activas.
 */
export default function ReunionPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)',
      color: '#1e293b',
    }}>
      {/* ═══ HERO HEADER ═══ */}
      <header style={{
        background: 'linear-gradient(135deg, #ea580c 0%, #dc2626 50%, #b91c1c 100%)',
        padding: '2.5rem 1.5rem 2rem',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-50%', right: '-20%',
          width: '300px', height: '300px',
          background: 'rgba(255,255,255,0.08)', borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', bottom: '-30%', left: '-10%',
          width: '200px', height: '200px',
          background: 'rgba(255,255,255,0.05)', borderRadius: '50%',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>🏢</div>
          <h1 style={{
            fontSize: '1.75rem', fontWeight: 900, color: 'white',
            margin: '0 0 0.25rem', lineHeight: 1.2,
          }}>
            Reunión de Supervisores
          </h1>
          <p style={{
            fontSize: '0.875rem', color: 'rgba(255,255,255,0.85)',
            margin: 0, fontWeight: 500,
          }}>
            Tacos Gavilan — Despliegue Corporativo (15 Sucursales)
          </p>
          <div style={{
            marginTop: '1rem',
            display: 'inline-block',
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(10px)',
            padding: '0.5rem 1.25rem',
            borderRadius: '2rem',
            fontSize: '0.8rem',
            fontWeight: 600,
            color: 'white',
            border: '1px solid rgba(255,255,255,0.2)',
          }}>
            📋 Homologación de Procedimientos
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
        
        {/* ═══ OBJETIVO ═══ */}
        <section style={{
          background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid #a7f3d0',
          boxShadow: '0 4px 20px rgba(5,150,105,0.08)',
        }}>
          <h2 style={{
            fontSize: '1.1rem', fontWeight: 800, color: '#047857',
            margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            🎯 Objetivo Principal
          </h2>
          <p style={{
            fontSize: '1.05rem', fontWeight: 700, color: '#064e3b',
            margin: 0, lineHeight: 1.5,
          }}>
            Que TODAS las tiendas de Tacos Gavilan operen bajo los MISMOS procedimientos, con las MISMAS actividades, en los MISMOS horarios, con el MISMO nivel de calidad.
          </p>
        </section>

        {/* ═══ EL PROBLEMA ═══ */}
        <section style={{
          background: 'white',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{
            fontSize: '1.1rem', fontWeight: 800, color: '#d97706',
            margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            ⚠️ ¿Cuál es el problema?
          </h2>
          <p style={{
            fontSize: '0.95rem', color: '#475569', margin: '0 0 1rem', lineHeight: 1.6,
          }}>
            Cada tienda ha ido desarrollando sus propias costumbres. Lo que se hace en una tienda a las 8:00 AM, en otra se hace a las 10:00 AM — o peor, <strong style={{ color: '#dc2626' }}>no se hace</strong>.
          </p>

          {[
            { icon: '❌', text: 'Cada tienda tiene sus propias rutinas — no hay consistencia para el cliente' },
            { icon: '❌', text: 'Cuando un empleado cambia de tienda, tiene que "reaprender" todo' },
            { icon: '❌', text: 'No hay un documento oficial de "qué se debe hacer"' },
            { icon: '❌', text: 'Si alguien se va, se lleva el conocimiento con él' },
            { icon: '❌', text: 'No hay forma de verificar que se cumplan los procedimientos' },
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
              padding: '0.6rem 0',
              borderBottom: i < 4 ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '2px' }}>{item.icon}</span>
              <span style={{ fontSize: '0.9rem', color: '#64748b', lineHeight: 1.5 }}>{item.text}</span>
            </div>
          ))}
        </section>

        {/* ═══ META ═══ */}
        <div style={{
          background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
          borderRadius: '1.25rem',
          padding: '1.25rem 1.5rem',
          marginBottom: '1.5rem',
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(59,130,246,0.2)',
        }}>
          <p style={{
            fontSize: '1rem', fontWeight: 700, color: 'white',
            margin: 0, lineHeight: 1.5,
          }}>
            💡 Un empleado que entra a <u>cualquier</u> tienda de Tacos Gavilan debe saber exactamente qué hacer, a qué hora, y cómo hacerlo — porque es <strong>IGUAL en todas</strong>.
          </p>
        </div>

        {/* ═══ LA SOLUCIÓN ═══ */}
        <section style={{
          background: 'white',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{
            fontSize: '1.1rem', fontWeight: 800, color: '#059669',
            margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            ✅ La Solución
          </h2>
          <p style={{
            fontSize: '0.95rem', color: '#475569', margin: '0 0 1.25rem', lineHeight: 1.6,
          }}>
            Un <strong style={{ color: '#0f172a' }}>Manual de Operaciones Digital y Centralizado</strong> donde existe UNA SOLA lista maestra de actividades para TODAS las tiendas.
          </p>

          {[
            {
              icon: '📖', title: 'Un solo Manual para toda la corporación',
              desc: 'Todas las actividades de apertura, operación y cierre documentadas en un solo lugar. Se agrega una vez y existe para TODAS las tiendas.',
              color: '#f97316',
            },
            {
              icon: '🔄', title: 'Cambios en un solo lugar = cambios en todas las tiendas',
              desc: 'Si se agrega, edita o elimina una actividad, se refleja automáticamente en todas las tiendas. No hay que actualizar cada una por separado.',
              color: '#3b82f6',
            },
            {
              icon: '📅', title: 'Filtros por turno y por día',
              desc: 'Cada turno ve solo lo que le corresponde. Si hay tareas que solo se hacen ciertos días (ej: Viernes), se filtran con un botón.',
              color: '#8b5cf6',
            },
            {
              icon: '🟣', title: 'Actividades especiales resaltadas',
              desc: 'Las tareas que NO son diarias se destacan en color púrpura para identificarlas de un vistazo. "Hoy es viernes, hay 3 tareas extras."',
              color: '#a855f7',
            },
            {
              icon: '↕️', title: 'Orden personalizable',
              desc: 'Si varias actividades caen a la misma hora, se pueden arrastrar para definir la prioridad de cuál se hace primero.',
              color: '#06b6d4',
            },
          ].map((item, i) => (
            <div key={i} style={{
              background: '#f8fafc',
              borderRadius: '1rem',
              padding: '1rem 1.25rem',
              marginBottom: i < 4 ? '0.75rem' : 0,
              borderLeft: `4px solid ${item.color}`,
            }}>
              <h3 style={{
                fontSize: '0.95rem', fontWeight: 700, color: '#0f172a',
                margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
              }}>
                <span>{item.icon}</span> {item.title}
              </h3>
              <p style={{
                fontSize: '0.85rem', color: '#64748b', margin: 0, lineHeight: 1.5,
              }}>
                {item.desc}
              </p>
            </div>
          ))}
        </section>

        {/* ═══ 2 MODELOS DE TIENDA ═══ */}
        <section style={{
          background: 'white',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{
            fontSize: '1.1rem', fontWeight: 800, color: '#0369a1',
            margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            🏪 2 Modelos de Tienda
          </h2>
          <p style={{
            fontSize: '0.9rem', color: '#475569', margin: '0 0 1.25rem', lineHeight: 1.6,
          }}>
            No todas las tiendas son iguales. Reconocemos que existen <strong style={{ color: '#0f172a' }}>2 modelos de operación</strong> y el sistema está preparado para manejar ambos:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Modelo Regular */}
            <div style={{
              background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
              borderRadius: '1rem',
              padding: '1.25rem',
              border: '1px solid #bbf7d0',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: '0.75rem', right: '0.75rem',
                background: '#16a34a', color: 'white',
                fontSize: '0.65rem', fontWeight: 800,
                padding: '0.2rem 0.6rem', borderRadius: '1rem',
              }}>
                MODELO A
              </div>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🏠</div>
              <h3 style={{
                fontSize: '1.05rem', fontWeight: 800, color: '#15803d', margin: '0 0 0.35rem',
              }}>
                Regular
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>
                Tienda estándar con comedor, cocina y línea de producción. El modelo base que aplica a la mayoría de sucursales.
              </p>
            </div>

            {/* Modelo DriveThru */}
            <div style={{
              background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
              borderRadius: '1rem',
              padding: '1.25rem',
              border: '1px solid #93c5fd',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: '0.75rem', right: '0.75rem',
                background: '#2563eb', color: 'white',
                fontSize: '0.65rem', fontWeight: 800,
                padding: '0.2rem 0.6rem', borderRadius: '1rem',
              }}>
                MODELO B
              </div>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🚗</div>
              <h3 style={{
                fontSize: '1.05rem', fontWeight: 800, color: '#1d4ed8', margin: '0 0 0.35rem',
              }}>
                Con Drive-Thru
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>
                Incluye todas las actividades del modelo Regular + actividades específicas del Drive-Thru (ventanilla, pantallas de pedido, flujo vehicular, etc.).
              </p>
            </div>
          </div>

          <p style={{
            fontSize: '0.85rem', color: '#64748b', margin: '1rem 0 0', lineHeight: 1.5,
            fontStyle: 'italic',
          }}>
            Cada actividad en el sistema está marcada como: <strong style={{ color: '#16a34a' }}>Regular</strong>, <strong style={{ color: '#2563eb' }}>Drive-Thru</strong>, o <strong style={{ color: '#475569' }}>Ambos</strong>. Así cada tienda solo ve lo que le corresponde.
          </p>
        </section>

        {/* ═══ CRECIMIENTO ═══ */}
        <div style={{
          background: 'linear-gradient(135deg, #7c3aed 0%, #9333ea 50%, #a855f7 100%)',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(124,58,237,0.2)',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🚀</div>
          <h3 style={{
            fontSize: '1.1rem', fontWeight: 800, color: 'white', margin: '0 0 0.5rem',
          }}>
            Esto es para crecer
          </h3>
          <p style={{
            fontSize: '0.95rem', color: 'rgba(255,255,255,0.9)', margin: 0, lineHeight: 1.6,
          }}>
            Al tener procedimientos estandarizados y dos modelos definidos, podemos <strong style={{ color: 'white' }}>abrir nuevas sucursales</strong> con la confianza de que operarán al mismo nivel de calidad desde el día 1. <br /><br />
            Una tienda nueva no tiene que &ldquo;inventar&rdquo; cómo hacer las cosas — simplemente sigue el Manual y funciona.
          </p>
        </div>
        {/* ═══ ECOSISTEMA DIGITAL (con módulos concluidos incluidos) ═══ */}
        <section style={{
          background: 'white',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{
            fontSize: '1.1rem', fontWeight: 800, color: '#0f172a',
            margin: '0 0 0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            🌐 Ecosistema Digital Tacos Gavilan
          </h2>
          <p style={{
            fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem', lineHeight: 1.5,
          }}>
            El Manual de Operaciones es solo una pieza de un ecosistema completo que se está construyendo para profesionalizar y escalar la empresa. Todos los módulos clave de operación <strong style={{ color: '#16a34a' }}>ya están concluidos y en producción</strong>:
          </p>

          {/* ── MÓDULOS CONCLUIDOS ── */}
          <div style={{
            background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
            borderRadius: '0.75rem',
            padding: '0.5rem 0.75rem',
            marginBottom: '0.75rem',
            border: '1px solid #bbf7d0',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <span style={{ fontSize: '0.85rem' }}>🏁</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#16a34a' }}>MÓDULOS CONCLUIDOS — Ya en operación</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {[
              {
                emoji: '🧠',
                title: 'Descansos AI (Breaks & Lunches)',
                desc: 'Asignación automática de descansos y comidas basada en inteligencia artificial. Analiza el volumen de ventas por hora y distribuye los breaks respetando las leyes laborales de California, maximizando la cobertura en horas pico.',
                color: '#16a34a',
                bgColor: '#fffbeb',
                borderColor: '#fde68a',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '🎭',
                title: 'Roles y Posiciones (Tablero Operativo)',
                desc: 'Gestión centralizada de estaciones por tienda (Salón, Cocina y Drive-Thru). Define quién hace qué con herencia automática de las 140 actividades del catálogo y modo Tablero a pantalla completa.',
                color: '#16a34a',
                bgColor: '#faf5ff',
                borderColor: '#ddd6fe',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '🥩',
                title: 'Preparador de Parrilla y Bodega',
                desc: 'Proyección en tiempo real de libras de carne en parrilla por bloques de 30 minutos y preparación en bodega (salsas, frijol, arroz) con acelerador intraday conectado a Toast.',
                color: '#16a34a',
                bgColor: '#fef2f2',
                borderColor: '#fecaca',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '🛡️',
                title: 'Blindaje Delivery & Pantalla Order Ready',
                desc: 'Estación de empaque con verificación fotográfica IA para órdenes de Uber Eats / DoorDash y pantalla de TV en comedor para avisar a clientes y repartidores cuando su pedido está listo.',
                color: '#16a34a',
                bgColor: '#fff7ed',
                borderColor: '#fed7aa',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '📋',
                title: 'Checklist de Asistentes de Manager',
                desc: 'Lista de verificación digital para los asistentes. Cada turno tiene sus tareas obligatorias que deben completarse y registrarse. Se sabe quién hizo qué y a qué hora.',
                color: '#16a34a',
                bgColor: '#eff6ff',
                borderColor: '#bfdbfe',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '👔',
                title: 'Checklist de Managers',
                desc: 'El gerente de tienda tiene su propio checklist con responsabilidades administrativas, de supervisión y seguimiento. Todo documentado digitalmente.',
                color: '#16a34a',
                bgColor: '#f0f9ff',
                borderColor: '#bae6fd',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '🔍',
                title: 'Inspecciones de Supervisores',
                desc: 'Los propios supervisores cuentan con formularios de inspección digital para evaluar la operación de cada tienda: limpieza, presentación, cumplimiento de procedimientos y calidad del servicio.',
                color: '#16a34a',
                bgColor: '#ecfdf5',
                borderColor: '#a7f3d0',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '📦',
                title: 'Orden Automática de Productos (Bodega & Viele & Sons)',
                desc: 'Sistema inteligente de pedidos diarios a La Bodega (sincronizado con QuickBooks) y a Viele & Sons basado en consumo real, PAR ideal y conteo físico de sobrantes.',
                color: '#16a34a',
                bgColor: '#fffbeb',
                borderColor: '#fde68a',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '🔐',
                title: 'Control de Caja Fuerte',
                desc: 'Registro y seguimiento digital de movimientos de efectivo y denominaciones con calculadora integrada, historial de capturas, auditoría por turno y alertas de diferencias.',
                color: '#16a34a',
                bgColor: '#f0f9ff',
                borderColor: '#bae6fd',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '👕',
                title: 'Control de Uniformes',
                desc: 'Registro digital de uniformes entregados a cada empleado: tallas, cantidad, inventario en tienda y solicitudes de reposición.',
                color: '#16a34a',
                bgColor: '#faf5ff',
                borderColor: '#ddd6fe',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '🎬',
                title: 'Basecamp: Videos de Entrenamiento y Certificación',
                desc: 'Centro de capacitación digital con videos paso a paso, manuales interactivos y seguimiento de progreso para certificar al personal.',
                color: '#16a34a',
                bgColor: '#fef2f2',
                borderColor: '#fecaca',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
              {
                emoji: '🌍',
                title: 'Nueva Página Web Oficial',
                desc: 'Portal web moderno de Tacos Gavilan con menú interactivo, localizador de las 15 sucursales, historia de la marca, catering y empleos.',
                color: '#16a34a',
                bgColor: '#ecfdf5',
                borderColor: '#a7f3d0',
                status: '✅ Concluido',
                statusColor: '#16a34a',
                statusBg: '#f0fdf4',
                statusBorder: '#bbf7d0',
              },
            ].map((item, i) => (
              <div key={`done-${i}`} style={{
                background: item.bgColor,
                borderRadius: '1rem',
                padding: '1rem 1.25rem',
                border: `1px solid ${item.borderColor}`,
                display: 'flex', gap: '1rem', alignItems: 'flex-start',
              }}>
                <div style={{
                  fontSize: '1.75rem', flexShrink: 0, marginTop: '2px',
                  width: '2.75rem', height: '2.75rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'white',
                  borderRadius: '0.75rem',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  border: `1px solid ${item.borderColor}`,
                }}>
                  {item.emoji}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                    <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{item.title}</strong>
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 700, color: item.statusColor,
                      background: item.statusBg,
                      padding: '0.15rem 0.5rem', borderRadius: '1rem',
                      border: `1px solid ${item.statusBorder}`,
                      whiteSpace: 'nowrap',
                    }}>
                      {item.status}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* 5 Tabletas Operativas + Pantalla Order Ready */}
          <div style={{
            marginTop: '1rem',
            background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
            borderRadius: '1rem',
            padding: '1.25rem',
            border: '1px solid #93c5fd',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📱</div>
            <h3 style={{
              fontSize: '1rem', fontWeight: 800, color: '#1d4ed8', margin: '0 0 0.5rem',
            }}>
              5 Tabletas Operativas + Pantalla TV Order Ready
            </h3>
            <p style={{
              fontSize: '0.85rem', color: '#475569', margin: 0, lineHeight: 1.6,
            }}>
              Ecosistema de <strong style={{ color: '#1d4ed8' }}>5 tabletas operativas en tienda</strong> con protocolo inteligente 24/7 (Wake Lock y ahorro de energía automático):
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem', textAlign: 'left' }}>
              {[
                { qty: '1', label: 'Preparador de Parrilla (Carnes)', desc: 'Proyección de libras crudas cada 30 min para Asada, Pastor, Pollo, Cabeza y Lengua', icon: '🔥' },
                { qty: '1', label: 'Preparador de Bodega', desc: 'Control de lotes de salsas, frijol, arroz y aguas frescas en tiempo real', icon: '🥩' },
                { qty: '1', label: 'Tablero de Roles y Checklist', desc: 'Mapa visual de estaciones por turno y checklist interactivo de actividades', icon: '🎭' },
                { qty: '1', label: 'Breaks & Lunches AI', desc: 'Descansos inteligentes optimizados por volumen de ventas y ley laboral CA', icon: '🧠' },
                { qty: '1', label: 'Blindaje Delivery (Empaque IA)', desc: 'Verificación fotográfica de pedidos de delivery + Pantalla TV Order Ready', icon: '🛡️' },
              ].map((t, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  background: 'white', borderRadius: '0.75rem', padding: '0.6rem 1rem',
                  border: '1px solid #bfdbfe',
                }}>
                  <span style={{ fontSize: '1.25rem' }}>{t.icon}</span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>{t.qty}x {t.label}</strong>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{t.desc}</span>
                  </div>
                </div>
              ))}
            </div>
            <p style={{
              fontSize: '0.8rem', color: '#475569', margin: '0.75rem 0 0', lineHeight: 1.5, textAlign: 'center',
              fontStyle: 'italic',
            }}>
              Sin papeles, sin hojas de Excel, sin WhatsApp — <strong style={{ color: '#0f172a' }}>todo digitalizado en un solo sistema</strong>.
            </p>
          </div>

          {/* ── SEPARADOR ── */}
          <div style={{
            marginTop: '1.25rem',
            marginBottom: '0.75rem',
            background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
            borderRadius: '0.75rem',
            padding: '0.5rem 0.75rem',
            border: '1px solid #fde68a',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <span style={{ fontSize: '0.85rem' }}>🚧</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#d97706' }}>PRÓXIMOS LANZAMIENTOS CORPORATIVOS</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {[
              {
                emoji: '📱',
                title: 'App Tacos Gavilan (Android & iPhone)',
                desc: 'Aplicación propia para los clientes. Podrán ver el menú, hacer pedidos, ordenar para recoger o a domicilio, y recibir promociones exclusivas desde su celular.',
                color: '#2563eb',
                bgColor: '#eff6ff',
                borderColor: '#bfdbfe',
                status: 'En Desarrollo',
              },
              {
                emoji: '🏛️',
                title: 'Cultura Empresarial',
                desc: 'Sección dedicada a los objetivos, metas, visión y misión de Tacos Gavilan. Para que todo el equipo sepa hacia dónde vamos y por qué hacemos lo que hacemos.',
                color: '#b45309',
                bgColor: '#fffbeb',
                borderColor: '#fde68a',
                status: 'En Desarrollo',
              },
              {
                emoji: '🎵',
                title: 'Actualización de Videos Musicales',
                desc: 'Basado en un estudio demográfico, la mayoría de nuestra clientela en California tiene entre 22 y 29 años. Se están actualizando los videos musicales de las tiendas para conectar con esta audiencia, respetando el género regional mexicano con una mezcla más fresca y variada.',
                color: '#e11d48',
                bgColor: '#fff1f2',
                borderColor: '#fecdd3',
                status: 'En Producción',
              },
            ].map((item, i) => (
              <div key={`dev-${i}`} style={{
                background: item.bgColor,
                borderRadius: '1rem',
                padding: '1rem 1.25rem',
                border: `1px solid ${item.borderColor}`,
                display: 'flex', gap: '1rem', alignItems: 'flex-start',
              }}>
                <div style={{
                  fontSize: '1.75rem', flexShrink: 0, marginTop: '2px',
                  width: '2.75rem', height: '2.75rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'white',
                  borderRadius: '0.75rem',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  border: `1px solid ${item.borderColor}`,
                }}>
                  {item.emoji}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                    <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{item.title}</strong>
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 700, color: item.color,
                      background: `${item.color}12`,
                      padding: '0.15rem 0.5rem', borderRadius: '1rem',
                      border: `1px solid ${item.color}25`,
                      whiteSpace: 'nowrap',
                    }}>
                      {item.status}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Visión */}
          <div style={{
            marginTop: '1.25rem',
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
            borderRadius: '0.75rem',
            padding: '1rem',
            textAlign: 'center',
            border: '1px solid #e2e8f0',
          }}>
            <p style={{
              fontSize: '0.85rem', color: '#475569', margin: 0, lineHeight: 1.5,
              fontWeight: 600,
            }}>
              🎯 La visión: <strong style={{ color: '#0f172a' }}>UN solo sistema</strong> donde el Asistente hace su checklist, el Manager supervisa el suyo, el Supervisor inspecciona, y la corporación ve todo en tiempo real — desde cualquier dispositivo.
            </p>
          </div>
        </section>

        {/* ═══ ROL DEL SUPERVISOR ═══ */}
        <section style={{
          background: 'linear-gradient(135deg, #fff7ed 0%, white 100%)',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid #fed7aa',
          boxShadow: '0 2px 12px rgba(234,88,12,0.06)',
        }}>
          <h2 style={{
            fontSize: '1.1rem', fontWeight: 800, color: '#ea580c',
            margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            👤 Rol del Supervisor
          </h2>
          <p style={{
            fontSize: '0.9rem', color: '#475569', margin: '0 0 1rem', lineHeight: 1.5,
          }}>
            Los supervisores son la <strong style={{ color: '#0f172a' }}>pieza clave</strong> para que esto funcione:
          </p>

          {[
            { emoji: '✅', title: 'Validar el manual', desc: 'Revisar que TODAS las actividades reales estén capturadas' },
            { emoji: '📝', title: 'Reportar lo que falta', desc: 'Si algo no está en el sistema, se reporta para agregarlo' },
            { emoji: '🔍', title: 'Verificar cumplimiento', desc: 'Usar el sistema como checklist diario' },
            { emoji: '🎓', title: 'Capacitar al equipo', desc: 'Enseñar a consultar el manual digital, no depender de memoria' },
            { emoji: '⚖️', title: 'Mantener consistencia', desc: 'Si alguien hace algo diferente al manual, corregirlo' },
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', gap: '0.75rem',
              padding: '0.75rem 0',
              borderBottom: i < 4 ? '1px solid #fde68a40' : 'none',
            }}>
              <span style={{
                fontSize: '1.25rem', flexShrink: 0,
                width: '2.5rem', height: '2.5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#fff7ed',
                borderRadius: '0.75rem',
                border: '1px solid #fed7aa',
              }}>
                {item.emoji}
              </span>
              <div>
                <strong style={{ fontSize: '0.9rem', color: '#0f172a', display: 'block', marginBottom: '2px' }}>{item.title}</strong>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{item.desc}</span>
              </div>
            </div>
          ))}
        </section>

        {/* ═══ ROADMAP / FASES ═══ */}
        <section style={{
          background: 'white',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          <h2 style={{
            fontSize: '1.1rem', fontWeight: 800, color: '#7c3aed',
            margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            🗺️ Visión a Futuro
          </h2>

          {[
            {
              phase: 'FASE 1', status: '✅ ACTIVO EN LAS 15 TIENDAS', color: '#16a34a', bgColor: '#f0fdf4',
              borderColor: '#bbf7d0',
              items: [
                '✅ Manual de Operaciones centralizado (140 actividades homologadas)',
                '✅ Actividades estandarizadas por modelo (Regular y Con Drive-Thru)',
                '✅ Filtros por turno (AM / PM) y día de la semana',
                '✅ Identificación visual en púrpura de tareas especiales (Lunes, Miércoles, Fin de mes)',
              ]
            },
            {
              phase: 'FASE 2', status: '✅ ACTIVO EN LAS 15 TIENDAS', color: '#16a34a', bgColor: '#f0fdf4',
              borderColor: '#bbf7d0',
              items: [
                '✅ Checklist digital interactivo vinculado a Estación y Responsable del turno',
                '✅ Registro en tiempo real de quién completó qué y a qué hora',
                '✅ Alertas visuales automáticas si una actividad supera +30 min sin marcarse',
              ]
            },
            {
              phase: 'FASE 3', status: '✅ ACTIVO EN LAS 15 TIENDAS', color: '#16a34a', bgColor: '#f0fdf4',
              borderColor: '#bbf7d0',
              items: [
                '✅ Reportes de cumplimiento diario y semanal por tienda y por turno',
                '✅ Ranking comparativo de tiendas por nivel de cumplimiento',
                '✅ Detección automática de patrones de actividades omitidas',
              ]
            },
          ].map((phase, i) => (
            <div key={i} style={{
              background: phase.bgColor,
              borderRadius: '1rem',
              padding: '1rem 1.25rem',
              marginBottom: i < 2 ? '0.75rem' : 0,
              border: `1px solid ${phase.borderColor}`,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem',
              }}>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 800, color: phase.color,
                  background: `${phase.color}15`,
                  padding: '0.2rem 0.6rem', borderRadius: '1rem',
                  border: `1px solid ${phase.color}30`,
                }}>
                  {phase.phase}
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: phase.color }}>
                  {phase.status}
                </span>
              </div>
              {phase.items.map((item, j) => (
                <div key={j} style={{
                  fontSize: '0.85rem', color: '#475569', padding: '0.2rem 0', lineHeight: 1.5,
                }}>
                  {item}
                </div>
              ))}
            </div>
          ))}
        </section>

        {/* ═══ ACCIÓN INMEDIATA ═══ */}
        <section style={{
          background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          boxShadow: '0 8px 32px rgba(220,38,38,0.15)',
        }}>
          <h2 style={{
            fontSize: '1.1rem', fontWeight: 800, color: '#fecaca',
            margin: '0 0 0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            ⚡ Acción Inmediata
          </h2>
          <p style={{
            fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', margin: '0 0 1rem',
          }}>
            Lo que necesitamos de ustedes <strong style={{ color: 'white' }}>HOY</strong>:
          </p>

          {[
            'Revisar la lista de actividades actual y confirmar si falta algo',
            'Validar los horarios — ¿La hora asignada a cada actividad es correcta?',
            'Identificar actividades de días específicos que estén marcadas como "Diario"',
            'Reportar diferencias entre tiendas — ¿Algo que una hace y otra no?',
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
              padding: '0.6rem 0',
              borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.1)' : 'none',
            }}>
              <span style={{
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                fontWeight: 800,
                fontSize: '0.75rem',
                width: '1.5rem', height: '1.5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
                flexShrink: 0,
                marginTop: '2px',
              }}>
                {i + 1}
              </span>
              <span style={{ fontSize: '0.9rem', color: 'white', lineHeight: 1.5 }}>{item}</span>
            </div>
          ))}
        </section>

        {/* ═══ CIERRE ═══ */}
        <div style={{
          textAlign: 'center',
          padding: '1.5rem',
          marginBottom: '1rem',
        }}>
          <div style={{
            background: 'white',
            borderRadius: '1.25rem',
            padding: '1.5rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          }}>
            <p style={{
              fontSize: '1rem', fontWeight: 700, color: '#d97706',
              margin: '0 0 0.5rem', lineHeight: 1.5,
            }}>
              🌮 La meta es simple
            </p>
            <p style={{
              fontSize: '0.95rem', color: '#334155',
              margin: '0 0 1rem', lineHeight: 1.6,
            }}>
              Un cliente debe recibir la <strong style={{ color: '#0f172a' }}>misma experiencia</strong> en cualquier Tacos Gavilan, sin importar cuál visite.
            </p>
            <p style={{
              fontSize: '0.8rem', color: '#94a3b8', margin: 0,
            }}>
              El Manual de Operaciones es el primer paso para lograrlo.
            </p>
          </div>
        </div>

        <footer style={{
          textAlign: 'center',
          padding: '1rem',
          fontSize: '0.75rem',
          color: '#94a3b8',
        }}>
          Sistema SM TEG — Tacos Gavilan © 2026
        </footer>
      </main>
    </div>
  );
}
