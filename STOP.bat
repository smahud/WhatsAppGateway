@echo off
title Mematikan WAGW PRO
echo Mematikan WAGW PRO yang berjalan di Latar Belakang...
taskkill /F /IM node.exe > NUL 2>&1
echo WAGW PRO berhasil dimatikan secara paksa!
pause
exit
