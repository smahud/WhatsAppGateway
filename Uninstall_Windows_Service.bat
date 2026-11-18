@echo off
rem JIBAS WhatsApp Gateway uninstaller - Wrapper kompatibilitas
rem Script utama: Uninstall-Windows-Service.ps1
rem File .bat ini dipertahankan untuk backward-compatibility (klik-dua-kali dari Explorer).
setlocal DisableDelayedExpansion
if /i "%~1"=="--help" (
    echo JIBAS WhatsApp Gateway - hapus service tanpa menghapus DB, sesi, config, atau login.
    echo Script utama: Uninstall-Windows-Service.ps1
    exit /b 0
)
if not "%~1"=="" (
    echo Opsi tidak dikenal. Gunakan Uninstall-Windows-Service.ps1 --help.
    exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\windows\manage-service.ps1" -Action Uninstall
exit /b %errorlevel%
