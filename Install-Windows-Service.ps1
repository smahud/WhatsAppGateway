<#
.SYNOPSIS
    JIBAS WhatsApp Gateway - Script Instalasi Windows Service (PowerShell Native)
.DESCRIPTION
    Menggantikan Install_to_Windows_Service.bat sebagai entry-point utama instalasi
    JIBAS WhatsApp Gateway di Windows. Script ini:
    - Memverifikasi hak Administrator (auto-elevate jika perlu)
    - Memvalidasi lokasi folder (memperingatkan jika di bawah profil pengguna)
    - Meneruskan argumen ke deployment\windows\install.ps1
.NOTES
    Jalankan dari PowerShell Administrator:
      .\Install-Windows-Service.ps1
    Atau jika kebijakan script dibatasi:
      powershell -ExecutionPolicy Bypass -File .\Install-Windows-Service.ps1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)][string]$User,
    [Parameter(Mandatory=$false)][string]$Pass,
    [Parameter(Mandatory=$false)][string]$PassFile,
    [Parameter(Mandatory=$false)][switch]$CredentialsOnly,
    [Parameter(Mandatory=$false)][switch]$NoActivateMove,
    [Parameter(Mandatory=$false)][switch]$PauseOutbox,
    [Parameter(Mandatory=$false)][switch]$DbOnly,
    [Parameter(Mandatory=$false)][switch]$Help
)

$ErrorActionPreference = 'Stop'

# --- Auto-Elevation: deteksi dan elevasi jika bukan Administrator ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Warning "Skrip ini memerlukan hak Administrator untuk mendaftarkan Windows Service."
    Write-Host "Membuka sesi PowerShell Administrator baru..." -ForegroundColor Cyan
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($User)             { $argList += " -User `"$User`"" }
    if ($Pass)             { $argList += " -Pass `"$Pass`"" }
    if ($PassFile)         { $argList += " -PassFile `"$PassFile`"" }
    if ($CredentialsOnly)  { $argList += " -CredentialsOnly" }
    if ($NoActivateMove)   { $argList += " -NoActivateMove" }
    if ($PauseOutbox)      { $argList += " -PauseOutbox" }
    if ($DbOnly)           { $argList += " -DbOnly" }
    if ($Help)             { $argList += " -Help" }
    Start-Process powershell.exe -ArgumentList $argList -Verb RunAs
    exit
}

# --- Validasi lokasi folder: peringatan jika di bawah profil pengguna ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$profileRoot = (Split-Path -Parent $env:USERPROFILE).TrimEnd('\') + '\'
if ($scriptDir.StartsWith($profileRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Warning @"
PERINGATAN: Folder proyek berada di dalam profil pengguna ($scriptDir).
Service Windows berjalan sebagai NT AUTHORITY\LocalService dan TIDAK DAPAT
mengakses folder di bawah C:\Users\<nama>. Sangat disarankan untuk memindahkan
proyek ke folder khusus seperti C:\JIBAS_WG sebelum melanjutkan.
"@
}

# --- Bangun argumen untuk diteruskan ke deployment\windows\install.ps1 ---
$forwardArgs = @()
if ($User)             { $forwardArgs += '--user', $User }
if ($Pass)             { $forwardArgs += '--pass', $Pass }
if ($PassFile)         { $forwardArgs += '--pass-file', $PassFile }
if ($CredentialsOnly)  { $forwardArgs += '--credentials-only' }
if ($NoActivateMove)   { $forwardArgs += '--no-activate-move' }
if ($PauseOutbox)      { $forwardArgs += '--pause-outbox' }
if ($DbOnly)           { $forwardArgs += '--db-only' }
if ($Help)             { $forwardArgs += '--help' }

# --- Jalankan installer inti ---
$installScript = Join-Path $scriptDir 'deployment\windows\install.ps1'
if (-not (Test-Path -LiteralPath $installScript -PathType Leaf)) {
    throw "Script installer tidak ditemukan: $installScript"
}

& "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $installScript @forwardArgs
exit $LASTEXITCODE
