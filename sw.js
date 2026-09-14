/* Version 5: the display is self-contained and stores messages only on the tablet. */
var VERSION = "mini-board-local-v5-split1";
var CACHE = VERSION + ":" + self.registration.scope;
var FILES = ["index.html", "styles.css", "content.js", "app.js"];
self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(FILES.map(function (name) { return "./" + name; }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return (key.indexOf("mini-board-private-") === 0 || key.indexOf("mini-board-local-") === 0) &&
        key.slice(key.indexOf(":") + 1) === self.registration.scope && key !== CACHE;
    }).map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url), base = new URL(self.registration.scope);
  if (url.origin !== base.origin || url.pathname.indexOf(base.pathname) !== 0) return;
  var name = url.pathname.slice(base.pathname.length) || "index.html";
  if (FILES.indexOf(name) < 0) return;
  /* Only the local display page is cached. */
  var canonical = new URL(name, base).href;
  event.respondWith(fetch(event.request).then(function (response) {
    if (!response.ok) throw new Error("Page unavailable");
    var copy = response.clone();
    event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.put(canonical, copy); }));
    return response;
  }).catch(function () {
    return caches.match(canonical).then(function (cached) {
      return cached || new Response("Reconnect once to download this board file.", {status:503, headers:{"Content-Type":"text/plain"}});
    });
  }));
});