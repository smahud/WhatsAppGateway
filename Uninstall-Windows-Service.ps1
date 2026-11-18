<#
.SYNOPSIS
    JIBAS WhatsApp Gateway - Script Pencabutan Windows Service (PowerShell Native)
.DESCRIPTION
    Menggantikan Uninstall_Windows_Service.bat. Mencabut registrasi
    Windows Service JIBAS WG tanpa menghapus database, config, sesi,
    login dashboard, trigger JIBAS, log, atau antrean pesan.
.NOTES
    Jalankan dari PowerShell Administrator:
      .\Uninstall-Windows-Service.ps1
    Atau jika kebijakan script dibatasi:
      powershell -ExecutionPolicy Bypass -File .\Uninstall-Windows-Service.ps1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)][switch]$Help
)

$ErrorActionPreference = 'Stop'

# --- Auto-Elevation ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Warning "Skrip ini memerlukan hak Administrator untuk mencabut Windows Service."
    Write-Host "Membuka sesi PowerShell Administrator baru..." -ForegroundColor Cyan
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($Help) { $argList += " -Help" }
    Start-Process powershell.exe -ArgumentList $argList -Verb RunAs
    exit
}

# --- Help ---
if ($Help) {
    Write-Output @"
JIBAS WhatsApp Gateway - Hapus service Windows tanpa menghapus data.

Penggunaan:
  .\Uninstall-Windows-Service.ps1

Yang TIDAK dihapus oleh uninstall:
  - Database gateway (jibas_wg / wagw)
  - config.json dan dashboard-auth.json
  - Sesi WhatsApp (folder sessions/)
  - Trigger JIBAS pada jbssms.outbox
  - Log di daemon/logs/
  - Antrean pesan yang sudah dipindahkan

Untuk rollback lengkap, ikuti panduan di CONTRACT.md.
"@
    exit 0
}

# --- Jalankan pencabutan service ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$manageScript = Join-Path $scriptDir 'deployment\windows\manage-service.ps1'
if (-not (Test-Path -LiteralPath $manageScript -PathType Leaf)) {
    throw "Script manage-service tidak ditemukan: $manageScript"
}

& "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $manageScript -Action Uninstall
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "Service JIBAS WG berhasil dicabut." -ForegroundColor Green
    Write-Host "Data yang dipertahankan:" -ForegroundColor Cyan
    Write-Host "  - Database (jibas_wg / wagw)"
    Write-Host "  - config.json & dashboard-auth.json"
    Write-Host "  - Sesi WhatsApp (sessions/)"
    Write-Host "  - Trigger JIBAS"
    Write-Host "  - Log (daemon/logs/)"
    Write-Host ""
}

exit $exitCode
