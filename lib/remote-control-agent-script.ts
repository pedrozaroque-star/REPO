/**
 * @module lib/remote-control-agent-script
 * @description Generador oficial del Agente Windows (`teg-agent.ps1`) y del Instalador de 1 Clic
 *              (`.ps1` y `.cmd` autoelevable) para las PCs de las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * - Cero dependencias externas: corre en PowerShell 5.1+ nativo de Windows 10 y Windows 11 sin requerir Python ni Node.js.
 * - Control real del Volumen Maestro y Mute de Windows mediante COM CoreAudio API (`IAudioEndpointVolume`) compilado en memoria vía C# (`Add-Type`).
 * - Watchdog autónomo (*Self-Healing*):
 *   * Revisa cada 30s que Windows no esté en Mute y cumpla el volumen mínimo configurado.
 *   * Evita suspensión/hibernación/apagado de pantalla (`powercfg`).
 *   * Reabre Chrome/Edge en la ruta configurada (`/order-ready-board`) si el navegador se cerró por accidente.
 * - Blindaje (*Hardening*): aplica política de registro `AutoplayAllowlist` para Chrome y Edge en los dominios oficiales
 *   de Tacos Gavilan para que la bocina AI nunca requiera clic manual tras un apagón o reinicio.
 * - Instalación híbrida de 1 clic: si `action1InstallerUrl` está configurado en SM TEG, descarga e instala
 *   silenciosamente el agente `.msi` de Action1 en el mismo paso junto con `TEG-Remote-Agent`.
 * - Auto-actualización remota (`update_agent`): descarga el script oficial actualizado desde SM TEG sin visitar la tienda.
 *
 * @dataFlow
 * - Admin en `/admin/control-remoto` -> GET `/api/remote-control/installer` -> `.cmd` / `.ps1` específico de la sucursal
 * - PC Windows -> Scheduled Task `TEG-Remote-Agent` -> `POST /api/remote-control/agent/heartbeat` (cada 60s) & `GET /api/remote-control/agent/poll` (cada 15s) & `POST /api/remote-control/agent/ack`.
 */

import {
  REMOTE_AGENT_LATEST_VERSION,
  sanitizePcWatchdogConfig,
  type PcWatchdogConfig,
} from '@/lib/remote-control'

export interface InstallerBuildParams {
  baseUrl: string
  storeCode: string
  storeName: string
  deviceKey: string
  displayName: string
  agentToken: string
  watchdog: PcWatchdogConfig
  action1InstallerUrl?: string | null
}

function escapePsSingleQuoted(val: string): string {
  return val.replace(/'/g, "''")
}

/**
 * Devuelve el código fuente completo del agente residente `teg-agent.ps1` (v1.0.0).
 * También lo sirve `/api/remote-control/agent/script` para auto-actualización remota (`update_agent`).
 */
export function buildWindowsAgentScriptSource(): string {
  return `# ==============================================================================
# Tacos Gavilan - TEG Store Remote Agent v${REMOTE_AGENT_LATEST_VERSION}
# Agente oficial Windows (Watchdog + Control de Volumen Real + Telemetria + Comandos)
# Cero dependencias externas - Compatible con Windows 10 / Windows 11 (PowerShell 5.1+)
# ==============================================================================
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AgentVersion = '${REMOTE_AGENT_LATEST_VERSION}'
$InstallDir   = 'C:\\ProgramData\\TacosGavilan\\RemoteAgent'
$ConfigPath   = Join-Path $InstallDir 'config.json'
$LogPath      = Join-Path $InstallDir 'agent.log'
$ScriptPath   = Join-Path $InstallDir 'teg-agent.ps1'

function Write-TegLog {
    param([string]$Message, [string]$Level = 'INFO')
    try {
        $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        $line = "[$ts] [$Level] $Message"
        Add-Content -Path $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
        if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 2097152)) {
            $tail = Get-Content -Path $LogPath -Tail 400 -ErrorAction SilentlyContinue
            Set-Content -Path $LogPath -Value $tail -Encoding UTF8 -ErrorAction SilentlyContinue
        }
    } catch {}
}

# Evitar instancias duplicadas mediante Mutex global por sesion
$mutexCreated = $false
$agentMutex = New-Object System.Threading.Mutex($true, 'Local\\TEGStoreRemoteAgentMutex', [ref]$mutexCreated)
if (-not $mutexCreated) {
    Write-TegLog 'Otra instancia del agente ya esta corriendo. Saliendo limpiamente.' 'INFO'
    exit 0
}

# Cargar CoreAudio COM API en C# para leer/fijar Volumen Maestro y Mute reales de Windows
$coreAudioCode = @"
using System;
using System.Runtime.InteropServices;

namespace TegAudio {
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out int pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
        int GetMute(out bool pbMute);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject {}

    public static class VolumeController {
        private static IAudioEndpointVolume GetVolumeInterface() {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice speakers;
            enumerator.GetDefaultAudioEndpoint(0, 1, out speakers);
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object o;
            speakers.Activate(ref iid, 23, IntPtr.Zero, out o);
            return (IAudioEndpointVolume)o;
        }

        public static int GetVolumePercent() {
            var vol = GetVolumeInterface();
            float level;
            vol.GetMasterVolumeLevelScalar(out level);
            return (int)Math.Round(level * 100.0f);
        }

        public static bool GetMute() {
            var vol = GetVolumeInterface();
            bool mute;
            vol.GetMute(out mute);
            return mute;
        }

        public static void SetVolumePercent(int pct) {
            if (pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            var vol = GetVolumeInterface();
            vol.SetMasterVolumeLevelScalar(pct / 100.0f, Guid.Empty);
        }

        public static void SetMute(bool mute) {
            var vol = GetVolumeInterface();
            vol.SetMute(mute, Guid.Empty);
        }
    }
}
"@

$audioReady = $false
try {
    if (-not ([System.Management.Automation.PSTypeName]'TegAudio.VolumeController').Type) {
        Add-Type -TypeDefinition $coreAudioCode -Language CSharp -ErrorAction Stop
    }
    $audioReady = $true
} catch {
    Write-TegLog "Advertencia cargando TegAudio COM API: $($_.Exception.Message)" 'WARN'
}

if (-not (Test-Path $ConfigPath)) {
    Write-TegLog "Archivo config.json no encontrado en $ConfigPath. Deteniendo." 'ERROR'
    exit 1
}

function Load-AgentConfig {
    return (Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Save-AgentConfig {
    param($Cfg)
    $json = $Cfg | ConvertTo-Json -Depth 10
    Set-Content -Path $ConfigPath -Value $json -Encoding UTF8
}

$Config = Load-AgentConfig
$Headers = @{
    'Authorization' = "Bearer $($Config.agentToken)"
    'Content-Type'  = 'application/json'
    'User-Agent'    = "TEG-Store-Agent/$AgentVersion"
}

$script:LastAutoHealAt = $null
$script:LastAutoHealAction = $null
$script:HardeningApplied = $false

function Get-BrowserExecutable {
    $candidates = @(
        "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
        "\${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe",
        "$env:LocalAppData\\Google\\Chrome\\Application\\chrome.exe",
        "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe",
        "\${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe"
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) {
            $name = if ($p -match 'chrome\\.exe$') { 'chrome' } else { 'msedge' }
            return @{ Path = $p; Name = $name }
        }
    }
    return $null
}

function Apply-WindowsHardening {
    param([string]$BaseUrl)
    $actions = New-Object System.Collections.Generic.List[string]
    try {
        # 1. Evitar suspension, hibernacion y apagado de pantalla en corriente alterna
        & powercfg /change monitor-timeout-ac 0 | Out-Null
        & powercfg /change standby-timeout-ac 0 | Out-Null
        & powercfg /change hibernate-timeout-ac 0 | Out-Null
        & powercfg /change disk-timeout-ac 0 | Out-Null
        & powercfg /h off 2>$null | Out-Null
        # Desactivar suspension selectiva USB (evita desconexion de bocinas USB)
        & powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 2>$null | Out-Null
        & powercfg /setactive SCHEME_CURRENT 2>$null | Out-Null
        $actions.Add('Politica de energia 24/7 aplicada (sin suspension/hibernacion/USB sleep)')
    } catch {
        $actions.Add("Aviso energia: $($_.Exception.Message)")
    }

    try {
        # 2. Politicas Chrome y Edge: permitir Autoplay de audio en Tacos Gavilan (bocina siempre lista)
        $uri = [System.Uri]$BaseUrl
        $originPattern = "$($uri.Scheme)://$($uri.Host)"
        $policyPaths = @(
            'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome',
            'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge'
        )
        foreach ($regRoot in $policyPaths) {
            if (-not (Test-Path $regRoot)) { New-Item -Path $regRoot -Force | Out-Null }
            Set-ItemProperty -Path $regRoot -Name 'AutoplayAllowed' -Value 1 -Type DWord -Force
            Set-ItemProperty -Path $regRoot -Name 'HighEfficiencyModeEnabled' -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
            $allowList = Join-Path $regRoot 'AutoplayAllowlist'
            if (-not (Test-Path $allowList)) { New-Item -Path $allowList -Force | Out-Null }
            Set-ItemProperty -Path $allowList -Name '1' -Value 'https://tacosgavilan.com' -Type String -Force
            Set-ItemProperty -Path $allowList -Name '2' -Value 'https://www.tacosgavilan.com' -Type String -Force
            Set-ItemProperty -Path $allowList -Name '3' -Value $originPattern -Type String -Force
        }
        $actions.Add('AutoplayAllowlist de Chrome/Edge configurado para Tacos Gavilan')
    } catch {
        $actions.Add("Aviso registro Chrome/Edge: $($_.Exception.Message)")
    }

    $script:HardeningApplied = $true
    return ($actions -join '; ')
}

function Launch-StoreBrowser {
    param([string]$Url, [bool]$Fullscreen = $false)
    $browser = Get-BrowserExecutable
    if (-not $browser) {
        throw 'No se encontro Google Chrome ni Microsoft Edge instalado.'
    }
    $argsList = @(
        '--autoplay-policy=no-user-gesture-required',
        '--no-first-run',
        '--disable-session-crashed-bubble',
        '--disable-infobars'
    )
    if ($Fullscreen) {
        $argsList += '--start-fullscreen'
    }
    $argsList += $Url
    Start-Process -FilePath $browser.Path -ArgumentList $argsList
    return "Navegador $($browser.Name) abierto hacia $Url"
}

function Get-SystemTelemetry {
    $cpuPct = $null
    $ramUsedPct = $null
    $ramTotalGb = $null
    $diskFreeGb = $null
    $diskTotalGb = $null
    $uptimeSec = $null
    $osVersion = $null
    $localIp = $null
    $volPct = $null
    $isMuted = $null
    $audioDevice = $null
    $browserRunning = $false
    $browserName = $null
    $activeTitle = $null

    try {
        $cpu = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Measure-Object -Property LoadPercentage -Average).Average
        if ($null -ne $cpu) { $cpuPct = [math]::Round([double]$cpu, 1) }
    } catch {}

    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($os) {
            $osVersion = "$($os.Caption) ($($os.Version))"
            $totalKb = [double]$os.TotalVisibleMemorySize
            $freeKb  = [double]$os.FreePhysicalMemory
            if ($totalKb -gt 0) {
                $ramTotalGb = [math]::Round($totalKb / 1048576, 1)
                $ramUsedPct = [math]::Round((($totalKb - $freeKb) / $totalKb) * 100, 1)
            }
            $uptimeSec = [int][math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalSeconds)
        }
    } catch {}

    try {
        $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue
        if ($disk -and $disk.Size -gt 0) {
            $diskFreeGb  = [math]::Round([double]$disk.FreeSpace / 1GB, 1)
            $diskTotalGb = [math]::Round([double]$disk.Size / 1GB, 1)
        }
    } catch {}

    try {
        $ipObj = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -First 1
        if ($ipObj) { $localIp = $ipObj.IPAddress }
    } catch {}

    if ($audioReady) {
        try {
            $volPct  = [TegAudio.VolumeController]::GetVolumePercent()
            $isMuted = [TegAudio.VolumeController]::GetMute()
        } catch {}
    }

    try {
        $sound = Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue |
            Where-Object { $_.Status -eq 'OK' } | Select-Object -First 1
        if ($sound) { $audioDevice = $sound.Name }
    } catch {}

    try {
        $procs = Get-Process -Name 'chrome', 'msedge' -ErrorAction SilentlyContinue
        if ($procs) {
            $browserRunning = $true
            $withTitle = $procs | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
            if ($withTitle) {
                $browserName = $withTitle.ProcessName
                $activeTitle = $withTitle.MainWindowTitle
            } else {
                $browserName = ($procs | Select-Object -First 1).ProcessName
            }
        }
    } catch {}

    return @{
        hostname           = $env:COMPUTERNAME
        osVersion          = $osVersion
        localIp            = $localIp
        cpuPct             = $cpuPct
        ramUsedPct         = $ramUsedPct
        ramTotalGb         = $ramTotalGb
        diskFreeGb         = $diskFreeGb
        diskTotalGb        = $diskTotalGb
        uptimeSec          = $uptimeSec
        volumePct          = $volPct
        isMuted            = $isMuted
        audioDevice        = $audioDevice
        browserRunning     = $browserRunning
        browserName        = $browserName
        activeWindowTitle  = $activeTitle
        hardeningApplied   = $script:HardeningApplied
        lastAutoHealAt     = $script:LastAutoHealAt
        lastAutoHealAction = $script:LastAutoHealAction
    }
}

function Invoke-WatchdogCheck {
    param($Cfg)
    $wd = $Cfg.watchdog
    if (-not $wd -or -not $wd.watchdogEnabled) { return }

    if ($audioReady) {
        try {
            $curMute = [TegAudio.VolumeController]::GetMute()
            $curVol  = [TegAudio.VolumeController]::GetVolumePercent()
            if ($wd.forceUnmute -and $curMute) {
                [TegAudio.VolumeController]::SetMute($false)
                $script:LastAutoHealAt = (Get-Date).ToUniversalTime().ToString('o')
                $script:LastAutoHealAction = 'Auto-desmuteo de Windows por Watchdog'
                Write-TegLog $script:LastAutoHealAction 'WARN'
            }
            $minVol = [int]$wd.minVolumePct
            if ($minVol -gt 0 -and $curVol -lt $minVol) {
                [TegAudio.VolumeController]::SetVolumePercent($minVol)
                $script:LastAutoHealAt = (Get-Date).ToUniversalTime().ToString('o')
                $script:LastAutoHealAction = "Volumen restaurado automaticamente de $curVol% a $minVol%"
                Write-TegLog $script:LastAutoHealAction 'WARN'
            }
        } catch {}
    }

    if ($wd.autoLaunchBrowser) {
        try {
            $hasBrowser = Get-Process -Name 'chrome', 'msedge' -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $hasBrowser) {
                $targetPath = if ($wd.targetPath) { $wd.targetPath } else { '/order-ready-board' }
                $fullUrl = "$($Cfg.baseUrl.TrimEnd('/'))$targetPath"
                Launch-StoreBrowser -Url $fullUrl -Fullscreen ([bool]$wd.kioskFullscreen) | Out-Null
                $script:LastAutoHealAt = (Get-Date).ToUniversalTime().ToString('o')
                $script:LastAutoHealAction = "Navegador reabierto automaticamente hacia $targetPath"
                Write-TegLog $script:LastAutoHealAction 'WARN'
            }
        } catch {
            Write-TegLog "Error Watchdog reabriendo navegador: $($_.Exception.Message)" 'ERROR'
        }
    }
}

function Send-CommandAck {
    param(
        [string]$CommandId,
        [string]$Status,
        [int]$ExitCode = 0,
        [string]$Output = '',
        [string]$ErrorMessage = $null
    )
    try {
        $ackBody = @{
            commandId    = $CommandId
            status       = $Status
            exitCode     = $ExitCode
            output       = $Output
            errorMessage = $ErrorMessage
            telemetry    = (Get-SystemTelemetry)
        } | ConvertTo-Json -Depth 8 -Compress
        Invoke-RestMethod -Uri "$($Config.baseUrl.TrimEnd('/'))/api/remote-control/agent/ack" -Method Post -Headers $Headers -Body ([System.Text.Encoding]::UTF8.GetBytes($ackBody)) -TimeoutSec 20 | Out-Null
    } catch {
        Write-TegLog "Fallo enviando ACK para comando $($CommandId) - $($_.Exception.Message)" 'ERROR'
    }
}

function Invoke-RemoteCommand {
    param($Cmd)
    $cmdId   = $Cmd.id
    $cmdType = $Cmd.command_type
    $payload = $Cmd.payload
    Write-TegLog "Ejecutando comando remoto [$cmdType] ($cmdId)" 'INFO'

    try {
        switch ($cmdType) {
            'set_volume' {
                if (-not $audioReady) { throw 'API de audio CoreAudio no disponible en esta sesion.' }
                $vol = [int]$payload.volumePct
                if ($vol -lt 0) { $vol = 0 }
                if ($vol -gt 100) { $vol = 100 }
                [TegAudio.VolumeController]::SetMute($false)
                [TegAudio.VolumeController]::SetVolumePercent($vol)
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output "Volumen maestro de Windows fijado en $vol% (Mute desactivado)."
            }
            'unmute_audio' {
                if (-not $audioReady) { throw 'API de audio CoreAudio no disponible en esta sesion.' }
                [TegAudio.VolumeController]::SetMute($false)
                $vol = [TegAudio.VolumeController]::GetVolumePercent()
                if ($vol -lt 50) {
                    [TegAudio.VolumeController]::SetVolumePercent(85)
                    $vol = 85
                }
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output "Audio de Windows desmuteado (volumen actual: $vol%)."
            }
            'test_audio' {
                if ($audioReady) {
                    [TegAudio.VolumeController]::SetMute($false)
                }
                [System.Media.SystemSounds]::Exclamation.Play()
                [console]::Beep(880, 220)
                Start-Sleep -Milliseconds 120
                [console]::Beep(1174, 280)
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output 'Tono de prueba reproducido por la salida de audio predeterminada de Windows.'
            }
            'reopen_board' {
                $targetPath = if ($payload.targetPath) { [string]$payload.targetPath } elseif ($Config.watchdog.targetPath) { [string]$Config.watchdog.targetPath } else { '/order-ready-board' }
                $url = if ($targetPath -match '^https?://') { $targetPath } else { "$($Config.baseUrl.TrimEnd('/'))$targetPath" }
                $fs = if ($null -ne $payload.fullscreen) { [bool]$payload.fullscreen } else { [bool]$Config.watchdog.kioskFullscreen }
                $msg = Launch-StoreBrowser -Url $url -Fullscreen $fs
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output $msg
            }
            'open_url' {
                $url = [string]$payload.url
                if (-not ($url -match '^https?://')) {
                    if ($url.StartsWith('/')) { $url = "$($Config.baseUrl.TrimEnd('/'))$url" }
                    else { throw 'URL invalida: debe iniciar con https:// o /' }
                }
                $fs = [bool]$payload.fullscreen
                $msg = Launch-StoreBrowser -Url $url -Fullscreen $fs
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output $msg
            }
            'restart_browser' {
                Get-Process -Name 'chrome', 'msedge' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
                $targetPath = if ($payload.targetPath) { [string]$payload.targetPath } elseif ($Config.watchdog.targetPath) { [string]$Config.watchdog.targetPath } else { '/order-ready-board' }
                $url = "$($Config.baseUrl.TrimEnd('/'))$targetPath"
                $fs = if ($null -ne $payload.fullscreen) { [bool]$payload.fullscreen } else { [bool]$Config.watchdog.kioskFullscreen }
                $msg = Launch-StoreBrowser -Url $url -Fullscreen $fs
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output "Navegador reiniciado. $msg"
            }
            'clear_browser_cache' {
                Get-Process -Name 'chrome', 'msedge' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
                $cacheDirs = @(
                    "$env:LocalAppData\\Google\\Chrome\\User Data\\Default\\Cache",
                    "$env:LocalAppData\\Google\\Chrome\\User Data\\Default\\Code Cache",
                    "$env:LocalAppData\\Microsoft\\Edge\\User Data\\Default\\Cache",
                    "$env:LocalAppData\\Microsoft\\Edge\\User Data\\Default\\Code Cache"
                )
                $cleaned = 0
                foreach ($dir in $cacheDirs) {
                    if (Test-Path $dir) {
                        Remove-Item -Path "$dir\\*" -Recurse -Force -ErrorAction SilentlyContinue
                        $cleaned++
                    }
                }
                $targetPath = if ($Config.watchdog.targetPath) { [string]$Config.watchdog.targetPath } else { '/order-ready-board' }
                $url = "$($Config.baseUrl.TrimEnd('/'))$targetPath"
                $msg = Launch-StoreBrowser -Url $url -Fullscreen ([bool]$Config.watchdog.kioskFullscreen)
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output "Cache limpiada ($cleaned carpetas preservando sesion) y navegador reabierto. $msg"
            }
            'apply_hardening' {
                $res = Apply-WindowsHardening -BaseUrl $Config.baseUrl
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output $res
            }
            'sync_watchdog_config' {
                if ($payload.watchdog) {
                    $Config.watchdog = $payload.watchdog
                    Save-AgentConfig -Cfg $Config
                }
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output 'Configuracion de Watchdog sincronizada localmente.'
            }
            'collect_diagnostics' {
                $t = Get-SystemTelemetry
                $out = $t | ConvertTo-Json -Depth 6
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output $out
            }
            'reboot_pc' {
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output 'Reinicio de Windows programado en 5 segundos.'
                Start-Sleep -Seconds 2
                & shutdown.exe /r /t 5 /f /c "Reinicio remoto solicitado desde SM TEG Tacos Gavilan"
            }
            'run_powershell' {
                $psCode = [string]$payload.script
                if ([string]::IsNullOrWhiteSpace($psCode)) { throw 'Script PowerShell vacio.' }
                $sb = [scriptblock]::Create($psCode)
                $rawOut = & $sb 2>&1 | Out-String
                $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode $exitCode -Output $rawOut.Trim()
            }
            'update_agent' {
                $scriptUrl = "$($Config.baseUrl.TrimEnd('/'))/api/remote-control/agent/script"
                $newSource = Invoke-RestMethod -Uri $scriptUrl -Method Get -Headers $Headers -TimeoutSec 30
                if ([string]::IsNullOrWhiteSpace($newSource) -or ($newSource -notmatch 'TEG Store Remote Agent')) {
                    throw 'Descarga de actualizacion del agente invalida.'
                }
                Set-Content -Path $ScriptPath -Value $newSource -Encoding UTF8
                Send-CommandAck -CommandId $cmdId -Status 'succeeded' -ExitCode 0 -Output 'Agente actualizado exitosamente. Reiniciando servicio local...'
                Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $ScriptPath)
                $agentMutex.ReleaseMutex()
                exit 0
            }
            default {
                Send-CommandAck -CommandId $cmdId -Status 'failed' -ExitCode 1 -ErrorMessage "Tipo de comando no soportado por el agente Windows: $cmdType"
            }
        }
    } catch {
        $errMsg = $_.Exception.Message
        Write-TegLog "Error ejecutando [$cmdType]: $errMsg" 'ERROR'
        Send-CommandAck -CommandId $cmdId -Status 'failed' -ExitCode 1 -ErrorMessage $errMsg
    }
}

Write-TegLog "TEG Store Remote Agent v$AgentVersion iniciado para $($Config.storeCode) ($($Config.deviceKey))" 'INFO'

# Aplicar hardening base al arrancar si preventSleep esta activo
if ($Config.watchdog -and $Config.watchdog.preventSleep) {
    Apply-WindowsHardening -BaseUrl $Config.baseUrl | Out-Null
}

$lastHeartbeat = [DateTime]::MinValue
$lastWatchdog  = [DateTime]::MinValue
$lastPoll      = [DateTime]::MinValue

while ($true) {
    try {
        $now = Get-Date
        # Horario de baja actividad (04:15 - 06:59 AM hora local tienda): espaciar red para cuidar cuotas
        $minsOfDay = ($now.Hour * 60) + $now.Minute
        $isDeadHours = ($minsOfDay -ge 255 -and $minsOfDay -lt 420)
        $hbIntervalSec   = if ($isDeadHours) { 300 } else { 180 }
        $pollIntervalSec = if ($isDeadHours) { 180 } else { 60 }

        # 1. Watchdog local cada 30 segundos (100% local, cero consumo de red/Vercel)
        if (($now - $lastWatchdog).TotalSeconds -ge 30) {
            Invoke-WatchdogCheck -Cfg $Config
            $lastWatchdog = $now
        }

        # 2. Heartbeat completo cada 180s (300s en madrugada)
        if (($now - $lastHeartbeat).TotalSeconds -ge $hbIntervalSec) {
            $hbPayload = @{
                agentVersion = $AgentVersion
                telemetry    = (Get-SystemTelemetry)
            } | ConvertTo-Json -Depth 8 -Compress
            $hbRes = Invoke-RestMethod -Uri "$($Config.baseUrl.TrimEnd('/'))/api/remote-control/agent/heartbeat" -Method Post -Headers $Headers -Body ([System.Text.Encoding]::UTF8.GetBytes($hbPayload)) -TimeoutSec 20
            if ($hbRes -and $hbRes.desiredConfig) {
                $Config.watchdog = $hbRes.desiredConfig
                Save-AgentConfig -Cfg $Config
            }
            $lastHeartbeat = $now
        }

        # 3. Polling de comandos pendientes cada 60s (180s en madrugada)
        if (($now - $lastPoll).TotalSeconds -ge $pollIntervalSec) {
            $pollRes = Invoke-RestMethod -Uri "$($Config.baseUrl.TrimEnd('/'))/api/remote-control/agent/poll" -Method Get -Headers $Headers -TimeoutSec 20
            if ($pollRes -and $pollRes.commands) {
                foreach ($cmd in $pollRes.commands) {
                    Invoke-RemoteCommand -Cmd $cmd
                }
            }
            $lastPoll = $now
        }
    } catch {
        Write-TegLog "Error en ciclo principal: $($_.Exception.Message)" 'WARN'
    }

    Start-Sleep -Seconds 30
}
`
}

/**
 * Genera el script instalador `.ps1` específico para una sucursal (1 solo paso):
 * - Instala `TEG Store Agent` + `config.json` con token único de la sucursal.
 * - Registra la Tarea Programada `TEG-Remote-Agent` con privilegios elevados al iniciar sesión.
 * - Aplica Hardening inicial (energía 24/7 + Chrome/Edge AutoplayAllowlist).
 * - Opcionalmente descarga e instala Action1 Agent (`.msi`) si está configurado globalmente.
 * - Inicia el agente en vivo inmediatamente.
 */
export function buildWindowsInstallerPs1(params: InstallerBuildParams): string {
  const wd = sanitizePcWatchdogConfig(params.watchdog)
  const cleanBaseUrl = params.baseUrl.trim().replace(/\/+$/, '')
  const agentSourceB64 = Buffer.from(buildWindowsAgentScriptSource(), 'utf8').toString('base64')
  const action1Url = (params.action1InstallerUrl || '').trim()

  const configObject = {
    baseUrl: cleanBaseUrl,
    storeCode: params.storeCode,
    storeName: params.storeName,
    deviceKey: params.deviceKey,
    displayName: params.displayName,
    agentToken: params.agentToken,
    installedAt: new Date().toISOString(),
    watchdog: wd,
  }
  const configJsonB64 = Buffer.from(JSON.stringify(configObject, null, 2), 'utf8').toString('base64')

  return `# ==============================================================================
# Instalador 1-Clic Tacos Gavilan - Control Remoto de Sucursal
# Sucursal: ${params.storeName} (${params.storeCode})
# Equipo:   ${params.displayName}
# Generado: ${new Date().toISOString()}
# ==============================================================================
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Verificar privilegios de Administrador (auto-elevar si es necesario)
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Solicitando permisos de Administrador...' -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    exit 0
}

Write-Host ''
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host '  TACOS GAVILAN - INSTALADOR REMOTO 1 CLIC (SM TEG + ACTION1)  ' -ForegroundColor Cyan
Write-Host "  Sucursal: ${escapePsSingleQuoted(params.storeName)} (${escapePsSingleQuoted(params.storeCode)})" -ForegroundColor White
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host ''

$InstallDir = 'C:\\ProgramData\\TacosGavilan\\RemoteAgent'
New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null

# 1. Guardar config.json y teg-agent.ps1
Write-Host '[1/5] Instalando archivos de TEG Store Agent...' -ForegroundColor Yellow
$configBytes = [System.Convert]::FromBase64String('${configJsonB64}')
[System.IO.File]::WriteAllBytes((Join-Path $InstallDir 'config.json'), $configBytes)

$agentBytes = [System.Convert]::FromBase64String('${agentSourceB64}')
$agentPath = Join-Path $InstallDir 'teg-agent.ps1'
[System.IO.File]::WriteAllBytes($agentPath, $agentBytes)

# Proteger config.json (Administradores + SYSTEM + usuario actual)
try {
    & icacls (Join-Path $InstallDir 'config.json') /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)" "$env:USERNAME:(R)" | Out-Null
} catch {}

# 2. Aplicar politicas base de energia 24/7 y Chrome/Edge AutoplayAllowlist
Write-Host '[2/5] Aplicando blindaje Windows (sin suspension + Autoplay bocina Chrome/Edge)...' -ForegroundColor Yellow
& powercfg /change monitor-timeout-ac 0 | Out-Null
& powercfg /change standby-timeout-ac 0 | Out-Null
& powercfg /change hibernate-timeout-ac 0 | Out-Null
& powercfg /h off 2>$null | Out-Null
foreach ($regRoot in @('HKLM:\\SOFTWARE\\Policies\\Google\\Chrome', 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge')) {
    if (-not (Test-Path $regRoot)) { New-Item -Path $regRoot -Force | Out-Null }
    Set-ItemProperty -Path $regRoot -Name 'AutoplayAllowed' -Value 1 -Type DWord -Force
    $allowList = Join-Path $regRoot 'AutoplayAllowlist'
    if (-not (Test-Path $allowList)) { New-Item -Path $allowList -Force | Out-Null }
    Set-ItemProperty -Path $allowList -Name '1' -Value 'https://tacosgavilan.com' -Type String -Force
    Set-ItemProperty -Path $allowList -Name '2' -Value 'https://www.tacosgavilan.com' -Type String -Force
    Set-ItemProperty -Path $allowList -Name '3' -Value '${escapePsSingleQuoted(cleanBaseUrl)}' -Type String -Force
}

# 3. Instalar Action1 Agent silenciosamente si se configuro URL de MSI en SM TEG
$action1Url = '${escapePsSingleQuoted(action1Url)}'
if (-not [string]::IsNullOrWhiteSpace($action1Url)) {
    Write-Host '[3/5] Descargando e instalando Action1 Remote Desktop Agent...' -ForegroundColor Yellow
    try {
        $msiPath = Join-Path $env:TEMP 'Action1_TacosGavilan_Agent.msi'
        Invoke-WebRequest -Uri $action1Url -OutFile $msiPath -UseBasicParsing -TimeoutSec 120
        $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "\`"$msiPath\`"", '/qn', '/norestart') -Wait -PassThru
        if ($p.ExitCode -eq 0 -or $p.ExitCode -eq 3010) {
            Write-Host '      Action1 instalado correctamente.' -ForegroundColor Green
        } else {
            Write-Host "      Action1 devolvio codigo $($p.ExitCode) (revisar en consola Action1)." -ForegroundColor DarkYellow
        }
        Remove-Item -Path $msiPath -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "      Aviso instalando Action1: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
} else {
    Write-Host '[3/5] URL de instalador Action1 no configurada aun (se omitio; puedes instalarlo despues desde SM TEG).' -ForegroundColor DarkGray
}

# 4. Registrar Tarea Programada con auto-arranque al iniciar sesion + reinicio automatico si falla
Write-Host '[4/5] Registrando servicio programado TEG-Remote-Agent...' -ForegroundColor Yellow
$taskName = 'TEG-Remote-Agent'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$agentPath\`""
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggerLogon -Principal $principal -Settings $settings -Force | Out-Null

# 5. Arrancar el agente inmediatamente y verificar conexion con SM TEG
Write-Host '[5/5] Iniciando agente y verificando conexion con SM TEG...' -ForegroundColor Yellow
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host '  LISTO! PC CONECTADA AL CENTRO DE CONTROL REMOTO DE SM TEG     ' -ForegroundColor Green
Write-Host "  Sucursal: ${escapePsSingleQuoted(params.storeName)}" -ForegroundColor White
Write-Host '  Abre /admin/control-remoto en SM TEG para verla EN LINEA.     ' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''
Read-Host 'Presiona ENTER para cerrar esta ventana'
`
}

/**
 * Envuelve el instalador `.ps1` en un archivo `.cmd` de doble clic para Windows
 * (evita bloqueos de ExecutionPolicy y solicita UAC automaticamente).
 */
export function buildWindowsInstallerCmd(params: InstallerBuildParams): string {
  const ps1 = buildWindowsInstallerPs1(params)
  const ps1Base64Utf8 = Buffer.from(ps1, 'utf8').toString('base64')
  const safeStoreSlug = params.storeCode.replace(/[^A-Z0-9_-]/gi, '')

  // Dividir Base64 en bloques seguros para cmd.exe (max ~7000 chars por linea)
  const chunkSize = 1800
  const chunks: string[] = []
  for (let i = 0; i < ps1Base64Utf8.length; i += chunkSize) {
    chunks.push(ps1Base64Utf8.slice(i, i + chunkSize))
  }

  const writeChunksLines = chunks
    .map((chunk, idx) =>
      idx === 0
        ? `> "%B64FILE%" echo ${chunk}`
        : `>> "%B64FILE%" echo ${chunk}`
    )
    .join('\r\n')

  return [
    '@echo off',
    'setlocal EnableExtensions',
    `title Tacos Gavilan - Instalador Remoto 1 Clic (${safeStoreSlug})`,
    'echo Iniciando instalador de Tacos Gavilan Remote Control...',
    'set "TMPDIR=%TEMP%\\TEG_Remote_Install"',
    'if not exist "%TMPDIR%" mkdir "%TMPDIR%"',
    'set "B64FILE=%TMPDIR%\\installer.b64"',
    'set "PS1FILE=%TMPDIR%\\Instalar-TEG-PC.ps1"',
    writeChunksLines,
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$b64 = (Get-Content -Raw \'%B64FILE%\') -replace \'\\s\', \'\'; [IO.File]::WriteAllBytes(\'%PS1FILE%\', [Convert]::FromBase64String($b64)); Start-Process powershell.exe -Verb RunAs -ArgumentList @(\'-NoProfile\', \'-ExecutionPolicy\', \'Bypass\', \'-File\', \'%PS1FILE%\')"',
    'endlocal',
    'exit /b 0',
    '',
  ].join('\r\n')
}
