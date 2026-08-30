/* Verificação no navegador de verdade: CSP, troca de tarefa, histórico
 * separado por tarefa em localStorage, e uma conversa real de ponta a ponta
 * contra o Worker local (que fala com a NVIDIA de verdade — exige NVAPI_KEY
 * em .dev.vars e `npm run dev` rodando). */
import { chromium } from "playwright";

const B = process.env.RITMO_URL ?? "http://localhost:8788";
const falhas = [];
const ok = (m) => console.log("  ok   " + m);
const erro = (m) => { falhas.push(m); console.log("  FALHA " + m); };

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

console.log("\n1. Carga da página");
await pag.goto(`${B}/ia`, { waitUntil: "networkidle" });
const titulo = await pag.title();
titulo.includes("Assistente") ? ok(`título: "${titulo}"`) : erro(`título inesperado: "${titulo}"`);
externos.length === 0 ? ok("nenhum recurso de origem externa (CSP respeitada)") : erro(`origens externas: ${externos.join(", ")}`);
problemas.length === 0 ? ok("sem erro de console no carregamento") : erro(`console: ${problemas.join(" | ")}`);

console.log("\n2. Link a partir do cronograma");
await pag.goto(B, { waitUntil: "networkidle" });
const linkVisivel = await pag.locator('a.ghost[href="ia"]', { hasText: "assistente" }).isVisible();
linkVisivel ? ok("link \"assistente\" aparece no cabeçalho") : erro("link \"assistente\" não encontrado");
await pag.click('a.ghost[href="ia"]');
await pag.waitForURL(/\/ia$/);
ok("navegou para /ia ao clicar");

console.log("\n3. Seletor de tarefa e histórico vazio");
const semConversa = await pag.locator(".ia-vazio").isVisible();
semConversa ? ok("mostra \"sem conversa\" ao abrir pela primeira vez") : erro("deveria mostrar estado vazio");

console.log("\n4. Enviar uma mensagem de verdade (rodada contra a NVIDIA)");
await pag.selectOption("#iaTarefa", "rapido");
await pag.fill("#iaEntrada", "responda em no máximo 6 palavras: qual a capital do brasil");
await pag.click("#iaEnviar");

try {
  await pag.waitForFunction(
    () => {
      const balões = document.querySelectorAll(".ia-msg-ia .ia-balao");
      const ultimo = balões[balões.length - 1];
      return ultimo && ultimo.textContent.trim().length > 0;
    },
    { timeout: 40000 },
  );
  const resposta = await pag.locator(".ia-msg-ia .ia-balao").last().textContent();
  ok(`resposta recebida via streaming: "${resposta.trim().slice(0, 60)}"`);

  const legenda = await pag.locator(".ia-msg-ia .ia-legenda").last().textContent().catch(() => null);
  legenda ? ok(`legenda do modelo mostrada: "${legenda}"`) : erro("legenda do modelo não apareceu");
} catch (e) {
  erro(`resposta não chegou em 40s: ${e.message}`);
}

const avisoVisivel = await pag.locator("#iaAviso").isVisible();
avisoVisivel ? erro("aviso de erro apareceu numa conversa que deveria ter funcionado") : ok("nenhum aviso de erro");

console.log("\n5. Histórico persiste depois de recarregar a página");
await pag.reload({ waitUntil: "networkidle" });
const bolhaEu = await pag.locator(".ia-msg-eu .ia-balao").first().textContent().catch(() => null);
bolhaEu?.includes("capital") ? ok("mensagem do usuário sobreviveu ao reload (localStorage)") : erro("histórico não persistiu");

console.log("\n6. Histórico é separado por tarefa");
await pag.selectOption("#iaTarefa", "codigo");
const vazioNaOutraTarefa = await pag.locator(".ia-vazio").isVisible();
vazioNaOutraTarefa ? ok("tarefa \"codigo\" está vazia — não herdou o histórico de \"rapido\"") : erro("histórico vazou entre tarefas");

await navegador.close();

console.log(`\n${falhas.length === 0 ? "TUDO OK" : `${falhas.length} FALHA(S)`}`);
process.exit(falhas.length ? 1 : 0);
