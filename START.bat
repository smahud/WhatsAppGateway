@echo off
TITLE WAGW PRO Launcher
cd /d "%~dp0"
echo Memulai WAGW PRO di latar belakang...

:: Baca port dari config.json (Default: 3000)
for /f "usebackq" %%p in (`powershell -NoProfile -Command "(Get-Content config.json -Raw | ConvertFrom-Json).port"`) do set PORT=%%p
if "%PORT%"=="" set PORT=3000

:: Eksekusi via PowerShell dengan secara portabel menggunakan node.exe lokal
powershell -WindowStyle Hidden -Command "Start-Process '%~dp0node.exe' -ArgumentList 'wabot.js' -WindowStyle Hidden -RedirectStandardOutput 'output_log.txt' -RedirectStandardError 'error_log.txt' -WorkingDirectory '%~dp0'"

echo Tunggu sebentar, sedang menyiapkan Web Server di port %PORT%...
timeout /t 3 /nobreak > NUL

:: Buka browser ke Dashboard
start http://localhost:%PORT%
exit
