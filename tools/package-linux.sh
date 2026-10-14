#!/usr/bin/env bash
# Сборка «Моя музыка» для Linux: dist/MyMusic-Linux/ и dist/MyMusic-Linux.tar.gz.
#
# Нужно один раз (Debian/Ubuntu):
#   sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev ffmpeg
#   pipx install yt-dlp        # или: sudo apt install yt-dlp (но он часто устаревший)
# Fedora: sudo dnf install webkit2gtk4.1-devel gtk3-devel ffmpeg yt-dlp
# Arch:   sudo pacman -S webkit2gtk-4.1 gtk3 ffmpeg yt-dlp
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build --release --features desktop

dist=dist/MyMusic-Linux
rm -rf "$dist"
mkdir -p "$dist"
cp target/release/mk60-desktop "$dist/my-music"
cp target/release/music-player "$dist/"
cp -r public "$dist/public"
find "$dist/public" -name '*.env' -delete
cp assets/icon.png "$dist/icon.png"

cat > "$dist/install-menu-entry.sh" <<'EOF'
#!/usr/bin/env bash
# Добавить «Моя музыка» в меню приложений (для текущего пользователя).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/my-music.desktop <<DESKTOP
[Desktop Entry]
Type=Application
Name=Моя музыка
Comment=Своя медиатека: музыка с YouTube, альбомы, текст песни
Exec="$here/my-music"
Path=$here
Icon=$here/icon.png
Terminal=false
Categories=AudioVideo;Audio;Player;
DESKTOP
echo "Готово: «Моя музыка» появится в меню приложений."
EOF
chmod +x "$dist/install-menu-entry.sh" "$dist/my-music" "$dist/music-player"

cat > "$dist/ПРОЧТИ.txt" <<'EOF'
Моя музыка — версия для Linux

Запуск: ./my-music (окно) или ./music-player (только сервер).
yt-dlp и ffmpeg берутся из системы (PATH). Данные — рядом, в папке Data.
В меню приложений: ./install-menu-entry.sh
Телефон в той же сети: адрес и QR-код — в настройках, раздел «Подключить телефон».
EOF

tar -C dist -czf dist/MyMusic-Linux.tar.gz MyMusic-Linux
echo "Готово: $dist и dist/MyMusic-Linux.tar.gz"
