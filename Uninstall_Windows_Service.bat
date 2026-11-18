@echo off
setlocal DisableDelayedExpansion
if /i "%~1"=="--help" (
    echo JIBAS WhatsApp Gateway - hapus service tanpa menghapus DB, sesi, config, atau login.
    exit /b 0
)
if not "%~1"=="" (
    echo Opsi tidak dikenal. Gunakan Uninstall_Windows_Service.bat --help.
    exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\windows\manage-service.ps1" -Action Uninstall
exit /b %errorlevel%
