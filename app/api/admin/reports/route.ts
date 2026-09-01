/**
 * @module api/admin/reports
 * @description Serves monthly activity and development hours HTML reports directly to the web platform for Admin users.
 * @businessRules
 * - Exclusive for authorized internal administration.
 * - Supports months: 'agosto' (Agosto 2026), 'julio' (Julio 2026), 'junio' (Junio 2026).
 * - Serves standalone, self-contained HTML with UTF-8 encoding.
 * @dataFlow
 * - Reads corresponding .html files from project root and returns them as text/html responses.
 * @notes
 * - Replaces legacy PDF generation with live, responsive, interactive HTML rendering.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const month = (searchParams.get('month') || 'septiembre').toLowerCase().trim();

        let filename = 'pendientes_septiembre.html';
        if (month === 'agosto' || month === 'august' || month === '08') {
            filename = 'pendientes_agosto.html';
        } else if (month === 'julio' || month === 'july' || month === '07') {
            filename = 'pendientes_julio.html';
        } else if (month === 'junio' || month === 'june' || month === '06') {
            filename = 'pendientes.html';
        } else {
            filename = 'pendientes_septiembre.html';
        }

        const filePath = path.join(process.cwd(), filename);

        if (!fs.existsSync(filePath)) {
            return new NextResponse(`<html><body><h1>Error: Reporte no encontrado (${filename})</h1></body></html>`, {
                status: 404,
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        const htmlContent = fs.readFileSync(filePath, 'utf-8');

        return new NextResponse(htmlContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0'
            }
        });
    } catch (error: any) {
        console.error('[API /api/admin/reports] Error serving report:', error);
        return new NextResponse(`<html><body><h1>Error al cargar el reporte: ${error.message}</h1></body></html>`, {
            status: 500,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
}
