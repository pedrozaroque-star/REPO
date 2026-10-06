/**
 * @module components/sales/FitValue
 * @description Muestra un número/monto en UNA sola línea y ajusta automáticamente su tamaño de letra
 * al ancho real de su caja (CSS container queries, unidad `cqw`) para que NUNCA se salga de su cuadro,
 * sin importar el ancho del teléfono, la orientación (vertical/horizontal) o la cantidad de dígitos.
 * @businessRules
 * - Solo es presentación: no formatea ni altera el valor; recibe el texto ya formateado (ej. "$161,161.47").
 * - Nunca baja de `minPx` (legibilidad) ni sube de `maxPx` (diseño original en pantallas grandes).
 * - El máximo puede sobrescribirse por breakpoint con la variable CSS `--fit-max`
 *   (ej. className="lg:[--fit-max:36px]").
 * @dataFlow
 * - Props (text) -> contenedor `container-type: inline-size` -> font-size: clamp(min, N cqw, max).
 * @notes
 * - Se calcula con CSS puro (sin ResizeObserver) => no causa hydration mismatch ni re-renders.
 * - `charEm` es el ancho promedio de un carácter en "em"; 0.62 deja margen para dígitos anchos y fuentes de respaldo.
 * - Mínimo 5 caracteres de referencia para que textos cortos (ej. "19.9%") no se vean exageradamente grandes.
 * - Requiere navegadores con container queries (Safari 16+, Chrome 105+, Firefox 110+).
 */
'use client'

import React from 'react'

interface FitValueProps {
    /** Texto ya formateado a mostrar (ej. "$12,345.67" o "19.90%"). */
    text: string
    /** Clases extra para el texto (color, peso, tracking, etc.). */
    className?: string
    /** Tamaño máximo en px (por defecto 30). Sobrescribible con la variable CSS `--fit-max`. */
    maxPx?: number
    /** Tamaño mínimo en px (por defecto 12). */
    minPx?: number
    /** Ancho promedio de un carácter en em (por defecto 0.62). */
    charEm?: number
}

export default function FitValue({ text, className = '', maxPx = 30, minPx = 12, charEm = 0.62 }: FitValueProps) {
    const chars = Math.max(String(text ?? '').length, 5)
    const cqw = 100 / (chars * charEm)

    return (
        <div className="w-full min-w-0" style={{ containerType: 'inline-size' }}>
            <span
                className={`block whitespace-nowrap leading-tight ${className}`}
                style={{ fontSize: `clamp(${minPx}px, ${cqw.toFixed(2)}cqw, var(--fit-max, ${maxPx}px))` }}
            >
                {text}
            </span>
        </div>
    )
}
