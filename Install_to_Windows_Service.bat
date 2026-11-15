@echo off
title Install WAGW PRO Service
echo ===================================================
echo Menginstal WAGW PRO sebagai Windows Service...
echo Akan muncul jendela prompt dari Windows "User Account Control (UAC)".
echo Silakan klik "Yes" untuk mengizinkan bot berjalan di latar belakang.
echo ===================================================
cd /d "%~dp0"
node Install_Service.js
pause
