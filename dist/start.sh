#!/bin/sh
# Запуск плеера: откроет браузер на http://localhost:3000
cd "$(dirname "$0")"
for tool in yt-dlp ffmpeg; do
  if ! command -v "$tool" >/dev/null 2>&1 && [ ! -x "./$tool" ] && [ ! -x "./ffmpeg/$tool" ]; then
    echo "Не найден $tool. Установите: brew install yt-dlp ffmpeg  (macOS)"
    echo "                          или: sudo apt install ffmpeg && pip install 'yt-dlp[default]'  (Linux)"
  fi
done
chmod +x ./musicplayer 2>/dev/null
exec ./musicplayer --open "$@"
