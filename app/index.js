const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const RPC = require('discord-rpc');
const artwork = require('./artwork');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const PORT = 48321;
// Background browser tabs may only run timers once per minute.
const STALE_AFTER_MS = 120_000;

function fail(message) {
  console.error(`\n[Cinemana Presence] ${message}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fail('Missing config.json. Copy config.example.json to config.json and add your Discord Application ID.');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!/^\d{15,22}$/.test(String(config.clientId || ''))) {
    fail('config.json needs a valid Discord Application ID in clientId.');
    process.exit(1);
  }
  return config;
}

const config = loadConfig();
RPC.register(config.clientId);
let rpc = null;
let rpcReady = false;
let latest = null;
let lastPresenceFingerprint = '';
let publishing = false;
let lastPublishedAt = 0;
let reconnectTimer = null;

function formatClock(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(seconds / 60);
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function externalImage(url) {
  if (!url || !/^https:\/\//i.test(url)) return undefined;
  // Discord supports external HTTPS image URLs, so the artwork can follow the
  // currently playing Cinemana title without any per-title asset uploads.
  return url;
}

async function clearActivity() {
  if (!rpcReady || !lastPresenceFingerprint || publishing) return;
  publishing = true;
  try { await rpc.clearActivity(); } catch { /* Discord may have closed */ }
  publishing = false;
  lastPresenceFingerprint = '';
}

async function publish() {
  if (!rpcReady || !latest || publishing) return;
  const age = Date.now() - latest.receivedAt;
  if (age > STALE_AFTER_MS || (latest.status === 'Paused' && !config.showPaused)) return clearActivity();
  // Coalesce frequent player events rather than queueing overlapping RPC calls.
  if (Date.now() - lastPublishedAt < 15000) return;

  const title = latest.title || 'Cinemana';
  const duration = Number(latest.duration) || 0;
  const rate = Math.max(0.1, Number(latest.playbackRate) || 1);
  const position = Math.min(duration || Infinity, (Number(latest.position) || 0) + (latest.playing ? age / 1000 * rate : 0));
  const details = `Watching ${title}`;
  const poster = artwork.peek(latest.imdbId) || externalImage(latest.poster);
  const activity = {
    // Discord renders type 3 as "Watching", matching the familiar Spotify
    // presentation ("Listening to Spotify" + the current track below).
    type: 3,
    name: title.slice(0, 128),
    details: [
      latest.status === 'Paused' ? '⏸ Paused' : 'Now watching',
      title,
      latest.episode
    ].filter(Boolean).join(' · ').slice(0, 128),
    assets: poster ? { large_image: poster, large_text: title.slice(0, 128) } : undefined,
    instance: false
  };
  if (/^https:\/\/www\.imdb\.com\/title\/tt\d{7,12}\/$/.test(latest.imdbUrl || '')) {
    activity.buttons = [{ label: 'View on IMDb', url: latest.imdbUrl }];
  }

  if (latest.playing && duration > 0) {
    const startedAt = new Date(Date.now() - position / rate * 1000);
    const endedAt = new Date(startedAt.getTime() + duration / rate * 1000);
    activity.timestamps = { start: Math.round(startedAt.getTime()), end: Math.round(endedAt.getTime()) };
  }

  const fingerprint = JSON.stringify(activity);
  if (fingerprint === lastPresenceFingerprint) return;
  publishing = true;
  lastPublishedAt = Date.now();
  try {
    // The legacy setActivity helper drops type and name. Send the full supported
    // RPC activity object through its existing authenticated local IPC transport.
    const accepted = await rpc.request('SET_ACTIVITY', { pid: process.pid, activity });
    fs.writeFileSync(path.join(ROOT, 'presence-status.json'), JSON.stringify({ updatedAt: new Date().toISOString(), sent: activity, accepted }, null, 2));
    lastPresenceFingerprint = fingerprint;
    if (config.debug) console.log('[Cinemana Presence]', { title, details, state });
  } catch (error) {
    fs.writeFileSync(path.join(ROOT, 'presence-status.json'), JSON.stringify({ error: error.message }, null, 2));
    if (config.debug) console.error(error.message);
  } finally {
    publishing = false;
  }
}

function scheduleDiscordReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectDiscord, 3000);
}

function connectDiscord() {
  clearTimeout(reconnectTimer);
  rpcReady = false;
  rpc = new RPC.Client({ transport: 'ipc' });
  rpc.on('ready', () => {
    rpcReady = true;
    lastPresenceFingerprint = '';
    console.log(`[Cinemana Presence] Connected to Discord. Listening on 127.0.0.1:${PORT}.`);
    publish();
  });
  rpc.on('disconnected', () => {
    rpcReady = false;
    lastPresenceFingerprint = '';
    scheduleDiscordReconnect();
  });
  rpc.on('error', error => {
    if (config.debug) console.warn(`[Cinemana Presence] Discord connection: ${error.message}`);
  });
  rpc.login({ clientId: config.clientId }).catch(error => {
    if (config.debug) console.warn(`[Cinemana Presence] Could not connect to Discord: ${error.message}`);
    scheduleDiscordReconnect();
  });
}
connectDiscord();

const server = new WebSocket.Server({ host: '127.0.0.1', port: PORT });
server.on('connection', socket => {
  socket.on('message', raw => {
    try {
      const data = JSON.parse(raw);
      if (data?.source !== 'cinemana-extension' || typeof data.title !== 'string') return;
      latest = { ...data, receivedAt: Date.now() };
      if (data.imdbId) artwork.resolve(data.imdbId).then(() => publish());
      publish();
    } catch { /* Reject malformed local messages. */ }
  });
});
setInterval(() => publish(), 5_000).unref();
process.on('SIGINT', async () => { await clearActivity(); server.close(); process.exit(0); });
