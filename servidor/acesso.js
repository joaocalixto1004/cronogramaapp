/* Verificação do JWT do Cloudflare Access.
 *
 * O Access já barra o tráfego na borda, mas a política do painel tem uma
 * pegadinha conhecida: ela cobre `*.projeto.workers.dev` e deixa o apex de
 * fora se o curinga não for removido na criação. URLs de preview são outra
 * porta fácil de esquecer. Como o custo aqui é uma verificação de assinatura
 * em memória, a API confere por conta própria em vez de confiar que a
 * configuração do painel está certa.
 *
 * Só o worker chama isto, e só para /api/*: a entrega dos arquivos estáticos
 * não passa por aqui.
 */

const JWKS_TTL = 3600e3; // 1 h
let cache = { chaves: null, expira: 0, time: null };

const bytesDeB64url = (s) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const textoDeB64url = (s) => new TextDecoder().decode(bytesDeB64url(s));

async function chavesDoTime(time) {
  const agora = Date.now();
  if (cache.chaves && cache.time === time && agora < cache.expira) return cache.chaves;

  const r = await fetch(`https://${time}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`JWKS indisponível (${r.status})`);
  const { keys } = await r.json();

  const chaves = new Map();
  for (const k of keys ?? []) {
    if (k.kty !== "RSA" || !k.kid) continue;
    // Só os campos da chave pública: `key_ops`/`use` vindos do JWKS
    // conflitam com o uso ["verify"] em alguns runtimes.
    chaves.set(
      k.kid,
      await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    );
  }
  cache = { chaves, expira: agora + JWKS_TTL, time };
  return chaves;
}

async function verificar(token, time, aud) {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [cabB64, corpoB64, assinaturaB64] = partes;

  let cabecalho;
  try {
    cabecalho = JSON.parse(textoDeB64url(cabB64));
  } catch {
    return null;
  }
  if (cabecalho.alg !== "RS256" || !cabecalho.kid) return null;

  const chave = (await chavesDoTime(time)).get(cabecalho.kid);
  if (!chave) return null;

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    chave,
    bytesDeB64url(assinaturaB64),
    new TextEncoder().encode(`${cabB64}.${corpoB64}`),
  );
  if (!ok) return null;

  let c;
  try {
    c = JSON.parse(textoDeB64url(corpoB64));
  } catch {
    return null;
  }

  const agora = Math.floor(Date.now() / 1000);
  const folga = 60; // tolerância de relógio
  if (typeof c.exp !== "number" || c.exp + folga < agora) return null;
  if (typeof c.nbf === "number" && c.nbf - folga > agora) return null;
  if (c.iss !== `https://${time}.cloudflareaccess.com`) return null;

  const auds = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!auds.includes(aud)) return null;

  return c;
}

/** Devolve uma Response quando o acesso é negado, ou null quando pode seguir. */
export async function barrarAcesso(request, env, ctx) {
  // Escape hatch só de desenvolvimento. MODO_DEV mora no .dev.vars, que está
  // no .gitignore e nunca sobe para a Cloudflare — em produção isto é falso.
  if (env.MODO_DEV === "1") return null;

  // Caminho 1: Access ligado no próprio Worker (Access tab → All traffic).
  // A plataforma já autenticou e entrega a identidade pronta — é a única
  // forma que funciona em workers.dev, porque aplicação self-hosted exige um
  // domínio que seja zona da sua conta. Nada a configurar aqui.
  try {
    const identidade = await ctx?.access?.getIdentity?.();
    if (identidade?.email) return null;
  } catch (e) {
    console.warn("ctx.access indisponível, caindo para o JWT:", e);
  }

  // Caminho 2: aplicação self-hosted em domínio próprio, com o JWT no header.
  const { ACCESS_TEAM, ACCESS_AUD } = env;
  if (!ACCESS_TEAM || !ACCESS_AUD) {
    // Falha fechada: nenhum dos dois caminhos provou identidade.
    return Response.json(
      { erro: "sem autenticação: ligue o Access no Worker ou defina ACCESS_TEAM/ACCESS_AUD" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    (request.headers.get("Cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];

  // Um JWKS fora do ar não pode virar 500 com stack trace: sem conseguir
  // verificar, a resposta é a mesma de quem não apresentou credencial.
  let identidade = null;
  try {
    if (token) identidade = await verificar(token, ACCESS_TEAM, ACCESS_AUD);
  } catch (e) {
    console.warn("falha ao verificar o token do Access:", e);
  }

  if (!identidade) {
    return Response.json(
      { erro: "não autenticado" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return null;
}
