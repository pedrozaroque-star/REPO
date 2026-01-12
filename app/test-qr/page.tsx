import React from 'react';
import QRCodeGenerator from '@/components/QRCodeGenerator';

export default function TestQRPage() {
    const testValue = "https://www.google.com";

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-6 space-y-8">
            <h1 className="text-3xl font-bold text-gray-800">Prueba de Generación de QR</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="flex flex-col items-center">
                    <h2 className="text-xl font-semibold mb-4 text-gray-700">QR Estándar</h2>
                    <QRCodeGenerator value="https://example.com" />
                </div>

                <div className="flex flex-col items-center">
                    <h2 className="text-xl font-semibold mb-4 text-gray-700">QR Personalizado (Color/Tamaño)</h2>
                    <QRCodeGenerator
                        value={testValue}
                        size={200}
                        fgColor="#4F46E5"
                        level="H"
                    />
                </div>
            </div>

            <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800 max-w-md">
                <p>
                    Si ves los códigos QR arriba, la integración fue exitosa.
                    Escanea para verificar el contenido.
                </p>
            </div>
        </div>
    );
}
