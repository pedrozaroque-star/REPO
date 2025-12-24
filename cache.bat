@echo off
echo ========================================
echo LIMPIEZA COMPLETA DE CACHE
echo ========================================
echo.

echo [1/4] Deteniendo servidor Next.js...
taskkill /F /IM node.exe 2>nul
timeout /t 2 >nul

echo [2/4] Eliminando carpeta .next...
if exist .next (
    rmdir /s /q .next
    echo     - .next eliminada
) else (
    echo     - .next no existe
)

echo [3/4] Eliminando node_modules/.cache...
if exist node_modules\.cache (
    rmdir /s /q node_modules\.cache
    echo     - node_modules\.cache eliminada
) else (
    echo     - node_modules\.cache no existe
)

echo [4/4] Iniciando servidor...
echo.
echo ========================================
echo CACHE LIMPIADO
echo ========================================
echo.
echo AHORA:
echo 1. Abre Chrome/Edge en modo incognito (Ctrl+Shift+N)
echo 2. Ve a http://localhost:3000/checklists
echo 3. La fecha deberia mostrar 23/12/2025
echo.
echo Iniciando servidor...
echo.

npm run dev