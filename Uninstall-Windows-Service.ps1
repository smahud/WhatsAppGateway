<#
.SYNOPSIS
    Cabut layanan Windows JIBAS WhatsApp Gateway.
.DESCRIPTION
    Mencabut registrasi Windows Service JIBAS WG tanpa menghapus database, config, sesi,
    login dashboard, trigger JIBAS, log, atau antrean pesan.
.NOTES
    Jalankan dari PowerShell Administrator:
      .\Uninstall-Windows-Service.ps1
    Atau jika kebijakan script dibatasi:
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-Windows-Service.ps1
    Untuk rollback integrasi, lihat CONTRACT.md.
#>
[CmdletBinding(PositionalBinding=$false)]
param([switch]$Help)

$ErrorActionPreference = 'Stop'

if ($Help) {
    Get-Help $PSCommandPath -Detailed
    exit 0
}

. (Join-Path $PSScriptRoot 'deployment\windows\common.ps1')
Assert-JibasAdmin
$manageScript = Join-Path $PSScriptRoot 'deployment\windows\manage-service.ps1'
if (-not (Test-Path -LiteralPath $manageScript -PathType Leaf)) {
    throw "Script manage-service tidak ditemukan: $manageScript"
}

exit (Invoke-JibasNativeProcess $JibasWindowsPowerShell @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $manageScript, '-Action', 'Uninstall'
))
