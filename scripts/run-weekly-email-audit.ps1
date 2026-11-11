$ErrorActionPreference = "Stop"
Set-Location "c:\Users\pedro\Desktop\teg-modernizado"
$logPath = "C:\Users\pedro\.gemini\teg-weekly-email-audit.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
Add-Content -Path $logPath -Value "`n=== [$timestamp] Starting TEG Weekly Employee Email Audit ==="
& "c:\Users\pedro\Desktop\teg-modernizado\node_modules\.bin\tsx.cmd" --env-file=.env.local --tsconfig tsconfig.json "c:\Users\pedro\Desktop\teg-modernizado\scripts\run-weekly-email-audit.ts" *>> $logPath
