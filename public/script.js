// ============ DOM элементы ============
const audio = document.getElementById('audio');
const visualizer = document.getElementById('visualizer');
const visualizerCtx = visualizer.getContext('2d');
const sidebar = document.getElementById('sidebar');
const showSidebarBtn = document.getElementById('show-sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const searchInput = document.getElementById('search-input');
const clearSearch = document.getElementById('clear-search');
const trackCount = document.getElementById('track-count');
const totalDuration = document.getElementById('total-duration');
const playlistList = document.getElementById('playlist-list');
const playlistGrid = document.getElementById('playlist-grid');
const playlistCompact = document.getElementById('playlist-compact');
const playlistTable = document.getElementById('playlist-table');
const tableBody = document.getElementById('table-body');
const nowPlayingTitle = document.getElementById('track-title');
const nowPlayingArtist = document.getElementById('track-artist');
const trackAlbum = document.getElementById('track-album');
const trackYear = document.getElementById('track-year');
const trackQuality = document.getElementById('track-quality');
const trackViews = document.getElementById('track-views');
const trackLikes = document.getElementById('track-likes');
const trackBitrate = document.getElementById('track-bitrate');
const coverImg = document.getElementById('cover');
const backgroundBlur = document.getElementById('background-blur');
const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const shuffleBtn = document.getElementById('shuffle-btn');
const repeatBtn = document.getElementById('repeat-btn');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const progressHover = document.getElementById('progress-hover');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const volumeSlider = document.getElementById('volume-slider');
const volumeBtn = document.getElementById('volume-btn');
const speedBtn = document.getElementById('speed-btn');
const speedOptions = document.getElementById('speed-options');
const visualizerBtn = document.getElementById('visualizer-btn');
const waveform = document.getElementById('waveform');
const notifications = document.getElementById('notifications');
const addModal = document.getElementById('add-modal');
const coverModal = document.getElementById('cover-modal');
const infoModal = document.getElementById('info-modal');
const downloadProgress = document.getElementById('download-progress');
const progressFillMini = document.getElementById('progress-fill-mini');
const progressText = document.getElementById('progress-text');

// ============ Состояние ============
let library = [];
let filteredLibrary = [];
let currentTrackIndex = -1;
let isPlaying = false;
let isShuffled = false;
let repeatMode = 'off';
let currentSpeed = 1;
let sortMode = 'default';
let viewMode = 'list';
let previousVolume = 0.75;
let audioContext = null;
let analyser = null;
let animationId = null;
let showVisualizer = true;
let eqValues = {};

// ============ Инициализация аудиоконтекста ============
function initAudioContext() {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioContext.destination);
    } catch (e) {
      console.warn('Web Audio API не поддерживается');
    }
  }
}

// ============ Утилиты ============
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function showNotification(message, type = 'info') {
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <i class="fas ${icons[type]}"></i>
    <span class="message">${message}</span>
    <button class="close-notification">&times;</button>
  `;
  notifications.appendChild(notification);
  notification.querySelector('.close-notification').addEventListener('click', () => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100px)';
    setTimeout(() => notification.remove(), 300);
  });
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100px)';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// ============ Загрузка библиотеки ============
async function loadLibrary() {
  try {
    const res = await fetch('/api/library');
    library = await res.json();
    applyFilters();
    updateStats();
  } catch (err) {
    console.error('Ошибка загрузки библиотеки:', err);
    showNotification('Ошибка загрузки библиотеки', 'error');
  }
}

function applyFilters() {
  const query = searchInput.value.toLowerCase();
  filteredLibrary = library.filter(track =>
    track.title.toLowerCase().includes(query) ||
    track.artist.toLowerCase().includes(query) ||
    track.album.toLowerCase().includes(query)
  );
  
  clearSearch.classList.toggle('hidden', !query);
  
  switch(sortMode) {
    case 'title': filteredLibrary.sort((a, b) => a.title.localeCompare(b.title)); break;
    case 'artist': filteredLibrary.sort((a, b) => a.artist.localeCompare(b.artist)); break;
    case 'album': filteredLibrary.sort((a, b) => a.album.localeCompare(b.album)); break;
  }
  
  renderAllViews();
}

function updateStats() {
  trackCount.textContent = `${library.length} треков`;
  let totalSecs = 0;
  library.forEach(track => {
    const parts = track.duration.split(':');
    if (parts.length === 2) totalSecs += parseInt(parts[0]) * 60 + parseInt(parts[1]);
  });
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  totalDuration.textContent = hours > 0 ? `${hours} ч ${mins} мин` : `${mins} мин`;
}

// ============ Отрисовка всех представлений ============
function renderAllViews() {
  renderListView();
  renderGridView();
  renderCompactView();
  renderTableView();
}

function renderListView() {
  playlistList.innerHTML = '';
  filteredLibrary.forEach((track, i) => {
    const originalIndex = library.indexOf(track);
    const li = document.createElement('li');
    li.dataset.index = originalIndex;
    li.classList.toggle('active', originalIndex === currentTrackIndex);
    li.innerHTML = `
      <span class="track-number">${i + 1}</span>
      <span class="playing-indicator"><i class="fas fa-volume-up"></i></span>
      <img class="track-thumb" src="${track.thumbnail_api || ''}" alt="" loading="lazy">
      <div class="track-info">
        <div class="track-title-list">${escapeHtml(track.title)}</div>
        <div class="track-artist-list">${escapeHtml(track.artist)}</div>
      </div>
      <span class="track-duration-list">${track.duration}</span>
      ${!track.file_exists ? '<span class="restoring-badge">Восст.</span>' : ''}
    `;
    li.addEventListener('click', () => playTrack(originalIndex));
    li.addEventListener('contextmenu', (e) => showContextMenu(e, originalIndex));
    li.draggable = true;
    li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', originalIndex));
    playlistList.appendChild(li);
  });
}

function renderGridView() {
  playlistGrid.innerHTML = '';
  filteredLibrary.forEach((track, i) => {
    const originalIndex = library.indexOf(track);
    const div = document.createElement('div');
    div.className = 'grid-item';
    div.dataset.index = originalIndex;
    div.classList.toggle('active', originalIndex === currentTrackIndex);
    div.innerHTML = `
      <img class="grid-thumb" src="${track.thumbnail_api || ''}" alt="" loading="lazy">
      <div class="grid-title">${escapeHtml(track.title)}</div>
      <div class="grid-artist">${escapeHtml(track.artist)}</div>
    `;
    div.addEventListener('click', () => playTrack(originalIndex));
    div.addEventListener('contextmenu', (e) => showContextMenu(e, originalIndex));
    playlistGrid.appendChild(div);
  });
}

function renderCompactView() {
  playlistCompact.innerHTML = '';
  filteredLibrary.forEach((track, i) => {
    const originalIndex = library.indexOf(track);
    const li = document.createElement('li');
    li.dataset.index = originalIndex;
    li.classList.toggle('active', originalIndex === currentTrackIndex);
    li.innerHTML = `
      <img class="track-thumb" src="${track.thumbnail_api || ''}" alt="" loading="lazy">
      <div class="track-info">
        <div class="track-title-list">${escapeHtml(track.title)}</div>
        <div class="track-artist-list">${escapeHtml(track.artist)} • ${track.duration}</div>
      </div>
    `;
    li.addEventListener('click', () => playTrack(originalIndex));
    li.addEventListener('contextmenu', (e) => showContextMenu(e, originalIndex));
    playlistCompact.appendChild(li);
  });
}

function renderTableView() {
  tableBody.innerHTML = '';
  filteredLibrary.forEach((track, i) => {
    const originalIndex = library.indexOf(track);
    const tr = document.createElement('tr');
    tr.dataset.index = originalIndex;
    tr.classList.toggle('active', originalIndex === currentTrackIndex);
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><img class="table-thumb" src="${track.thumbnail_api || ''}" alt="" loading="lazy"></td>
      <td title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</td>
      <td title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</td>
      <td title="${escapeHtml(track.album)}">${escapeHtml(track.album)}</td>
      <td>${track.duration}</td>
    `;
    tr.addEventListener('click', () => playTrack(originalIndex));
    tr.addEventListener('contextmenu', (e) => showContextMenu(e, originalIndex));
    tableBody.appendChild(tr);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ Переключение представлений ============
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    viewMode = btn.dataset.view;
    updateViewVisibility();
  });
});

function updateViewVisibility() {
  playlistList.classList.toggle('hidden', viewMode !== 'list');
  playlistGrid.classList.toggle('hidden', viewMode !== 'grid');
  playlistCompact.classList.toggle('hidden', viewMode !== 'compact');
  playlistTable.classList.toggle('hidden', viewMode !== 'table');
}

// ============ Контекстное меню ============
function showContextMenu(e, index) {
  e.preventDefault();
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();
  
  const track = library[index];
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 240)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`;
  
  menu.innerHTML = `
    <button onclick="playTrack(${index}); this.parentElement.remove();">
      <i class="fas fa-play"></i> Воспроизвести
    </button>
    <button onclick="addToQueue(${index}); this.parentElement.remove();">
      <i class="fas fa-list"></i> Добавить в очередь
    </button>
    <button onclick="showTrackInfo(${index}); this.parentElement.remove();">
      <i class="fas fa-info-circle"></i> Информация
    </button>
    <div class="divider"></div>
    <button onclick="downloadTrackFile(${index}); this.parentElement.remove();">
      <i class="fas fa-download"></i> Скачать
    </button>
    <button onclick="deleteTrackFromMenu(${index}); this.parentElement.remove();">
      <i class="fas fa-trash"></i> Удалить
    </button>
  `;
  
  document.body.appendChild(menu);
  document.addEventListener('click', () => menu.remove(), { once: true });
}

// ============ Воспроизведение ============
function playTrack(index) {
  if (index < 0 || index >= library.length) return;
  
  currentTrackIndex = index;
  const track = library[index];
  
  initAudioContext();
  
  nowPlayingTitle.textContent = track.title;
  nowPlayingArtist.textContent = track.artist;
  trackAlbum.textContent = track.album;
  trackYear.textContent = track.release_date?.split('.')[2] || '';
  trackQuality.textContent = track.abr ? `${Math.round(track.abr)} kbps` : 'HQ';
  trackViews.innerHTML = `<i class="fas fa-eye"></i> ${formatNumber(track.view_count)}`;
  trackLikes.innerHTML = `<i class="fas fa-heart"></i> ${formatNumber(track.like_count)}`;
  trackBitrate.innerHTML = `<i class="fas fa-wave-square"></i> ${track.abr ? Math.round(track.abr) : '?'} kbps`;
  
  const thumbUrl = track.thumbnail_api || '';
  coverImg.src = thumbUrl;
  backgroundBlur.style.backgroundImage = `url(${thumbUrl})`;
  
  audio.src = `/api/stream/${track.video_id}`;
  audio.load();
  
  audio.play().then(() => {
    isPlaying = true;
    updatePlayButton();
    renderAllViews();
    startVisualizer();
    generateWaveform();
    if (isMobile()) switchMobileTab('player');
  }).catch(err => {
    console.warn('Ошибка воспроизведения:', err);
    handlePlaybackError(track, index);
  });
  
  // Сохраняем последний трек в localStorage
  localStorage.setItem('lastTrack', index);
}

function handlePlaybackError(track, index) {
  if (!track.file_exists) {
    showNotification('Трек восстанавливается...', 'warning');
    library[index].file_exists = false;
    renderAllViews();
    fetch(`/api/stream/${track.video_id}`)
      .then(res => res.json())
      .then(data => {
        if (data.restoring) {
          setTimeout(() => {
            library[index].file_exists = true;
            renderAllViews();
            playTrack(index);
          }, 5000);
        }
      });
  } else {
    showNotification('Ошибка воспроизведения', 'error');
  }
}

function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play();
    isPlaying = true;
    startVisualizer();
  } else {
    audio.pause();
    isPlaying = false;
    stopVisualizer();
  }
  updatePlayButton();
}

function updatePlayButton() {
  const icon = isPlaying ? 'fa-pause' : 'fa-play';
  playBtn.innerHTML = `<i class="fas ${icon}"></i>`;
}

function playNext() {
  if (library.length === 0) return;
  let nextIndex;
  if (isShuffled) {
    nextIndex = Math.floor(Math.random() * library.length);
  } else {
    nextIndex = currentTrackIndex + 1;
    if (nextIndex >= library.length) {
      if (repeatMode === 'all') nextIndex = 0;
      else { isPlaying = false; updatePlayButton(); return; }
    }
  }
  playTrack(nextIndex);
}

function playPrevious() {
  if (library.length === 0) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let prevIndex;
  if (isShuffled) prevIndex = Math.floor(Math.random() * library.length);
  else { prevIndex = currentTrackIndex - 1; if (prevIndex < 0) prevIndex = repeatMode === 'all' ? library.length - 1 : -1; }
  if (prevIndex >= 0) playTrack(prevIndex);
}

// ============ Прогресс ============
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const progress = (audio.currentTime / audio.duration) * 100;
  progressFill.style.width = `${progress}%`;
  currentTimeEl.textContent = formatTime(audio.currentTime);
  updateWaveformProgress();
});

audio.addEventListener('loadedmetadata', () => {
  totalTimeEl.textContent = formatTime(audio.duration);
  generateWaveform();
});

progressBar.addEventListener('click', (e) => {
  const rect = progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  audio.currentTime = (clickX / rect.width) * audio.duration;
});

progressBar.addEventListener('mousemove', (e) => {
  const rect = progressBar.getBoundingClientRect();
  const x = e.clientX - rect.left;
  progressHover.style.width = `${(x / rect.width) * 100}%`;
});

progressBar.addEventListener('mouseleave', () => {
  progressHover.style.width = '0';
});

// ============ Генерация волновой формы ============
function generateWaveform() {
  waveform.innerHTML = '';
  const bars = 80;
  for (let i = 0; i < bars; i++) {
    const bar = document.createElement('div');
    bar.className = 'waveform-bar';
    bar.style.height = `${Math.random() * 40 + 5}px`;
    waveform.appendChild(bar);
  }
}

function updateWaveformProgress() {
  if (!audio.duration) return;
  const progress = audio.currentTime / audio.duration;
  const bars = waveform.children;
  const playedCount = Math.floor(progress * bars.length);
  Array.from(bars).forEach((bar, i) => {
    bar.classList.toggle('played', i < playedCount);
  });
}

// ============ Визуализатор ============
function startVisualizer() {
  if (!showVisualizer || !analyser) return;
  visualizer.classList.remove('hidden');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function draw() {
    animationId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    
    visualizerCtx.clearRect(0, 0, visualizer.width, visualizer.height);
    visualizer.width = visualizer.offsetWidth;
    visualizer.height = visualizer.offsetHeight;
    
    const barWidth = (visualizer.width / bufferLength) * 2.5;
    let x = 0;
    
    // Градиент
    const gradient = visualizerCtx.createLinearGradient(0, 0, 0, visualizer.height);
    gradient.addColorStop(0, 'rgba(29, 185, 84, 0.8)');
    gradient.addColorStop(0.5, 'rgba(78, 205, 196, 0.6)');
    gradient.addColorStop(1, 'rgba(29, 185, 84, 0.1)');
    
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * visualizer.height * 0.8;
      visualizerCtx.fillStyle = gradient;
      
      // Закругленные бары
      const radius = Math.min(barWidth / 2, 4);
      visualizerCtx.beginPath();
      visualizerCtx.roundRect(x, visualizer.height - barHeight, barWidth - 1, barHeight, [radius, radius, 0, 0]);
      visualizerCtx.fill();
      
      x += barWidth;
    }
  }
  
  draw();
}

function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// ============ Громкость ============
volumeSlider.addEventListener('input', () => {
  audio.volume = volumeSlider.value / 100;
  updateVolumeIcon();
});

function updateVolumeIcon() {
  const vol = audio.volume;
  const icon = volumeBtn.querySelector('i');
  icon.className = vol === 0 ? 'fas fa-volume-mute' : vol < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up';
}

volumeBtn.addEventListener('click', () => {
  if (audio.volume > 0) {
    previousVolume = audio.volume;
    audio.volume = 0;
    volumeSlider.value = 0;
  } else {
    audio.volume = previousVolume;
    volumeSlider.value = previousVolume * 100;
  }
  updateVolumeIcon();
});

// ============ Скорость ============
speedBtn.addEventListener('click', () => speedOptions.classList.toggle('visible'));
speedOptions.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') {
    const speed = parseFloat(e.target.dataset.speed);
    audio.playbackRate = speed;
    currentSpeed = speed;
    speedBtn.querySelector('span').textContent = `${speed}x`;
    speedOptions.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    speedOptions.classList.remove('visible');
  }
});

// ============ Режимы ============
shuffleBtn.addEventListener('click', () => {
  isShuffled = !isShuffled;
  shuffleBtn.classList.toggle('active', isShuffled);
  showNotification(isShuffled ? 'Перемешивание включено' : 'Перемешивание выключено', 'info');
});

repeatBtn.addEventListener('click', () => {
  const modes = ['off', 'one', 'all'];
  repeatMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
  repeatBtn.classList.toggle('active', repeatMode !== 'off');
  const labels = { off: 'Повтор выключен', one: 'Повтор одного трека', all: 'Повтор плейлиста' };
  showNotification(labels[repeatMode], 'info');
  
  const badge = repeatBtn.querySelector('.repeat-badge');
  if (repeatMode === 'one') {
    if (!badge) {
      const b = document.createElement('span');
      b.className = 'repeat-badge';
      b.textContent = '1';
      b.style.cssText = 'position:absolute;top:2px;right:2px;font-size:8px;font-weight:bold;';
      repeatBtn.style.position = 'relative';
      repeatBtn.appendChild(b);
    }
  } else if (badge) badge.remove();
});

// ============ Визуализатор ============
visualizerBtn.addEventListener('click', () => {
  showVisualizer = !showVisualizer;
  visualizerBtn.classList.toggle('active', showVisualizer);
  if (showVisualizer && isPlaying) startVisualizer();
  else { stopVisualizer(); visualizer.classList.add('hidden'); }
});

// ============ Сайдбар ============
toggleSidebarBtn.addEventListener('click', () => {
  sidebar.classList.add('collapsed');
  showSidebarBtn.classList.remove('hidden');
});

showSidebarBtn.addEventListener('click', () => {
  sidebar.classList.remove('collapsed');
  showSidebarBtn.classList.add('hidden');
});

// ============ Поиск и сортировка ============
searchInput.addEventListener('input', applyFilters);
clearSearch.addEventListener('click', () => { searchInput.value = ''; applyFilters(); });

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sortMode = btn.dataset.sort;
    applyFilters();
  });
});

// ============ Модальные окна ============
document.getElementById('add-btn').addEventListener('click', () => addModal.classList.remove('hidden'));
document.getElementById('cancel-add').addEventListener('click', () => addModal.classList.add('hidden'));
document.getElementById('submit-add').addEventListener('click', async () => {
  const url = document.getElementById('url-input').value.trim();
  if (!url) return;
  
  const addStatus = document.getElementById('add-status');
  addStatus.textContent = 'Загрузка...';
  addStatus.className = 'status-message';
  document.getElementById('submit-add').disabled = true;
  downloadProgress.classList.remove('hidden');
  
  try {
    const res = await fetch('/api/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    
    if (data.success) {
      addStatus.textContent = 'Трек успешно добавлен!';
      addStatus.className = 'status-message success';
      showNotification('Трек добавлен в библиотеку', 'success');
      await loadLibrary();
      document.getElementById('url-input').value = '';
      setTimeout(() => addModal.classList.add('hidden'), 1500);
    } else {
      addStatus.textContent = `Ошибка: ${data.error}`;
      addStatus.className = 'status-message error';
    }
  } catch (err) {
    addStatus.textContent = 'Ошибка сети';
    addStatus.className = 'status-message error';
  } finally {
    document.getElementById('submit-add').disabled = false;
    downloadProgress.classList.add('hidden');
  }
});

document.getElementById('expand-cover').addEventListener('click', () => {
  document.getElementById('cover-full').src = coverImg.src;
  coverModal.classList.remove('hidden');
});

// Информация о треке
function showTrackInfo(index) {
  const track = library[index];
  document.getElementById('track-info-content').innerHTML = `
    <div class="track-info-detail">
      <div class="info-row"><span class="label">Название</span><span class="value">${escapeHtml(track.title)}</span></div>
      <div class="info-row"><span class="label">Исполнитель</span><span class="value">${escapeHtml(track.artist)}</span></div>
      <div class="info-row"><span class="label">Альбом</span><span class="value">${escapeHtml(track.album)}</span></div>
      <div class="info-row"><span class="label">Дата релиза</span><span class="value">${track.release_date}</span></div>
      <div class="info-row"><span class="label">Длительность</span><span class="value">${track.duration}</span></div>
      <div class="info-row"><span class="label">Просмотры</span><span class="value">${formatNumber(track.view_count)}</span></div>
      <div class="info-row"><span class="label">Лайки</span><span class="value">${formatNumber(track.like_count)}</span></div>
      <div class="info-row"><span class="label">Битрейт</span><span class="value">${track.abr ? Math.round(track.abr) + ' kbps' : 'N/A'}</span></div>
      <div class="info-row"><span class="label">Размер</span><span class="value">${track.filesize_mb ? track.filesize_mb + ' MB' : 'N/A'}</span></div>
      <div class="info-row"><span class="label">Формат</span><span class="value">${track.extension || 'opus'}</span></div>
    </div>
  `;
  infoModal.classList.remove('hidden');
}

// Закрытие модальных окон
document.querySelectorAll('.close-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    addModal.classList.add('hidden');
    coverModal.classList.add('hidden');
    infoModal.classList.add('hidden');
  });
});

window.addEventListener('click', (e) => {
  if (e.target === addModal) addModal.classList.add('hidden');
  if (e.target === coverModal) coverModal.classList.add('hidden');
  if (e.target === infoModal) infoModal.classList.add('hidden');
});

// ============ Скачивание и удаление ============
document.getElementById('download-btn').addEventListener('click', () => {
  if (currentTrackIndex === -1) return;
  downloadTrackFile(currentTrackIndex);
});

function downloadTrackFile(index) {
  const track = library[index];
  const a = document.createElement('a');
  a.href = `/api/stream/${track.video_id}`;
  a.download = `${track.artist} - ${track.title}.opus`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showNotification('Скачивание началось', 'success');
}

document.getElementById('delete-btn').addEventListener('click', () => {
  if (currentTrackIndex === -1) return;
  deleteTrack(currentTrackIndex);
});

function deleteTrackFromMenu(index) {
  deleteTrack(index);
}

function deleteTrack(index) {
  const track = library[index];
  if (!confirm(`Удалить "${track.title}"?`)) return;
  
  fetch(`/api/track/${track.video_id}`, { method: 'DELETE' })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        if (currentTrackIndex === index) {
          currentTrackIndex = -1;
          isPlaying = false;
          audio.pause();
          audio.src = '';
          stopVisualizer();
        }
        library.splice(index, 1);
        if (currentTrackIndex > index) currentTrackIndex--;
        applyFilters();
        updateStats();
        showNotification('Трек удален', 'success');
      }
    });
}

// ============ Горячие клавиши ============
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch(e.code) {
    case 'Space': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': audio.currentTime += 5; break;
    case 'ArrowLeft': audio.currentTime -= 5; break;
    case 'ArrowUp': audio.volume = Math.min(1, audio.volume + 0.05); volumeSlider.value = audio.volume * 100; updateVolumeIcon(); break;
    case 'ArrowDown': audio.volume = Math.max(0, audio.volume - 0.05); volumeSlider.value = audio.volume * 100; updateVolumeIcon(); break;
    case 'KeyN': playNext(); break;
    case 'KeyP': playPrevious(); break;
    case 'KeyM': volumeBtn.click(); break;
    case 'KeyS': shuffleBtn.click(); break;
    case 'KeyR': repeatBtn.click(); break;
case 'KeyV': visualizerBtn.click(); break;
    case 'KeyB': toggleSidebarBtn.click(); break;
  }
});

// ============ Автовоспроизведение ============
audio.addEventListener('ended', () => {
  if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); return; }
  playNext();
});

// ============ Кнопки управления ============
playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', playPrevious);
nextBtn.addEventListener('click', playNext);

// ============ Инициализация ============
function init() {
  // Загружаем последний трек
  const lastTrack = localStorage.getItem('lastTrack');
  loadLibrary().then(() => {
    if (lastTrack !== null && library[parseInt(lastTrack)]) {
      // Не автовоспроизводим, просто выделяем
      currentTrackIndex = parseInt(lastTrack);
      renderAllViews();
    }
  });
  
  audio.volume = 0.75;
  volumeSlider.value = 75;
  updateViewVisibility();
}

// Polyfill для roundRect
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
    const r = radii[0] || 0;
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
  };
}

// ============ Мобильная навигация ============
function isMobile() {
  return window.innerWidth <= 768;
}

function switchMobileTab(tab) {
  if (!isMobile()) return;

  const playerPanel = document.querySelector('.player-panel');
  const sidebarEl = document.getElementById('sidebar');

  document.querySelectorAll('.bottom-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  if (tab === 'player') {
    playerPanel.classList.add('tab-active');
    sidebarEl.classList.add('tab-hidden');
  } else {
    playerPanel.classList.remove('tab-active');
    sidebarEl.classList.remove('tab-hidden');
  }
}

document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchMobileTab(btn.dataset.tab));
});

window.addEventListener('resize', () => {
  if (!isMobile()) {
    document.querySelector('.player-panel').classList.remove('tab-active');
    document.getElementById('sidebar').classList.remove('tab-hidden');
  } else {
    const activeTab = document.querySelector('.bottom-nav-btn.active')?.dataset.tab || 'library';
    switchMobileTab(activeTab);
  }
});

init();