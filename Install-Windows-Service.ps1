<#
.SYNOPSIS
    Pasang atau perbaiki layanan Windows JIBAS WhatsApp Gateway.
.DESCRIPTION
    Instalasi normal memasang integrasi JIBAS dan mengaktifkan MOVE.
    Hentikan consumer SMS lama dan tinjau antrean sebelum cutover.
    Pada pemasangan pertama tanpa opsi login, simpan password admin yang dicetak sekali.
.PARAMETER User
    Username dashboard. Jika hanya User diisi, password baru dibuat otomatis.
.PARAMETER Pass
    Password dashboard. Gunakan PassFile agar password tidak masuk riwayat shell.
.PARAMETER PassFile
    Path file privat UTF-8 berisi satu baris password dashboard.
.PARAMETER CredentialsOnly
    Ubah login dashboard tanpa mengubah database atau me-restart layanan.
.PARAMETER NoActivateMove
    Pasang integrasi JIBAS dengan MOVE dijeda.
.PARAMETER PauseOutbox
    Jeda MOVE dan jangan kirim pesan dari antrean gateway dalam proses ini.
.PARAMETER DbOnly
    Diagnostik schema JIBAS yang sudah siap, tanpa mengubah DB atau menghubungkan WhatsApp.
.PARAMETER Help
    Tampilkan bantuan tanpa menjalankan instalasi.
.NOTES
    Jalankan dari PowerShell Administrator:
      .\Install-Windows-Service.ps1
    Atau jika kebijakan script dibatasi:
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Windows-Service.ps1
#>
[CmdletBinding(PositionalBinding=$false)]
param(
    [ValidateNotNullOrEmpty()][string]$User,
    [ValidateNotNullOrEmpty()][string]$Pass,
    [ValidateNotNullOrEmpty()][string]$PassFile,
    [switch]$CredentialsOnly,
    [switch]$NoActivateMove,
    [switch]$PauseOutbox,
    [switch]$DbOnly,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
    Get-Help $PSCommandPath -Detailed
    exit 0
}

. (Join-Path $PSScriptRoot 'deployment\windows\common.ps1')
# Keep the one-time login password visible in the operator's own terminal.
Assert-JibasAdmin

$profileRoot = (Split-Path -Parent $env:USERPROFILE).TrimEnd('\') + '\'
if ($PSScriptRoot.StartsWith($profileRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Warning @"
Folder proyek berada di dalam profil pengguna ($PSScriptRoot).
Service Windows berjalan sebagai NT AUTHORITY\LocalService dan TIDAK DAPAT
mengakses folder di bawah C:\Users\<nama>. Sangat disarankan untuk memindahkan
proyek ke folder khusus seperti C:\JIBAS_WG sebelum melanjutkan.
"@
}

$forwardArgs = @()
if ($User)             { $forwardArgs += '--user', $User }
if ($Pass)             { $forwardArgs += '--pass', $Pass }
if ($PassFile)         { $forwardArgs += '--pass-file', $PassFile }
if ($CredentialsOnly)  { $forwardArgs += '--credentials-only' }
if ($NoActivateMove)   { $forwardArgs += '--no-activate-move' }
if ($PauseOutbox)      { $forwardArgs += '--pause-outbox' }
if ($DbOnly)           { $forwardArgs += '--db-only' }

$installScript = Join-Path $PSScriptRoot 'deployment\windows\install.ps1'
if (-not (Test-Path -LiteralPath $installScript -PathType Leaf)) {
    throw "Script installer tidak ditemukan: $installScript"
}

exit (Invoke-JibasNativeProcess $JibasWindowsPowerShell (@(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installScript
) + $forwardArgs))
