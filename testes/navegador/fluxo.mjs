/* Verificação no navegador de verdade: CSP, render, registro e fila offline. */
import { chromium } from "playwright";
import { SEMENTE } from "../../logica.js";

const N = SEMENTE.length;
const B = process.env.RITMO_URL ?? "http://localhost:8788";
const falhas = [];
const ok = (m) => console.log("  ok   " + m);
const erro = (m) => { falhas.push(m); console.log("  FALHA " + m); };

const esperaTexto = (pag, id, esperado, ms = 8000) =>
  pag.waitForFunction(
    ([i, e]) => document.getElementById(i).textContent === e,
    [id, esperado],
    { timeout: ms },
  );

const navegador = await chromium.launch();
const ctx = await navegador.newContext();
const pag = await ctx.newPage();

const problemas = [];
const externos = [];
pag.on("console", (m) => { if (m.type() === "error") problemas.push(m.text()); });
pag.on("pageerror", (e) => problemas.push("pageerror: " + e.message));
pag.on("request", (r) => {
  if (!r.url().startsWith(B) && !r.url().startsWith("data:")) externos.push(r.url());
});

console.log("\n1. Carga inicial");
await pag.goto(B, { waitUntil: "networkidle" });

const csp = problemas.filter((p) => /Content Security Policy|Refused to/i.test(p));
csp.length ? erro("violações de CSP: " + csp.join(" | ")) : ok("nenhuma violação de CSP");
externos.length ? erro("requisições a terceiros: " + externos.join(", ")) : ok("nenhuma requisição externa (fontes são locais)");
problemas.length ? erro("erros no console: " + problemas.join(" | ")) : ok("console limpo");

console.log("\n2. Render");
const temas = await pag.locator(".row").count();
temas === N ? ok(`${N} temas renderizados`) : erro(`esperava ${N} temas, veio ${temas}`);
const cob = await pag.locator("#stCob").textContent();
cob === `0/${N}` ? ok("métrica de cobertura zerada") : erro(`stCob = ${cob}`);

const larguras = await pag.$$eval(".bar-prog i", (ns) => ns.map((n) => n.style.width));
larguras.length && larguras.every((w) => w.endsWith("%"))
  ? ok(`barras de progresso com largura via CSSOM (${larguras.length})`)
  : erro("barras sem largura — o CSSOM não aplicou");

const fonte = await pag.evaluate(() => document.fonts.check('16px "IBM Plex Sans"'));
fonte ? ok("IBM Plex Sans carregada localmente") : erro("fonte local não carregou");

console.log("\n3. Registrar um estudo");
await pag.locator(".row").first().locator("button.reg").click();
await pag.locator("#dlgReg").waitFor({ state: "visible" });
await pag.locator("#regAcertos").fill("90");
const dica = await pag.locator("#regHint").textContent();
/7 dias/.test(dica) ? ok(`dica coerente: "${dica.trim()}"`) : erro(`dica inesperada: ${dica}`);
await pag.locator("#regOk").click();
await pag.locator("#dlgReg").waitFor({ state: "hidden" });

await esperaTexto(pag, "stCob", `1/${N}`, 5000)
  .then(() => ok("tela atualizou na hora (otimista)"))
  .catch(async () => erro("a tela não refletiu o registro: " + (await pag.locator("#stCob").textContent())));

await pag.waitForFunction(() => document.getElementById("sync").dataset.estado === "ok", null, { timeout: 8000 })
  .then(() => ok("estado da sincronização voltou para 'ok'"))
  .catch(async () => erro("sync não confirmou: " + (await pag.locator("#sync").textContent())));

console.log("\n4. Persistência entre aparelhos");
const pag2 = await ctx.newPage();          // outro "aparelho", mesmo servidor
await pag2.addInitScript(() => localStorage.clear());
await pag2.goto(B, { waitUntil: "networkidle" });
await esperaTexto(pag2, "stCob", `1/${N}`)
  .then(() => ok("o registro apareceu num navegador com localStorage vazio"))
  .catch(async () => erro("não sincronizou para o segundo aparelho: " + (await pag2.locator("#stCob").textContent())));
await pag2.close();

console.log("\n5. Fila offline");
await ctx.setOffline(true);
await pag.locator(".row").nth(1).locator("button.reg").click();
await pag.locator("#dlgReg").waitFor({ state: "visible" });
await pag.locator("#regOk").click();
await pag.locator("#dlgReg").waitFor({ state: "hidden" });

await esperaTexto(pag, "stCob", `2/${N}`, 5000)
  .then(() => ok("registro offline entra na tela normalmente"))
  .catch(async () => erro("registro offline não apareceu: " + (await pag.locator("#stCob").textContent())));

const txtOffline = await pag.locator("#sync").textContent();
/fila|offline|aguardando/i.test(txtOffline) ? ok(`fila sinalizada: "${txtOffline.trim()}"`) : erro(`estado offline não sinalizado: ${txtOffline}`);

await ctx.setOffline(false);
await pag.evaluate(() => dispatchEvent(new Event("online")));
await pag.waitForFunction(() => document.getElementById("sync").dataset.estado === "ok", null, { timeout: 10000 })
  .then(() => ok("ao voltar a rede, a fila subiu sozinha"))
  .catch(async () => erro("a fila não drenou: " + (await pag.locator("#sync").textContent())));

console.log("\n6. Service worker");
const sw = await pag.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return { registrado: !!r, ativo: !!r?.active };
});
sw.registrado && sw.ativo ? ok("service worker ativo") : erro("service worker não ativou: " + JSON.stringify(sw));

const cacheado = await pag.evaluate(async () => {
  const nomes = await caches.keys();
  if (!nomes.length) return null;
  const c = await caches.open(nomes[0]);
  return { nome: nomes[0], itens: (await c.keys()).length };
});
cacheado?.itens >= 11
  ? ok(`shell pré-cacheado: ${cacheado.itens} itens em "${cacheado.nome}"`)
  : erro("pré-cache incompleto: " + JSON.stringify(cacheado));

const apiNoCache = await pag.evaluate(async () => {
  const nomes = await caches.keys();
  const c = await caches.open(nomes[0]);
  return (await c.keys()).some((r) => r.url.includes("/api/"));
});
apiNoCache ? erro("resposta da API foi parar no cache") : ok("nenhuma resposta da API no cache");

console.log("\n7. Recarga offline (PWA de verdade)");
await ctx.setOffline(true);
try {
  await pag.reload({ waitUntil: "load", timeout: 15000 });
  const t = await pag.locator(".row").count();
  t === N ? ok(`app abriu offline com os ${N} temas`) : erro(`offline renderizou ${t} temas`);
  const f = await pag.evaluate(() => document.fonts.check('16px "IBM Plex Sans"'));
  f ? ok("tipografia correta offline") : erro("fonte não disponível offline");
} catch (e) {
  erro("não abriu offline: " + e.message);
}
await ctx.setOffline(false);

await navegador.close();
console.log(falhas.length ? `\n${falhas.length} FALHA(S)\n` : "\nTudo passou.\n");
process.exit(falhas.length ? 1 : 0);
