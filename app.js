/* Disco Łysy – losowe utwory z playlisty YouTube do treningu West Coast Swing.
 * Całość działa w przeglądarce: oficjalny odtwarzacz YouTube (IFrame Player API),
 * bez serwera, bez klucza API i bez logowania. */
'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  playlistUrl: $('playlistUrl'),
  loadBtn: $('loadBtn'),
  playlistInfo: $('playlistInfo'),
  savedWrap: $('savedWrap'),
  savedSelect: $('savedSelect'),
  deleteSavedBtn: $('deleteSavedBtn'),
  trackCount: $('trackCount'),
  trackDuration: $('trackDuration'),
  pauseDuration: $('pauseDuration'),
  fadeOut: $('fadeOut'),
  status: $('status'),
  bigTimer: $('bigTimer'),
  trackTitle: $('trackTitle'),
  queue: $('queue'),
  startBtn: $('startBtn'),
  skipBtn: $('skipBtn'),
  stopBtn: $('stopBtn'),
  wakeBadge: $('wakeBadge'),
};

const STORE_SETTINGS = 'dl.settings.v1';
const STORE_SAVED = 'dl.saved.v1';
const FADE_SECONDS = 3;
// Kody błędów odtwarzacza: 2 zły parametr, 5 błąd HTML5, 100 brak/prywatny,
// 101 i 150 właściciel zablokował odtwarzanie poza YouTube.
const SKIPPABLE_ERRORS = new Set([2, 5, 100, 101, 150]);

let player = null;
let playerReady = false;
let playlistIds = [];
let playlistId = null;

const session = {
  phase: 'idle', // idle | loading | playing | pause | done
  queue: [],     // id utworów w tej rundzie
  spare: [],     // zapasowe id, gdy któryś utwór nie chce się odtworzyć
  idx: 0,
  pauseEndsAt: 0,
  trackLoadedAt: 0,
  skipped: 0,
  settings: null,
  preload: null, // { id, ready } – następny utwór wczytywany w czasie pauzy
};

/* ---------- Pamięć lokalna (tylko ta przeglądarka) ---------- */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* tryb prywatny itp. */ }
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function currentSettings() {
  return {
    count: clampInt(els.trackCount.value, 1, 20, 3),
    duration: clampInt(els.trackDuration.value, 10, 600, 90),
    pause: clampInt(els.pauseDuration.value, 0, 300, 10),
    fade: els.fadeOut.checked,
  };
}

function loadSettings() {
  const s = readJSON(STORE_SETTINGS, null);
  if (!s) return;
  if (s.count) els.trackCount.value = s.count;
  if (s.duration) els.trackDuration.value = s.duration;
  if (s.pause !== undefined) els.pauseDuration.value = s.pause;
  if (s.fade !== undefined) els.fadeOut.checked = !!s.fade;
  if (s.lastUrl) els.playlistUrl.value = s.lastUrl;
}

function saveSettings() {
  writeJSON(STORE_SETTINGS, { ...currentSettings(), lastUrl: els.playlistUrl.value.trim() });
}

/* ---------- Zapisane playlisty ---------- */

function savedList() {
  return readJSON(STORE_SAVED, []);
}

function renderSaved(selectedId) {
  const list = savedList();
  els.savedWrap.hidden = list.length === 0;
  els.savedSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Wybierz…';
  els.savedSelect.appendChild(placeholder);
  for (const item of list) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    if (item.id === selectedId) opt.selected = true;
    els.savedSelect.appendChild(opt);
  }
}

function rememberPlaylist(id, url, count, name) {
  const list = savedList().filter((p) => p.id !== id);
  const label = name || `Playlista …${id.slice(-6)}`;
  list.unshift({ id, url, name: `${label} (${count} utw.)` });
  writeJSON(STORE_SAVED, list.slice(0, 30));
  renderSaved(id);
}

function forgetPlaylist(id) {
  writeJSON(STORE_SAVED, savedList().filter((p) => p.id !== id));
  renderSaved();
}

// Nazwa playlisty przez publiczny oEmbed YouTube. Jeśli się nie uda, zostaje nazwa zastępcza.
async function fetchPlaylistTitle(id) {
  try {
    const target = `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.title === 'string' ? data.title.slice(0, 80) : null;
  } catch (_) {
    return null;
  }
}

/* ---------- Link do playlisty ---------- */

function parsePlaylistId(input) {
  const text = (input || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const list = url.searchParams.get('list');
    if (list) return list;
  } catch (_) { /* to nie URL – może samo ID */ }
  const m = text.match(/(?:list=)?([A-Za-z0-9_-]{12,})/);
  return m ? m[1] : null;
}

/* ---------- Odtwarzacz YouTube ---------- */

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    playerVars: {
      playsinline: 1,
      rel: 0,
      fs: 0,
      origin: location.origin,
    },
    events: {
      onReady: () => {
        playerReady = true;
        setStatus('Wczytaj playlistę i naciśnij Start');
        // Link z ?list=… (np. udostępniony przez innego instruktora) wczytuje się od razu.
        if (parsePlaylistId(els.playlistUrl.value)) loadPlaylist();
      },
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
};

function onPlayerStateChange(e) {
  if (e.data === YT.PlayerState.ENDED && (session.phase === 'playing' || session.phase === 'loading')) {
    // Utwór krótszy niż ustawiony czas – kończymy wcześniej.
    finishTrack();
  }
}

function onPlayerError(e) {
  if (!SKIPPABLE_ERRORS.has(e.data)) return;
  if (session.phase === 'pause' && session.preload) {
    // Następny utwór nie chce się wczytać – podmieniamy go jeszcze w czasie pauzy.
    session.skipped += 1;
    const next = session.idx + 1;
    const replacement = session.spare.pop();
    if (replacement) session.queue[next] = replacement;
    else session.queue.splice(next, 1);
    session.preload = null;
    renderQueue();
    preloadNext();
    return;
  }
  if (session.phase !== 'loading' && session.phase !== 'playing') return;
  session.skipped += 1;
  const replacement = session.spare.pop();
  if (replacement) {
    session.queue[session.idx] = replacement;
    flash(`Pominięto utwór, którego nie można odtworzyć poza YouTube (kod ${e.data}). Losuję inny…`);
    playTrack(session.idx);
  } else {
    flash('Brak kolejnych utworów do odtworzenia w tej playliście.');
    session.queue.splice(session.idx, 1);
    renderQueue();
    if (session.idx < session.queue.length) playTrack(session.idx);
    else endSession();
  }
}

function loadPlaylist() {
  const id = parsePlaylistId(els.playlistUrl.value);
  if (!id) {
    setInfo('To nie wygląda na link do playlisty (brakuje „list=…”).', 'err');
    return;
  }
  if (!playerReady) {
    setInfo('Odtwarzacz YouTube jeszcze się ładuje…');
    return;
  }
  stopSession(true);
  playlistIds = [];
  playlistId = id;
  els.startBtn.disabled = true;
  setInfo('Wczytuję playlistę…');
  saveSettings();

  player.cuePlaylist({ listType: 'playlist', list: id, index: 0 });

  const startedAt = Date.now();
  const poll = setInterval(() => {
    if (playlistId !== id) { clearInterval(poll); return; }
    let ids = null;
    try { ids = player.getPlaylist(); } catch (_) { /* jeszcze nie gotowe */ }
    if (Array.isArray(ids) && ids.length) {
      clearInterval(poll);
      playlistIds = Array.from(new Set(ids));
      const many = playlistIds.length >= 200 ? ' (YouTube podaje maks. 200 pierwszych)' : '';
      setInfo(`Wczytano ${playlistIds.length} utworów${many}. Naciśnij Start.`, 'ok');
      els.startBtn.disabled = false;
      setStatus('Gotowe. Naciśnij Start');
      const url = els.playlistUrl.value.trim();
      rememberPlaylist(id, url, playlistIds.length);
      fetchPlaylistTitle(id).then((title) => {
        if (title) rememberPlaylist(id, url, playlistIds.length, title);
      });
    } else if (Date.now() - startedAt > 15000) {
      clearInterval(poll);
      setInfo('Nie udało się wczytać playlisty. Sprawdź, czy jest publiczna lub niepubliczna (nie prywatna) i czy link jest pełny.', 'err');
    }
  }, 300);
}

/* ---------- Przebieg rundy ---------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startSession() {
  if (!playlistIds.length) return;
  const settings = currentSettings();
  saveSettings();
  const shuffled = shuffle(playlistIds);
  session.settings = settings;
  session.queue = shuffled.slice(0, settings.count);
  session.spare = shuffled.slice(settings.count);
  session.idx = 0;
  session.skipped = 0;
  document.body.classList.add('running');
  requestWakeLock();
  els.startBtn.textContent = 'Losuj nowe';
  els.skipBtn.disabled = false;
  els.stopBtn.disabled = false;
  playTrack(0);
}

function playTrack(i) {
  session.idx = i;
  session.phase = 'loading';
  session.trackLoadedAt = Date.now();
  renderQueue();
  els.trackTitle.textContent = '';
  setTimer(session.settings.duration, 'playing');
  setStatus(`Utwór ${i + 1}/${session.queue.length}: ładowanie…`);
  session.preload = null;
  player.setVolume(100);
  player.unMute();
  // Wywołanie w obsłudze kliknięcia (Start) spełnia wymóg gestu użytkownika na iOS.
  player.loadVideoById({ videoId: session.queue[i], startSeconds: 0 });
}

function finishTrack() {
  if (session.phase !== 'playing' && session.phase !== 'loading') return;
  try { player.pauseVideo(); } catch (_) { /* nic */ }
  const isLast = session.idx >= session.queue.length - 1;
  if (isLast) {
    endSession();
    return;
  }
  const pause = session.settings.pause;
  if (pause <= 0) {
    playTrack(session.idx + 1);
    return;
  }
  session.phase = 'pause';
  session.pauseEndsAt = Date.now() + pause * 1000;
  renderQueue();
  setStatus(`Pauza – następny utwór ${session.idx + 2}/${session.queue.length}`);
  preloadNext();
}

// W czasie pauzy wczytujemy następny utwór po cichu: bufor (i ewentualna reklama)
// zdążą się załadować, a po pauzie muzyka rusza od razu od początku.
function preloadNext() {
  const next = session.queue[session.idx + 1];
  if (!next) { session.preload = null; return; }
  session.preload = { id: next, ready: false };
  player.mute();
  player.loadVideoById({ videoId: next, startSeconds: 0 });
}

function startNext() {
  const i = session.idx + 1;
  if (i >= session.queue.length) { endSession(); return; }
  const pre = session.preload;
  if (!pre || pre.id !== session.queue[i]) { playTrack(i); return; }
  session.preload = null;
  session.idx = i;
  session.phase = 'loading';
  session.trackLoadedAt = Date.now();
  renderQueue();
  els.trackTitle.textContent = '';
  setTimer(session.settings.duration, 'playing');
  setStatus(`Utwór ${i + 1}/${session.queue.length}: start…`);
  player.setVolume(100);
  player.unMute();
  if (pre.ready) {
    player.seekTo(0, true);
    player.playVideo();
  }
  // Jeśli jeszcze się ładuje (np. trwa reklama), po prostu gra dalej z dźwiękiem.
}

function endSession() {
  session.phase = 'done';
  try { player.pauseVideo(); } catch (_) { /* nic */ }
  session.idx = session.queue.length;
  renderQueue();
  setTimer('✓', '');
  setStatus('Koniec rundy! „Losuj nowe” zaczyna kolejną.');
  els.trackTitle.textContent = '';
  els.skipBtn.disabled = true;
  document.body.classList.remove('running');
  releaseWakeLock();
}

function stopSession(silent) {
  const wasActive = session.phase !== 'idle';
  session.phase = 'idle';
  session.queue = [];
  session.spare = [];
  session.preload = null;
  if (player && playerReady && wasActive) {
    try { player.stopVideo(); } catch (_) { /* nic */ }
  }
  renderQueue();
  setTimer('–', '');
  els.trackTitle.textContent = '';
  els.startBtn.textContent = 'Start';
  els.skipBtn.disabled = true;
  els.stopBtn.disabled = true;
  document.body.classList.remove('running');
  releaseWakeLock();
  if (!silent) setStatus('Zatrzymano. Naciśnij Start, aby wylosować nowe utwory.');
}

function skip() {
  if (session.phase === 'pause') {
    startNext();
  } else if (session.phase === 'playing' || session.phase === 'loading') {
    finishTrack();
  }
}

// Zegar: czas utworu liczony z pozycji odtwarzania, więc reklamy i buforowanie się nie wliczają.
function tick() {
  if (!player || !playerReady) return;
  const s = session.settings;

  if (session.phase === 'loading' || session.phase === 'playing') {
    let t = 0;
    let state = -1;
    let data = {};
    try {
      state = player.getPlayerState();
      data = player.getVideoData() || {};
      if (data.video_id === session.queue[session.idx]) t = player.getCurrentTime() || 0;
    } catch (_) { /* odtwarzacz jeszcze nie gotowy */ }

    const musicIsPlaying = state === YT.PlayerState.PLAYING && t > 0;
    if (musicIsPlaying && session.phase === 'loading') {
      session.phase = 'playing';
    }
    if (data.title && data.video_id === session.queue[session.idx]) {
      els.trackTitle.textContent = data.title;
    }

    const remaining = Math.max(0, s.duration - t);
    setTimer(Math.ceil(remaining), 'playing');

    if (session.phase === 'playing') {
      const label = state === YT.PlayerState.PLAYING ? 'gra' : 'wstrzymany';
      setStatus(`Utwór ${session.idx + 1}/${session.queue.length}: ${label}`);
      if (s.fade && remaining < FADE_SECONDS) {
        player.setVolume(Math.round((remaining / FADE_SECONDS) * 100));
      }
    } else if (Date.now() - session.trackLoadedAt > 8000) {
      const hint = state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED
        ? 'dotknij odtwarzacza, aby zacząć'
        : 'czekam na muzykę (reklama lub ładowanie)…';
      setStatus(`Utwór ${session.idx + 1}/${session.queue.length}: ${hint}`);
    }

    if (t >= s.duration) finishTrack();
  } else if (session.phase === 'pause') {
    const left = Math.max(0, session.pauseEndsAt - Date.now());
    setTimer(Math.ceil(left / 1000), 'pause');
    const pre = session.preload;
    if (pre && !pre.ready) {
      try {
        const data = player.getVideoData() || {};
        const started = data.video_id === pre.id
          && player.getPlayerState() === YT.PlayerState.PLAYING
          && player.getCurrentTime() > 0;
        if (started) {
          // Muzyka ruszyła (po ewentualnej reklamie) – zatrzymujemy na początku i czekamy.
          player.pauseVideo();
          player.seekTo(0, true);
          pre.ready = true;
        }
      } catch (_) { /* odtwarzacz jeszcze nie gotowy */ }
    }
    if (left <= 0) startNext();
  }
}

/* ---------- Ekran nie gaśnie (Screen Wake Lock) ---------- */

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    els.wakeBadge.hidden = false;
    wakeLock.addEventListener('release', () => {
      els.wakeBadge.hidden = true;
    });
  } catch (_) {
    els.wakeBadge.hidden = true;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  els.wakeBadge.hidden = true;
}

document.addEventListener('visibilitychange', () => {
  const active = session.phase === 'loading' || session.phase === 'playing' || session.phase === 'pause';
  if (document.visibilityState === 'visible' && active) requestWakeLock();
});

/* ---------- Interfejs ---------- */

let flashUntil = 0;

function setStatus(text) {
  if (Date.now() < flashUntil) return;
  els.status.textContent = text;
}

function flash(text) {
  els.status.textContent = text;
  flashUntil = Date.now() + 2500;
}

function setInfo(text, kind) {
  els.playlistInfo.textContent = text;
  els.playlistInfo.className = 'hint' + (kind ? ' ' + kind : '');
}

function setTimer(value, kind) {
  const text = typeof value === 'number' ? formatSeconds(value) : value;
  if (els.bigTimer.textContent !== text) els.bigTimer.textContent = text;
  els.bigTimer.className = 'big-timer' + (kind ? ' ' + kind : '');
}

function formatSeconds(sec) {
  if (sec < 60) return String(sec);
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function renderQueue() {
  els.queue.innerHTML = '';
  session.queue.forEach((_, i) => {
    const li = document.createElement('li');
    li.textContent = String(i + 1);
    if (i < session.idx || (i === session.idx && session.phase === 'pause')) li.className = 'done';
    else if (i === session.idx && session.phase !== 'done') li.className = 'current';
    els.queue.appendChild(li);
  });
}

/* ---------- Zdarzenia ---------- */

els.loadBtn.addEventListener('click', loadPlaylist);
els.playlistUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadPlaylist();
});
els.savedSelect.addEventListener('change', () => {
  const item = savedList().find((p) => p.id === els.savedSelect.value);
  if (!item) return;
  els.playlistUrl.value = item.url;
  loadPlaylist();
});
els.deleteSavedBtn.addEventListener('click', () => {
  if (els.savedSelect.value) forgetPlaylist(els.savedSelect.value);
});
for (const input of [els.trackCount, els.trackDuration, els.pauseDuration, els.fadeOut]) {
  input.addEventListener('change', saveSettings);
}
els.startBtn.addEventListener('click', startSession);
els.skipBtn.addEventListener('click', skip);
els.stopBtn.addEventListener('click', () => stopSession(false));

/* ---------- Start ---------- */

loadSettings();
const sharedList = new URLSearchParams(location.search).get('list');
if (sharedList) els.playlistUrl.value = `https://music.youtube.com/playlist?list=${sharedList}`;
renderSaved();
setInterval(tick, 200);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
