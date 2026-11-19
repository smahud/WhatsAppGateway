param(
    [Parameter(Mandatory)][ValidateSet('Preflight','Protect','RepairStop','Install','Uninstall')][string]$Action,
    [string]$NodeExe,
    [switch]$PauseOutbox,
    [switch]$DatabaseOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$Name = $JibasServiceName
$displayName = if ($Name -eq 'JIBAS_WG.exe') { 'JIBAS WhatsApp Gateway' } else { "JIBAS WhatsApp Gateway ($Name)" }

$systemSid = 'S-1-5-18'
$adminsSid = 'S-1-5-32-544'
$serviceSid = 'S-1-5-19'
$serviceAccount = 'NT AUTHORITY\LocalService'
$daemon = Join-Path $JibasRoot 'daemon'
$wrapper = Join-Path $daemon $Name
$xml = [IO.Path]::ChangeExtension($wrapper, '.xml')
$serviceLog = Join-Path $daemon 'logs'
$credential = Join-Path $JibasRoot 'dashboard-auth.json'
$configFile = Join-Path $JibasRoot 'config.json'
$sessions = Join-Path $JibasRoot 'sessions'

function New-JibasAccessRule {
    param([string]$Sid, [string]$Rights, [bool]$Recurse)
    $flags = if ($Recurse) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    [Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new($Sid), $Rights, $flags, 'None', 'Allow'
    )
}

function Protect-JibasRoot {
    $acl = Get-Acl -LiteralPath $JibasRoot
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {
        $acl.RemoveAccessRuleSpecific($rule)
    }
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($adminsSid))
    $acl.AddAccessRule((New-JibasAccessRule $systemSid 'FullControl' $true))
    $acl.AddAccessRule((New-JibasAccessRule $adminsSid 'FullControl' $true))
    $acl.AddAccessRule((New-JibasAccessRule $serviceSid 'ReadAndExecute' $true))
    Set-Acl -LiteralPath $JibasRoot -AclObject $acl
}

function Assert-JibasProtected([string]$Path, [bool]$ServiceMayWrite = $false) {
    $entry = Get-Item -LiteralPath $Path -Force
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Path reparse tidak boleh dipakai service: $Path" }
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $trusted = @($adminsSid, $systemSid, $owner, 'S-1-3-0', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    if ($ServiceMayWrite) { $trusted += $serviceSid }
    $acl = Get-Acl -LiteralPath $Path
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) {
        throw "Owner folder/file service tidak tepercaya: $Path"
    }
    $write = [Security.AccessControl.FileSystemRights]'WriteData,AppendData,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $write) -and $rule.IdentityReference.Value -notin $trusted) {
            throw "Izin tulis tidak aman pada $Path. Jalankan installer dari folder khusus JIBAS WG."
        }
    }
}

function Grant-JibasRuntimeAccess([string]$Path, [string]$Rights) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRule((New-JibasAccessRule $serviceSid $Rights (Test-Path -LiteralPath $Path -PathType Container)))
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Write-JibasXml {
    $doc = New-Object Xml.XmlDocument
    $service = $doc.AppendChild($doc.CreateElement('service'))
    $fields = [ordered]@{
        id = $Name
        name = $displayName
        description = 'JIBAS WhatsApp Gateway: JIBAS SMS to WhatsApp'
        executable = $NodeExe
        arguments = '"' + $JibasEntry + '"'
        workingdirectory = $JibasRoot
        stoptimeout = '15sec'
        logpath = $serviceLog
        logmode = 'rotate'
    }
    foreach ($key in $fields.Keys) { $service.AppendChild($doc.CreateElement($key)).InnerText = $fields[$key] }
    $envVars = [ordered]@{ NODE_ENV='production' }
    if ($PauseOutbox) { $envVars.JIBAS_WG_PAUSE_OUTBOX = '1' }
    if ($DatabaseOnly) { $envVars.JIBAS_WG_DB_ONLY = '1' }
    foreach ($key in $envVars.Keys) {
        $entry = $service.AppendChild($doc.CreateElement('env'))
        $entry.SetAttribute('name', $key)
        $entry.SetAttribute('value', $envVars[$key])
    }
    $temporary = "$xml.install-tmp"
    $doc.Save($temporary)
    Move-Item -LiteralPath $temporary -Destination $xml -Force
}

function Stop-JibasService($service) {
    if ($service -and $service.State -ne 'Stopped') {
        Stop-Service -Name $service.Name -ErrorAction Stop
        $controller = Get-Service -Name $service.Name
        try { $controller.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(35)) }
        finally { $controller.Dispose() }
    }
}

function Remove-JibasRegistration($service) {
    Stop-JibasService $service
    $result = Invoke-CimMethod -InputObject $service -MethodName Delete
    if ($result.ReturnValue -ne 0) { throw "Gagal menghapus service $($service.Name) (kode $($result.ReturnValue))." }
    if (Get-JibasScm $service.Name) { throw 'Service ditandai dihapus; tutup Services.msc/handle yang masih terbuka lalu periksa lagi.' }
}

function Stop-JibasRepair($plan, [int]$Port) {
    if ($plan.Repair) {
        Write-Output 'Instance JIBAS WG milik folder ini ditemukan. Perbaikan otomatis: hentikan proses lama, lalu pasang ulang.'
        foreach ($service in $plan.Services) { Stop-JibasService $service }
        foreach ($proc in $plan.Manual) {
            if (!$proc.HasExited) {
                Stop-Process -InputObject $proc -Force
                if (!$proc.WaitForExit(10000)) { throw "Proses gateway $($proc.Id) belum berhenti." }
            }
        }
        for ($i=0; (Test-JibasListening $Port) -and $i -lt 20; $i++) { Start-Sleep -Milliseconds 250 }
    }
    Assert-JibasPortFree $Port
}

try {
    Assert-JibasAdmin
    $existing = Get-JibasScm $Name
    $legacy = Get-JibasScm $JibasLegacyServiceName
    $services = @(@($existing, $legacy) | Where-Object { $_ })
    foreach ($item in $services) {
        $expected = Join-Path $daemon $item.Name
        if ($item.PathName.Trim().Trim('"') -ine $expected) {
            throw "Service $($item.Name) terdaftar dari lokasi lain: $($item.PathName). Jalankan dari folder yang benar."
        }
    }
    if ($Action -eq 'Uninstall') {
        if (!$services) {
            Write-Output 'Service JIBAS WG tidak terpasang.'
            exit 0
        }
        foreach ($item in $services) { Remove-JibasRegistration $item }
        Write-Output 'Service JIBAS WG dihapus. Database, antrean, trigger, config, login, sesi, dan log dipertahankan.'
        exit 0
    }

    $port = Get-JibasPort
    $plan = Get-JibasRepairPlan $port $services
    Assert-JibasNoLegacyTask
    if ($JibasRoot.Contains('%')) { throw 'Path service tidak boleh berisi karakter %.' }
    $profileRoot = (Split-Path -Parent $env:USERPROFILE).TrimEnd('\') + '\'
    if ($JibasRoot.StartsWith($profileRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Ekstrak atau clone JIBAS WG ke folder khusus di luar profil pengguna, misalnya C:\JIBAS_WG.'
    }
    if ($Action -eq 'Preflight') {
        if ($plan.Repair) { Write-Output "Port $port milik JIBAS WG. Instalasi akan memperbaiki instance ini." }
        else { Write-Output "Port dashboard $port tersedia." }
        exit 0
    }
    if ($Action -eq 'Protect') {
        if ($JibasRoot.TrimEnd('\') -eq [IO.Path]::GetPathRoot($JibasRoot).TrimEnd('\') -or
            !(Test-Path -LiteralPath $JibasEntry -PathType Leaf) -or
            !(Test-Path -LiteralPath (Join-Path $JibasRoot 'package-lock.json') -PathType Leaf) -or
            ((Get-Item -LiteralPath $JibasRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Gunakan folder khusus proyek JIBAS WG, bukan drive root atau junction/symlink.'
        }
        try {
            Assert-JibasProtected $JibasRoot
            Grant-JibasRuntimeAccess $JibasRoot 'ReadAndExecute'
        } catch { Protect-JibasRoot }
        foreach ($item in @($configFile, $credential, $sessions, $daemon, (Join-Path $JibasRoot '.runtime'), (Join-Path $JibasRoot 'node_modules'))) {
            if (Test-Path -LiteralPath $item) { Assert-JibasProtected $item ($item -in @($configFile,$sessions)) }
        }
        exit 0
    }
    if ($Action -eq 'RepairStop') {
        Stop-JibasRepair $plan $port
        exit 0
    }
    if (!$NodeExe) { $NodeExe = Get-JibasNode }
    if (!$NodeExe -or $NodeExe.Contains('%') -or $NodeExe.StartsWith($profileRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runtime Node untuk service harus berada di luar profil pengguna.'
    }
    $winSW = Join-Path $JibasRoot 'node_modules\node-windows\bin\winsw\winsw.exe'
    if (!(Test-Path -LiteralPath $winSW -PathType Leaf)) {
        throw 'WinSW tidak ditemukan. Jalankan npm ci dengan optional dependency node-windows.'
    }
    if (!(Test-Path -LiteralPath $credential -PathType Leaf)) { throw 'Siapkan login dashboard dengan Install-Windows-Service.ps1 terlebih dahulu.' }
    $paths = @($JibasRoot, $NodeExe, (Join-Path $JibasRoot 'gateway.js'), (Join-Path $JibasRoot 'deployment'),
        $JibasEntry, (Join-Path $JibasRoot 'node_modules'), $winSW, $credential)
    foreach ($item in $paths) { Assert-JibasProtected $item }
    foreach ($item in @($daemon, $serviceLog, $sessions)) {
        if (!(Test-Path -LiteralPath $item)) { New-Item -Path $item -ItemType Directory | Out-Null }
    }
    Assert-JibasProtected $daemon
    foreach ($item in @($configFile, $sessions, $serviceLog)) {
        Assert-JibasProtected $item $true
        Grant-JibasRuntimeAccess $item 'Modify'
    }
    foreach ($item in @($wrapper, "$wrapper.config", $xml)) {
        if (Test-Path -LiteralPath $item) { Assert-JibasProtected $item }
    }
    Stop-JibasRepair $plan $port
    # Hardened paths are in place before adding anything executable to SCM.
    Copy-Item -LiteralPath $winSW -Destination $wrapper -Force
    Copy-Item -LiteralPath "$winSW.config" -Destination "$wrapper.config" -Force
    Write-JibasXml
    if (!$existing) {
        $result = Invoke-CimMethod -ClassName Win32_Service -MethodName Create -Arguments @{
            Name=$Name; DisplayName=$displayName
            PathName=('"'+$wrapper+'"'); ServiceType=[byte]16; ErrorControl=[byte]1
            StartMode='Manual'; DesktopInteract=$false; StartName=$serviceAccount
        }
    } else {
        $result = Invoke-CimMethod -InputObject $existing -MethodName Change -Arguments @{
            StartMode='Manual'; DisplayName=$displayName; DesktopInteract=$false; StartName=$serviceAccount
        }
    }
    if ($result.ReturnValue -ne 0) { throw "Pendaftaran service gagal (kode $($result.ReturnValue))." }
    if (![Diagnostics.EventLog]::SourceExists($Name)) { New-EventLog -LogName Application -Source $Name }
    & "$env:SystemRoot\System32\sc.exe" description $Name $displayName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Gagal memperbarui deskripsi service.' }
    & "$env:SystemRoot\System32\sc.exe" failure $Name reset= 0 actions= 'restart/10000/restart/10000/restart/10000' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Gagal mengatur pemulihan service.' }
    & "$env:SystemRoot\System32\sc.exe" failureflag $Name 1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Gagal mengaktifkan pemulihan service.' }
    Start-Service -Name $Name
    $scm = Get-JibasScm $Name
    $deadline = [DateTime]::UtcNow.AddSeconds(35)
    do {
        $health = Get-JibasHealth $port
        if ($health -and $health.dbConnected -and $health.jibasReady -and $health.pid) {
            $child = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$health.pid)"
            if ($child -and $child.ParentProcessId -eq $scm.ProcessId -and $child.ExecutablePath -ieq $NodeExe) {
                if ($legacy) {
                    Write-Output "Migrasi service $($legacy.Name) -> $Name; data lokal dan database dipertahankan."
                    Remove-JibasRegistration (Get-JibasScm $legacy.Name)
                }
                Set-Service -Name $Name -StartupType Automatic
                Write-Output "Service JIBAS WG $Name siap (gateway PID $($health.pid)). Dashboard: http://127.0.0.1:$port/login"
                exit 0
            }
        }
        Start-Sleep -Seconds 1
    } until ([DateTime]::UtcNow -ge $deadline)
    throw "Service terdaftar tetapi gateway/bridge JIBAS belum siap. Periksa log di $serviceLog dan status service $Name."
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
