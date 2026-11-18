$JibasRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$JibasEntry = Join-Path $JibasRoot 'deployment\start-gateway.js'
$JibasServiceName = 'JIBAS_WG.exe'
$JibasLegacyServiceName = 'wagwpro.exe'
$JibasLegacyTask = 'WAGW-JIBAS-Bridge'

function Get-JibasNode {
    $portable = Join-Path $JibasRoot 'node.exe'
    if (Test-Path -LiteralPath $portable -PathType Leaf) { return $portable }
    $managed = Join-Path $JibasRoot '.runtime\node\node.exe'
    if (Test-Path -LiteralPath $managed -PathType Leaf) { return $managed }
    return (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue).Source
}

function Get-JibasPort {
    if (!(Test-Path -LiteralPath (Join-Path $JibasRoot 'config.json') -PathType Leaf)) {
        throw 'Salin config.example.json menjadi config.json, lalu isi data database JIBAS.'
    }
    $config = Get-Content -LiteralPath (Join-Path $JibasRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$config -or $config -isnot [pscustomobject]) { throw 'config.json harus berisi objek JSON.' }
    $port = 3000
    if ($null -ne $config.port) {
        if ("$($config.port)" -notmatch '^\d{1,5}$' -or [int]$config.port -lt 1 -or [int]$config.port -gt 65535) {
            throw 'Port dashboard pada config.json tidak valid.'
        }
        $port = [int]$config.port
    }
    return $port
}

function Get-JibasHealth([int]$Port) {
    try {
        return (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 2 -ErrorAction Stop)
    } catch {
        return $null
    }
}

function Assert-JibasPortFree([int]$Port) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try {
        $listener.ExclusiveAddressUse = $true
        $listener.Start()
    } catch {
        throw "Port dashboard $Port tidak tersedia. Ubah nilai port (bukan db_port) pada config.json."
    } finally {
        $listener.Stop()
    }
}

function Get-JibasScm([string]$Name = $JibasServiceName) {
    Get-CimInstance Win32_Service -Filter "Name='$Name'"
}

function Assert-JibasAdmin {
    $user = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (!$user.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Jalankan Command Prompt atau PowerShell sebagai Administrator.'
    }
}

function Assert-JibasNoLegacyTask {
    $old = Get-ScheduledTask -TaskName $JibasLegacyTask -ErrorAction SilentlyContinue
    if ($old -and $old.State -ne 'Disabled') {
        throw "Nonaktifkan task lama '$JibasLegacyTask' sebelum menggunakan service JIBAS WG."
    }
}

$JibasManualPidFile = Join-Path $JibasRoot 'deployment\manual.pid'
function Get-JibasManualProcess {
    if (!(Test-Path -LiteralPath $JibasManualPidFile -PathType Leaf)) { return }
    try {
        $record = Get-Content -LiteralPath $JibasManualPidFile -Raw | ConvertFrom-Json
        $proc = Get-Process -Id ([int]$record.id) -ErrorAction SilentlyContinue
        if (!$proc -or $proc.StartTime.ToFileTimeUtc() -ne [long]$record.startTime -or $proc.Path -ine $record.exe) { return }
        $command = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)"
        $entry = Join-Path $JibasRoot 'deployment\start-wagw.js'
        if (!$command -or !$command.CommandLine -or $command.CommandLine.IndexOf(('"' + $entry + '"'), [StringComparison]::OrdinalIgnoreCase) -lt 0) { return }
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($command.ParentProcessId)"
        if ($parent -and $parent.ExecutablePath -ieq (Join-Path $JibasRoot "daemon\$JibasLegacyServiceName")) { return }
        return $proc
    } catch {
        return
    }
}

function Get-JibasLegacyManualProcess {
    # Old START.bat used the portable node.exe and the single relative argument "wabot.js".
    $exe = Join-Path $JibasRoot 'node.exe'
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.ExecutablePath -ieq $exe -and $_.CommandLine -match '^(?:"[^"]+"|\S+)\s+"?wabot\.js"?\s*$'
    } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}

function Get-JibasPortOwners([int]$Port) {
    if (!(Test-JibasListening $Port)) { return }
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
}

function Test-JibasListening([int]$Port) {
    $ip = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties()
    foreach ($endpoint in $ip.GetActiveTcpListeners()) {
        if ($endpoint.Port -eq $Port) { return $true }
    }
    return $false
}

function Test-JibasServiceOwner([int]$ProcessId, $Service) {
    if (!$Service -or !$Service.ProcessId) { return $false }
    $wrapper = Join-Path $JibasRoot "daemon\$($Service.Name)"
    for ($i = 0; $i -lt 6 -and $ProcessId -gt 0; $i++) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
        if (!$process) { return $false }
        if ($process.ProcessId -eq $Service.ProcessId) { return $process.ExecutablePath -ieq $Wrapper }
        if ($process.ParentProcessId -eq $ProcessId) { return $false }
        $ProcessId = [int]$process.ParentProcessId
    }
    return $false
}

function Get-JibasRepairPlan([int]$Port, [array]$Services) {
    $owners = @(Get-JibasPortOwners $Port)
    $manual = @((Get-JibasManualProcess); (Get-JibasLegacyManualProcess | Where-Object { $_.Id -in $owners })) | Where-Object { $_ }
    $ids = @($manual | ForEach-Object { $_.Id })
    foreach ($id in $owners) {
        if ($id -notin $ids -and !($Services | Where-Object { Test-JibasServiceOwner $id $_ })) {
            $app = (Get-Process -Id $id -ErrorAction SilentlyContinue).ProcessName
            throw "Port dashboard $Port dipakai aplikasi lain (PID $id, $app). Ubah nilai port di config.json; jangan ubah db_port."
        }
    }
    if (!$owners) {
        if (Test-JibasListening $Port) { throw "Port dashboard $Port dipakai aplikasi lain (PID tidak dapat diverifikasi). Ubah port di config.json." }
        Assert-JibasPortFree $Port
    }
    return @{Services=$Services;Manual=$manual;Repair=($owners.Count -gt 0 -or ($Services | Where-Object State -ne 'Stopped') -or $ids.Count -gt 0)}
}
