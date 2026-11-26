/* Mercato — service worker do PDV offline.
   Guarda só o necessário para o caixa abrir sem internet: a página /pdv (visitada online)
   e os arquivos estáticos do aplicativo. Nenhuma chamada /api é guardada aqui. */
const PAGES = "mercato-pages-v1";
const STATIC = "mercato-static-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "cache-urls" && Array.isArray(d.urls)) {
    e.waitUntil(
      (async () => {
        const st = await caches.open(STATIC);
        for (const u of d.urls) {
          try {
            const url = new URL(u, self.location.origin);
            if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) continue;
            if (!(await st.match(url.pathname))) await st.add(url.pathname);
          } catch (_) {}
        }
      })()
    );
  }
  if (d.type === "cache-page" && d.url === "/pdv") {
    e.waitUntil(
      fetch("/pdv", { credentials: "same-origin", cache: "no-store" })
        .then((res) => (res.ok && !res.redirected ? caches.open(PAGES).then((c) => c.put("/pdv", res)) : null))
        .catch(() => {})
    );
  }
  if (d.type === "clear-pages") e.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(url.pathname).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(url.pathname, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Abrir /pdv: sempre tenta a rede (sessão e dados atuais); sem rede, usa a última cópia.
  if (req.mode === "navigate" && url.pathname === "/pdv") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put("/pdv", copy));
          }
          return res;
        })
        .catch(() =>
          caches.open(PAGES).then((c) =>
            c.match("/pdv").then(
              (hit) =>
                hit ||
                new Response("Sem conexão. Abra o PDV uma vez com internet neste aparelho.", {
                  status: 503,
                  headers: { "Content-Type": "text/plain; charset=utf-8" },
                })
            )
          )
        )
    );
  }
});
