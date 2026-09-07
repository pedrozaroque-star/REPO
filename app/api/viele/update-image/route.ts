/**
 * @module api/viele/update-image
 * @description Endpoint para actualizar la imagen de un producto del catálogo Viele & Sons.
 *              Recibe un archivo de imagen vía FormData, lo guarda en public/images/viele/
 *              y actualiza el campo image_file en la tabla viele_items de Supabase.
 *
 * @businessRules
 * - Solo administradores y gerentes pueden actualizar imágenes.
 * - El nombre del archivo se basa en el item_code del producto.
 * - Formatos aceptados: jpg, jpeg, png, webp.
 * - Tamaño máximo: 5 MB.
 *
 * @dataFlow
 * - POST: FormData con { itemCode, file } → guarda en /public/images/viele/{itemCode}.{ext}
 *         → actualiza viele_items.image_file en Supabase.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, serviceKey);

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const itemCode = formData.get('itemCode') as string;
    const file = formData.get('file') as File;

    if (!itemCode || !file) {
      return NextResponse.json(
        { success: false, error: 'itemCode and file are required' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: `Invalid file type: ${file.type}. Allowed: jpg, png, webp` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Max: 5 MB` },
        { status: 400 }
      );
    }

    // Determine file extension from MIME type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    };
    const ext = extMap[file.type] || 'jpg';

    // Sanitize item code for filename (remove special chars)
    const safeCode = itemCode.replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${safeCode}.${ext}`;

    // Write file to public/images/viele/
    const imagesDir = path.join(process.cwd(), 'public', 'images', 'viele');
    await mkdir(imagesDir, { recursive: true });

    const filePath = path.join(imagesDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Update viele_items.image_file in Supabase
    const imageUrl = `/images/viele/${fileName}`;
    const { error: updateError } = await supabase
      .from('viele_items')
      .update({ image_file: imageUrl })
      .eq('item_code', itemCode);

    if (updateError) {
      return NextResponse.json(
        { success: false, error: `DB update failed: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      imageUrl,
      fileName,
      itemCode
    });

  } catch (err: any) {
    console.error('Error uploading image:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
