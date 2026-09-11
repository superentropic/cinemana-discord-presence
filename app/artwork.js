const fs = require('node:fs');
const path = require('node:path');
const cachePath = path.join(__dirname, '..', 'artwork-cache.json');
let cache = {};
try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
const pending = new Map();
const retryAfter = new Map();
const validId = id => typeof id === 'string' && /^tt\d{7,12}$/.test(id);
function validImage(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'm.media-amazon.com'; } catch { return false; }
}
function peek(id) {
  const entry = cache[id];
  return validId(id) && entry && validImage(entry.url) ? entry.url : '';
}
async function resolve(id) {
  if (!validId(id)) return '';
  if (peek(id)) return peek(id);
  if (pending.has(id)) return pending.get(id);
  if ((retryAfter.get(id) || 0) > Date.now()) return '';
  const job = (async () => {
    try {
      // IMDb's public suggestion response includes the canonical image URL.
      // Require the exact ID; never take an approximate title search result.
      const response = await fetch(`https://v3.sg.media-imdb.com/suggestion/t/${id}.json`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`IMDb returned HTTP ${response.status}`);
      const data = await response.json();
      const match = data.d?.find(item => item.id === id);
      const url = match?.i?.imageUrl;
      if (!validImage(url)) throw new Error('No exact-match IMDb artwork');
      cache[id] = { url, title: match.l, cachedAt: new Date().toISOString() };
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
      return url;
    } catch (error) {
      retryAfter.set(id, Date.now() + 60000);
      console.warn(`[Artwork] ${id}: ${error.message}`);
      return '';
    } finally { pending.delete(id); }
  })();
  pending.set(id, job);
  return job;
}
module.exports = { resolve, peek };
