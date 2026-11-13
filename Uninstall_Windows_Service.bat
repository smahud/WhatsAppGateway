@echo off
title Uninstall WAGW PRO Service
echo ===================================================
echo Menghapus Windows Service WAGW PRO...
echo Akan muncul jendela prompt dari Windows "User Account Control (UAC)".
echo Silakan klik "Yes" untuk menghapus WAGW PRO.
echo ===================================================
cd /d "%~dp0"
node Uninstall_Service.js
pause
