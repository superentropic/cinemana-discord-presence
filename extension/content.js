(() => {
  'use strict';
  let directSocket = null;
  let directRetry = null;

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const absolute = value => { if (!value || !String(value).trim()) return ''; try { return new URL(value, location.href).href; } catch { return ''; } };
  const first = (...values) => values.find(Boolean) || '';
  const meta = name => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || '';
  let cachedPosterForUrl = '';
  let cachedPoster = '';
  let posterCheckedAt = 0;
  const imdbByPage = new Map();
  const episodeByVideo = new Map();

  // The site changes its player URL after an episode is selected. Keep a
  // second key based on the title so that navigation does not discard the
  // verified label we saw on the selection screen.
  function titleKey() {
    return clean(document.title).replace(/\s*\|\s*Cinemana.*$/i, '').toLowerCase();
  }

  function rememberEpisode(result) {
    if (!result) return;
    const byVideo = `cinemana-presence:${videoKey()}`;
    const byTitle = `cinemana-presence:title:${titleKey()}`;
    episodeByVideo.set(videoKey(), result);
    sessionStorage.setItem(byVideo, result);
    if (titleKey() && titleKey() !== 'cinemana') sessionStorage.setItem(byTitle, result);
  }

  function rememberedEpisode() {
    return episodeByVideo.get(videoKey())
      || sessionStorage.getItem(`cinemana-presence:${videoKey()}`)
      || (titleKey() && titleKey() !== 'cinemana' ? sessionStorage.getItem(`cinemana-presence:title:${titleKey()}`) : '')
      || '';
  }

  function videoKey() {
    const route = new URL(location.href);
    return route.searchParams.get('lastEpisodeVideoID') || route.pathname;
  }

  function findImdb() {
    const links = [...new Map([...document.querySelectorAll('a[href]')].flatMap(link => {
      try {
        const url = new URL(link.href);
        if (!/(^|\.)imdb\.com$/.test(url.hostname)) return [];
        const match = url.pathname.match(/^\/title\/(tt\d{7,12})(?:\/|$)/);
        return match ? [[match[1], `https://www.imdb.com/title/${match[1]}/`]] : [];
      } catch { return []; }
    })).entries()];
    if (links.length === 1) imdbByPage.set(location.pathname, { id: links[0][0], url: links[0][1] });
    return imdbByPage.get(location.pathname) || { id: '', url: '' };
  }

  function visibleText(selector) {
    return [...document.querySelectorAll(selector)]
      .map(element => clean(element.innerText || element.textContent))
      .filter(Boolean);
  }

  function findEpisode() {
    // Cinemana exposes the actual video selection as e.g.
    // "Season: 1 | Episode: 1". This is the source of truth and avoids
    // confusing the current item with other episodes in the menu.
    const exact = [...document.querySelectorAll('*')]
      .map(element => clean(element.textContent).match(/^Season:\s*(\d+)\s*\|\s*Episode:\s*(\d+)$/i))
      .find(Boolean);
    if (exact) {
      const result = `Season ${exact[1]} · Episode ${exact[2]}`;
      rememberEpisode(result);
      return result;
    }

    const visible = element => element.getClientRects().length > 0;
    // Cinemana puts "Now Playing" in a small child element, not consistently
    // inside an element named episode/season. Find that marker first.
    const markers = [...document.querySelectorAll('.now-playing, [class*="now-playing" i], *')]
      .filter(visible)
      .filter(element => /^now playing$/i.test(clean(element.textContent)))
      .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
    for (const marker of markers) {
      let episode = '';
      let item = marker;
      for (let depth = 0; item && depth < 7; depth++, item = item.parentElement) {
        const matches = [...clean(item.textContent).matchAll(/\b(?:episode|ep\.?)\s*(\d+)\b/gi)];
        if (matches.length === 1) { episode = matches[0][1]; break; }
      }
      if (!episode) continue;

      // Prefer the selected season control. If Cinemana does not expose one,
      // show only the verified episode instead of guessing Season 1.
      const seasonControls = [...document.querySelectorAll('[aria-selected="true"], [aria-current="true"], [class*="active" i], [class*="selected" i], button, [role="button"]')]
        .filter(visible)
        .map(element => clean(element.textContent))
        .map(text => text.match(/^season\s*(\d+)$/i)?.[1])
        .filter(Boolean);
      const season = seasonControls[0] || '';
      const result = season ? `Season ${season} · Episode ${episode}` : `Episode ${episode}`;
      rememberEpisode(result);
      return result;
    }
    return rememberedEpisode();
  }

  function findPoster(video) {
    if (cachedPosterForUrl === location.href && Date.now() - posterCheckedAt < 10000) return cachedPoster;
    const candidates = [
      ...[...document.querySelectorAll('div.video-image__poster, div.video-image img')].map(image => image.currentSrc || image.src),
      video?.poster,
      meta('og:image'),
      // Cinemana can render title artwork in a CSS background rather than an
      // <img> or video.poster field, especially on its player routes.
      ...[...document.querySelectorAll('div.video-image')].flatMap(element => {
        const background = getComputedStyle(element).backgroundImage;
        return [...background.matchAll(/url\(["']?(.*?)["']?\)/g)].map(match => match[1]);
      })
    ].map(absolute).filter(url => /^https:/i.test(url) && url !== location.href && !/\.(?:svg|mp4|m3u8)(?:[?#]|$)|logo|favicon|avatar/i.test(url));
    posterCheckedAt = Date.now();
    cachedPosterForUrl = location.href;
    cachedPoster = candidates.find(url => /poster|cover|thumb|image|upload/i.test(url)) || candidates[0] || '';
    return cachedPoster;
  }

  function getTitle() {
    const candidate = first(
      meta('og:title'),
      // Cinemana's video pages provide the show/movie name in document.title.
      // Prefer it over generic navigation labels such as "HOME".
      document.title,
      visibleText('h1, [class*="video-title" i], [class*="movie-title" i], [class*="show-title" i], [class*="title" i]')
        .find(value => value.length > 1 && value.length < 160),
      'Cinemana'
    );
    return clean(candidate).replace(/\s*\|\s*Cinemana.*$/i, '');
  }

  function payload() {
    const video = document.querySelector('video');
    const isTitle = /^\/video\//.test(location.pathname);
    const loaded = video && isFinite(video.duration) && video.duration > 0;
    const status = !isTitle ? (location.pathname.startsWith('/search') ? 'Searching titles' : 'Browsing titles')
      : !loaded ? 'Viewing title details' : video.ended ? 'Finished watching'
      : video.paused ? 'Paused' : video.seeking ? 'Seeking'
      : video.readyState < 3 ? 'Buffering' : 'Now watching';
    const imdb = isTitle ? findImdb() : { id: '', url: '' };
    return {
      source: 'cinemana-extension',
      title: isTitle ? getTitle() : 'Cinemana',
      episode: isTitle ? findEpisode() : '',
      imdbId: imdb.id,
      imdbUrl: imdb.url,
      status,
      poster: isTitle ? findPoster(video) : '',
      position: loaded ? video.currentTime : 0,
      duration: loaded ? video.duration : 0,
      playbackRate: video?.playbackRate || 1,
      playing: status === 'Now watching',
      url: location.href
    };
  }

  function send() {
    const data = payload();
    if (!data) return;
    chrome.runtime.sendMessage({ type: 'presence', payload: data }).catch(() => {});
    // Fallback for browsers that suspend/disable MV3 service-worker sockets.
    // The bridge is loopback-only, so this never sends data off the PC.
    const message = JSON.stringify(data);
    if (directSocket?.readyState === WebSocket.OPEN) directSocket.send(message);
    else if (!directSocket || directSocket.readyState === WebSocket.CLOSED) {
      try {
        directSocket = new WebSocket('ws://127.0.0.1:48321');
        directSocket.onopen = () => directSocket.send(message);
        directSocket.onclose = () => { clearTimeout(directRetry); directRetry = setTimeout(() => { directSocket = null; }, 5000); };
      } catch { directSocket = null; }
    }
  }

  const watch = () => {
    document.querySelectorAll('video').forEach(video => {
      if (video.dataset.presenceBound) return;
      video.dataset.presenceBound = 'true';
      ['play', 'playing', 'pause', 'waiting', 'seeking', 'ended', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange'].forEach(event =>
        video.addEventListener(event, send, { passive: true }));
    });
  };
  watch();
  send();
  new MutationObserver(watch).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(send, 4_000);
  document.addEventListener('visibilitychange', send);
})();
