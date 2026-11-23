/**
 * @module components/sales/FitValue
 * @description Muestra una cifra en una sola línea ajustando su font-size al ancho real de su caja mediante una CSS container query (`cqw`), para que montos largos (ej. `$4,234,567.89`) nunca se salgan de una tarjeta en móvil.
 * @businessRules
 * - Nunca trunca ni envuelve montos financieros; reduce el tamaño de letra de forma proporcional a la longitud del texto hasta `minPx`.
 * - En pantallas amplias se detiene en `maxPx` (sobrescribible por breakpoint con `--fit-max`, ej. `lg:[--fit-max:36px]`).
 * @dataFlow
 * - Props (`text`, `maxPx`, `minPx`, `charEm`, `className`) -> wrapper `container-type: inline-size` -> `<span style={{ fontSize: clamp(...) }}>`.
 * @notes
 * - Creado en la corrección móvil del módulo Ventas para reemplazar tamaños fijos (`text-3xl`) que se desbordaban en tarjetas de 2 columnas.
 * - [2026-11-23] Agregado `overflow-hidden` defensivo y guardia `charEm > 0` para valores extremos.
 */
'use client'

import React from 'react'

interface FitValueProps {
    text: string
    className?: string
    /** Tamaño máximo en px (puede sobrescribirse en Tailwind con `[--fit-max:36px]`) */
    maxPx?: number
    /** Tamaño mínimo en px para mantener legibilidad */
    minPx?: number
    /** Ancho medio de cada carácter en em; ~0.62 cubre dígitos + `$`, `,`, `.`, `%` en sans/mono */
    charEm?: number
}

export default function FitValue({
    text,
    className = '',
    maxPx = 30,
    minPx = 12,
    charEm = 0.62,
}: FitValueProps) {
    const safeCharEm = Number.isFinite(charEm) && charEm > 0 ? charEm : 0.62
    const len = Math.max(text.length, 4)
    const cqw = Number((100 / (len * safeCharEm)).toFixed(2))
    const fontSize = `clamp(${minPx}px, ${cqw}cqw, var(--fit-max, ${maxPx}px))`

    return (
        <span className="block w-full min-w-0 overflow-hidden" style={{ containerType: 'inline-size' }}>
            <span
                className={`block whitespace-nowrap leading-tight ${className}`}
                style={{ fontSize }}
            >
                {text}
            </span>
        </span>
    )
}
