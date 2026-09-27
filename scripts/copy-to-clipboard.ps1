[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$content = [System.IO.File]::ReadAllText("$PSScriptRoot/email-draft-grubhub.txt", [System.Text.Encoding]::UTF8)
Set-Clipboard -Value $content
Write-Host "COPIED_SUCCESSFULLY"
