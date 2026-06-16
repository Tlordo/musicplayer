const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const ytDlp = require('yt-dlp-exec');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Пути
const ffmpegBinary = process.platform === 'win32'
  ? path.join(__dirname, 'ffmpeg', 'ffmpeg.exe')
  : path.join(__dirname, 'ffmpeg', 'ffmpeg');
const InfoFolder = path.join(__dirname, 'Data', 'Info');
const MusicFolder = path.join(__dirname, 'Data', 'Music');
const DB_PATH = path.join(__dirname, 'database.db');

// Создание папок
[InfoFolder, MusicFolder].forEach(folder => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
});

// Глобальная переменная для БД
let db;

// Инициализация SQL.js базы данных
async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Загружаем существующую БД или создаем новую
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  // Создаем таблицы
  db.run(`
    CREATE TABLE IF NOT EXISTS techData (
      video_id TEXT PRIMARY KEY,
      format_id TEXT,
      extension TEXT,
      audio_codec TEXT,
      abr REAL,
      filesize_mb REAL,
      direct_url TEXT,
      original_url TEXT
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS userData (
      video_id TEXT PRIMARY KEY,
      json_file TEXT,
      title TEXT,
      artist TEXT,
      album TEXT,
      track TEXT,
      release_date TEXT,
      duration TEXT,
      view_count INTEGER,
      like_count INTEGER,
      thumbnail_url TEXT,
      FOREIGN KEY (video_id) REFERENCES techData(video_id)
    )
  `);
  
  // Добавляем колонку original_url, если её нет
  try {
    db.run(`ALTER TABLE techData ADD COLUMN original_url TEXT`);
  } catch (e) {
    // колонка уже существует
  }
  
  // Сохраняем БД на диск
  saveDatabase();
  console.log('База данных инициализирована');
}

// Сохранение БД в файл
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Функция сохранения в БД
function addToDatabase(vId, techData, userData, fileName, originalUrl) {
  db.run(`
    INSERT OR REPLACE INTO techData (video_id, format_id, extension, audio_codec, abr, filesize_mb, direct_url, original_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [vId, techData.format_id, techData.extension, techData.audio_codec, techData.abr, techData.filesize_mb, techData.direct_url, originalUrl]);
  
  db.run(`
    INSERT OR REPLACE INTO userData (video_id, json_file, title, artist, album, track, release_date, duration, view_count, like_count, thumbnail_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [vId, fileName, userData.title, userData.artist, userData.album, userData.track, userData.release_date, userData.duration, userData.view_count, userData.like_count, userData.thumbnail_url]);
  
  saveDatabase();
  console.log(`[БД] Запись для ${vId} обновлена.`);
}

// Основная функция загрузки трека
const cookiesPath = path.join(__dirname, 'cookies.txt');

// Основная функция загрузки трека
async function downloadTrack(targetUrl) {
  // 1. Получаем полную информацию (без скачивания) с использованием COOKIES
  const info = await ytDlp(targetUrl, {
    dumpSingleJson: true,
    noWarnings: true,
    ffmpegLocation: ffmpegBinary,
    cookies: cookiesPath // <-- Указываем путь к файлу cookies.txt вместо браузера
  });

  const vId = info.id;
  const bestFormat = info.formats
    .filter(f => f.vcodec === 'none' && f.abr)
    .sort((a, b) => b.abr - a.abr)[0] || info;

  const techData = {
    format_id: bestFormat.format_id,
    extension: bestFormat.ext,
    audio_codec: bestFormat.acodec,
    abr: bestFormat.abr,
    filesize_mb: parseFloat(((bestFormat.filesize || bestFormat.filesize_approx) / (1024 * 1024)).toFixed(2)),
    direct_url: bestFormat.url
  };

  const formatDate = (d) => d ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : 'Unknown';

  const userData = {
    title: info.title,
    artist: info.uploader || 'Unknown',
    album: info.album || 'Single',
    track: info.track || 'Unknown',
    release_date: formatDate(info.upload_date),
    duration: info.duration_string,
    view_count: info.view_count,
    like_count: info.like_count,
    thumbnail_url: info.thumbnails?.at(-1)?.url || ''
  };

  // 2. Скачивание аудио с использованием COOKIES
  const outputPath = path.join(MusicFolder, `${vId}.%(ext)s`);
  console.log(`Скачиваю аудио для ${vId}...`);
  await ytDlp(targetUrl, {
    format: 'bestaudio',
    extractAudio: true,
    audioFormat: 'opus',
    audioQuality: '0',
    path: MusicFolder,
    output: `${vId}.%(ext)s`,
    embedMetadata: true,
    embedThumbnail: true,
    noWarnings: true,
    ffmpegLocation: ffmpegBinary,
    cookies: cookiesPath // <-- И здесь тоже заменяем cookiesFromBrowser на файл
  });
  console.log(`Аудио сохранено: ${vId}.opus`);

  // 3. Скачивание обложки
  const thumbnailUrl = userData.thumbnail_url;
  if (thumbnailUrl) {
    const thumbPath = path.join(InfoFolder, `${vId}.jpg`);
    try {
      const response = await axios({ url: thumbnailUrl, responseType: 'stream' });
      const writer = fs.createWriteStream(thumbPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      console.log(`Обложка сохранена: ${vId}.jpg`);
    } catch (err) {
      console.warn(`Не удалось скачать обложку: ${err.message}`);
    }
  }

  // 4. Запись в БД
  const fileNameBase = userData.title.replace(/[\\\/:*?"<>|]/g, " ").trim().substring(0, 100);
  const userJsonName = `${fileNameBase}_user_info.json`;
  fs.writeFileSync(path.join(InfoFolder, userJsonName), JSON.stringify(userData, null, 4));

  addToDatabase(vId, techData, userData, userJsonName, targetUrl);

  return vId;
}

// Восстановление трека
async function restoreTrack(videoId) {
  const audioPath = path.join(MusicFolder, `${videoId}.opus`);
  if (fs.existsSync(audioPath)) return;

  const url = `https://music.youtube.com/watch?v=${videoId}`;
  console.log(`Восстановление трека ${videoId}...`);
  try {
    await downloadTrack(url);
    console.log(`Трек ${videoId} успешно восстановлен.`);
  } catch (err) {
    console.error(`Ошибка восстановления ${videoId}:`, err.message);
  }
}

// ============= API =============

// Добавление нового трека
app.post('/api/add', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const videoId = await downloadTrack(url);
    
    // Получаем данные из БД
    const stmt = db.prepare(`
      SELECT u.*, t.abr, t.filesize_mb, t.extension
      FROM userData u JOIN techData t ON u.video_id = t.video_id
      WHERE u.video_id = ?
    `);
    stmt.bind([videoId]);
    
    let track = null;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      track = { ...row };
    }
    stmt.free();

    res.json({ success: true, track: { ...track, file_exists: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Библиотека (список треков)
app.get('/api/library', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT u.*, t.abr, t.filesize_mb, t.extension, t.original_url
      FROM userData u JOIN techData t ON u.video_id = t.video_id
      ORDER BY u.artist, u.title
    `);
    
    const tracks = [];
    while (stmt.step()) {
      tracks.push(stmt.getAsObject());
    }
    stmt.free();

    const result = tracks.map(track => {
      const audioPath = path.join(MusicFolder, `${track.video_id}.opus`);
      return {
        ...track,
        file_exists: fs.existsSync(audioPath),
        thumbnail_api: `/api/thumbnail/${track.video_id}`
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Стриминг аудио
app.get('/api/stream/:video_id', async (req, res) => {
  const videoId = req.params.video_id;
  const audioPath = path.join(MusicFolder, `${videoId}.opus`);

  if (!fs.existsSync(audioPath)) {
    const stmt = db.prepare(`SELECT 1 FROM techData WHERE video_id = ?`);
    stmt.bind([videoId]);
    const exists = stmt.step();
    stmt.free();
    
    if (exists) {
      restoreTrack(videoId);
      return res.status(404).json({ 
        restoring: true, 
        message: 'Track is being restored. Please try again in a few seconds.' 
      });
    } else {
      return res.status(404).json({ error: 'Track not found in library' });
    }
  }

  const stat = fs.statSync(audioPath);
  res.writeHead(200, {
    'Content-Type': 'audio/opus',
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes'
  });
  const readStream = fs.createReadStream(audioPath);
  readStream.pipe(res);
});

// Обложка трека
app.get('/api/thumbnail/:video_id', async (req, res) => {
  const videoId = req.params.video_id;
  const thumbPath = path.join(InfoFolder, `${videoId}.jpg`);

  if (fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  const stmt = db.prepare(`SELECT thumbnail_url FROM userData WHERE video_id = ?`);
  stmt.bind([videoId]);
  
  let thumbnailUrl = null;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    thumbnailUrl = row.thumbnail_url;
  }
  stmt.free();

  if (thumbnailUrl) {
    try {
      const response = await axios({ url: thumbnailUrl, responseType: 'stream' });
      const writer = fs.createWriteStream(thumbPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      return res.sendFile(thumbPath);
    } catch (err) {
      console.warn(`Не удалось загрузить обложку: ${err.message}`);
      return res.status(404).json({ error: 'Thumbnail not available' });
    }
  } else {
    return res.status(404).json({ error: 'Thumbnail not found' });
  }
});

// Удаление трека
app.delete('/api/track/:video_id', (req, res) => {
  const videoId = req.params.video_id;
  try {
    db.run(`DELETE FROM techData WHERE video_id = ?`, [videoId]);
    db.run(`DELETE FROM userData WHERE video_id = ?`, [videoId]);
    saveDatabase();

    const audioFile = path.join(MusicFolder, `${videoId}.opus`);
    const thumbFile = path.join(InfoFolder, `${videoId}.jpg`);
    if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
    if (fs.existsSync(thumbFile)) fs.unlinkSync(thumbFile);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Запуск сервера
async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
  });
}

startServer();