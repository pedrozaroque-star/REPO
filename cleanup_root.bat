@echo off
echo Starting Root Directory Cleanup...

:: 1. Create Directories
echo Creating directories...
if not exist "db\scripts" mkdir "db\scripts"
if not exist "scripts" mkdir "scripts"
if not exist "data\csv" mkdir "data\csv"
if not exist "data\archive" mkdir "data\archive"
if not exist "data\logs" mkdir "data\logs"

:: 2. Move SQL Files
echo Moving SQL files to db\scripts...
move *.sql db\scripts\ >nul 2>&1

:: 3. Move Python Scripts
echo Moving Python scripts to scripts...
move *.py scripts\ >nul 2>&1

:: 4. Move CSV Files
echo Moving CSV files to data\csv...
move *.csv data\csv\ >nul 2>&1

:: 5. Move Archive Files (Zip, Video)
echo Moving archives to data\archive...
move *.zip data\archive\ >nul 2>&1
move *.mp4 data\archive\ >nul 2>&1

:: 6. Move JS Maintenance Scripts
:: CAREFUL: Do not move config files like next.config.js (though we see next.config.ts in the list)
echo Moving JS maintenance scripts to scripts...
move debug_*.js scripts\ >nul 2>&1
move fix_*.js scripts\ >nul 2>&1
move analyze_*.js scripts\ >nul 2>&1
move deep_diag.js scripts\ >nul 2>&1
move diag_*.js scripts\ >nul 2>&1
move dump_*.js scripts\ >nul 2>&1
move fetch_*.js scripts\ >nul 2>&1
move read_*.js scripts\ >nul 2>&1
move simple_*.js scripts\ >nul 2>&1
move verify_*.js scripts\ >nul 2>&1

:: 7. Move Text Logs
echo Moving logs to data\logs...
move output.txt data\logs\ >nul 2>&1
move output_log.txt data\logs\ >nul 2>&1
move cache.txt data\logs\ >nul 2>&1

echo Cleanup Complete!
echo Please check the folders db\, scripts\, and data\ to verify.
pause
