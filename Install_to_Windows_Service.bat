@echo off
rem JIBAS WhatsApp Gateway installer - Wrapper kompatibilitas
rem Script utama: Install-Windows-Service.ps1
rem File .bat ini dipertahankan untuk backward-compatibility (klik-dua-kali dari Explorer).
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\windows\install.ps1" %*
exit /b %errorlevel%
