/* Basketball Time Offline Service Worker (PWA Stage 4) */
const CACHE_NAME = "bt-offline-v4b-20261129";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./ui-refactor.css?v=20261129s4b",
  "./ui-refactor.js?v=20261129s4b",
  "./manifest.json",
  "./assets/icon.svg",
  "./i18n/zh-Hant.json",
  "./data/leagues.json",
  "./data/skills.json",
  "./data/cutins.json",
  "./data/actions.json",
  "./data/origins.json",
  "./data/events.json",
  "./assets/images/chasedown_reject.webp",
  "./assets/images/corner_sniper.webp",
  "./assets/images/def_perimeter_contest.webp",
  "./assets/images/default.webp",
  "./assets/images/fadeaway_phantom.webp",
  "./assets/images/result_assist.webp",
  "./assets/images/result_charge.webp",
  "./assets/images/result_clank.webp",
  "./assets/images/result_rebound.webp",
  "./assets/images/result_steal.webp",
  "./assets/images/result_swish.webp",
  "./assets/images/tomahawk_poster.webp",
  "./assets/images/zone_awakening.webp",
  "./assets/audio/bgm_court.mp3",
  "./assets/audio/bgm_clutch.mp3",
  "./assets/audio/crowd_ambience.mp3",
  "./assets/audio/sfx_swish.mp3",
  "./assets/audio/sfx_dunk.mp3",
  "./assets/audio/sfx_clank.mp3",
  "./assets/audio/sfx_squeak.mp3",
  "./assets/audio/sfx_whistle.mp3",
  "./assets/audio/sfx_buzzer.mp3",
  "./assets/audio/sfx_cheer.mp3",
  "./assets/audio/sfx_block.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: false }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
