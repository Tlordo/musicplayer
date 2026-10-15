# Сборка переносной «Моя музыка» для Windows: dist\MyMusic-Windows\ и dist\MyMusic-Windows.zip.
#
#   powershell -ExecutionPolicy Bypass -File tools\package-windows.ps1
#   powershell -ExecutionPolicy Bypass -File tools\package-windows.ps1 -Toolchain stable-x86_64-pc-windows-gnu
#
# В папку кладутся: «Моя музыка.exe» (окно), music-player.exe (только сервер), public\,
# bin\yt-dlp.exe и ffmpeg\ffmpeg.exe — их скрипт берёт с этого компьютера (проект, PATH).
# Данные (музыка, база) появятся рядом в Data\ при первом запуске — папку можно переносить целиком.

param([string]$Toolchain = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$cargoArgs = @()
if ($Toolchain) { $cargoArgs += "+$Toolchain" }
$cargoArgs += @("build", "--release", "--features", "desktop")
& cargo @cargoArgs
if ($LASTEXITCODE -ne 0) { throw "сборка не удалась" }

$dist = Join-Path $root "dist\MyMusic-Windows"
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force $dist, "$dist\bin", "$dist\ffmpeg" | Out-Null

Copy-Item "target\release\mk60-desktop.exe" (Join-Path $dist "Моя музыка.exe")
Copy-Item "target\release\music-player.exe" $dist
Copy-Item -Recurse "public" "$dist\public"
# Ничего личного из папки проекта в сборку не попадает.
Get-ChildItem "$dist\public" -Recurse -Include *.env | Remove-Item -Force

function First-Existing([string[]]$paths) { $paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1 }

$yt = First-Existing @("$root\bin\yt-dlp.exe", "$root\yt-dlp.exe", (Get-Command yt-dlp.exe -ErrorAction SilentlyContinue).Source)
if ($yt) { Copy-Item $yt "$dist\bin\yt-dlp.exe"; Write-Host "yt-dlp: $yt" }
else { Write-Warning "yt-dlp.exe не найден — положите его в $dist\bin\ (https://github.com/yt-dlp/yt-dlp/releases)" }

$ff = First-Existing @("$root\ffmpeg\ffmpeg.exe", (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue).Source)
if ($ff) {
  Copy-Item $ff "$dist\ffmpeg\ffmpeg.exe"
  $probe = Join-Path (Split-Path $ff) "ffprobe.exe"
  if (Test-Path $probe) { Copy-Item $probe "$dist\ffmpeg\" }
  Write-Host "ffmpeg: $ff"
} else { Write-Warning "ffmpeg.exe не найден — положите его в $dist\ffmpeg\ (https://www.gyan.dev/ffmpeg/builds/)" }

@"
Моя музыка — переносная версия для Windows

Запуск: «Моя музыка.exe». Музыка и база хранятся рядом, в папке Data — переносите папку целиком.
При первом запуске Windows спросит про доступ в сеть: разрешите «Частные сети», тогда плеер
откроется и с телефона (адрес и QR-код — в настройках, раздел «Подключить телефон»).

music-player.exe — тот же плеер без окна (только сервер), если нужно держать его в фоне.
Если треки перестали скачиваться — настройки → «Обновить yt-dlp».
Закрытый контент YouTube: положите cookies.txt рядом с программой.
"@ | Set-Content -Encoding utf8 "$dist\ПРОЧТИ.txt"

$zip = Join-Path $root "dist\MyMusic-Windows.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $dist -DestinationPath $zip
Write-Host "Готово: $dist"
Write-Host "Архив:  $zip"
