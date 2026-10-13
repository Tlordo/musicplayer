@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запускаю музыкальный плеер... Не закрывайте это окно, пока слушаете музыку.
musicplayer.exe --open
pause
