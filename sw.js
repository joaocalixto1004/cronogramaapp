/* Cache do app shell.
 *
 * A versão é carimbada no deploy por build.sh a partir do commit. Antes ela
 * era a constante "ritmo-v1" escrita à mão: ninguém trocava, o cache nunca
 * era invalidado e o app instalado ficava congelado para sempre.
 */
const VERSAO = "__VERSAO__";
const CACHE = `ritmo-${VERSAO}`;

// Só "./": o Pages responde 308 de /index.html para /, e cache.addAll é
// atômico — uma única URL que redireciona derrubaria todo o pré-cache.
const SHELL = [
  "./",
  "./estilo.css",
  "./app.js",
  "./sync.js",
  "./logica.js",
  "./manifest.webmanifest",
  "./icone.svg",
  "./fontes/plex-sans-400.woff2",
  "./fontes/plex-sans-condensed-700.woff2",
  "./fontes/plex-mono-400.woff2",
  "./fontes/plex-mono-500.woff2",
  "./fontes/plex-mono-600.woff2",
];

self.addEventListener("install", (e) => {
  // Sem skipWaiting: quem decide a troca é a pessoa, pelo aviso na tela.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.tipo === "assumir") self.skipWaiting();
});

const guardavel = (resp) => resp && resp.status === 200 && resp.type === "basic";

/** HTML: rede primeiro, para que uma correção chegue no mesmo dia. */
async function redePrimeiro(req) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(req);
    if (guardavel(resp)) cache.put("./", resp.clone());
    return resp;
  } catch {
    return (await cache.match("./")) || Response.error();
  }
}

/** Estáticos: devolve do cache na hora e revalida em segundo plano. */
async function cacheERevalida(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req);
  const rede = fetch(req)
    .then((resp) => {
      if (guardavel(resp)) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => null);
  return guardado || (await rede) || Response.error();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Dados autenticados nunca entram em cache: sempre rede, direto.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(redePrimeiro(req));
    return;
  }

  if (/\.(css|js|woff2|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(cacheERevalida(req));
  }
});
