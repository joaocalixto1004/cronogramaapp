/* O render passou a reaproveitar nós entre atualizações. O que estes testes
 * cobrem é justamente o que a reescrita põe em risco: ordem das linhas,
 * limpeza ao filtrar, e o texto do usuário virando texto e não markup. */
import { chromium } from "playwright";
import { SEMENTE } from "../../logica.js";

const N = SEMENTE.length;
const B = process.env.RITMO_URL ?? "http://localhost:8788";
const falhas = [];
const ok = (m) => console.log("  ok   " + m);
const erro = (m) => { falhas.push(m); console.log("  FALHA " + m); };

const nav = await chromium.launch();
const ctx = await nav.newContext();
const pag = await ctx.newPage();

const problemas = [];
pag.on("console", (m) => { if (m.type() === "error") problemas.push(m.text()); });
pag.on("pageerror", (e) => problemas.push("pageerror: " + e.message));
pag.on("dialog", async (d) => { await d.accept(); });   // confirm de remoção

await pag.addInitScript(() => localStorage.clear());
await pag.goto(B, { waitUntil: "networkidle" });
// As áreas nascem fechadas: 97 temas abertos davam 13.000px de rolagem.
// Para mexer nas linhas, abre todas.
const abrirAreas = () => pag.evaluate(() =>
  document.querySelectorAll("#lista details").forEach((d) => { d.open = true; }));
await abrirAreas();

/* ---------- 1. reaproveitamento de nós ---------- */
console.log("\n1. Reaproveitamento de nós");

const marcar = () => pag.evaluate(() =>
  document.querySelectorAll("#lista .row").forEach((n, i) => { n.__marca = i; }));
const sobreviventes = () => pag.evaluate(() =>
  [...document.querySelectorAll("#lista .row")].filter((n) => n.__marca !== undefined).length);

await marcar();
const antes = await pag.locator("#lista .row").count();

// Registrar um estudo mexe em uma linha só.
await pag.locator("#lista .row").first().locator("button.reg").click();
await pag.locator("#dlgReg").waitFor({ state: "visible" });
await pag.locator("#regOk").click();
await pag.locator("#dlgReg").waitFor({ state: "hidden" });
await pag.waitForTimeout(300);

const vivos = await sobreviventes();
vivos === antes
  ? ok(`registrar preservou os ${antes} nós (antes o innerHTML recriava todos)`)
  : erro(`só ${vivos} de ${antes} nós sobreviveram ao registro`);

/* ---------- 2. ordem ---------- */
console.log("\n2. Ordem e agrupamento");

const areasNaTela = await pag.$$eval("#lista .areablock h3", (ns) => ns.map((n) => n.textContent));
const esperado = [...new Set(SEMENTE.map(([a]) => a))];
JSON.stringify(areasNaTela) === JSON.stringify(esperado)
  ? ok("áreas na ordem canônica")
  : erro(`ordem das áreas: ${areasNaTela.join(" | ")}`);

const forasDeLugar = await pag.$$eval("#lista .areablock", (secs) =>
  secs.filter((s) => {
    const filhos = [...s.children];
    // depois do cabeçalho, só linhas — e nenhuma linha antes dele
    return filhos[0].className !== "areahead" || filhos.slice(1).some((n) => !n.classList.contains("row"));
  }).length);
forasDeLugar === 0 ? ok("cabeçalho sempre antes das linhas da área") : erro(`${forasDeLugar} seções malformadas`);

/* ---------- 3. filtros ---------- */
console.log("\n3. Filtros");

const contar = () => pag.locator("#lista .row").count();
await pag.locator('[data-filtro="fracos"]').click();
await pag.waitForTimeout(200);
const fracos = await contar();
fracos < N ? ok(`filtro "fracos" reduziu para ${fracos}`) : erro(`filtro não reduziu (${fracos})`);

await pag.locator('[data-filtro="pendentes"]').click();
await pag.waitForTimeout(200);
const pendentes = await contar();

await pag.locator('[data-filtro="todos"]').click();
await pag.waitForTimeout(200);
await abrirAreas();
const todos = await contar();
todos === N ? ok(`voltar para "todos" restaura as ${N} linhas`) : erro(`"todos" mostrou ${todos}, esperava ${N}`);

const duplicadas = await pag.evaluate(() => {
  const ids = [...document.querySelectorAll("#lista .row .reg")].map((b) => b.dataset.reg);
  return ids.length - new Set(ids).size;
});
duplicadas === 0 ? ok("nenhuma linha duplicada depois de filtrar e voltar") : erro(`${duplicadas} linhas duplicadas`);

const orfaos = await pag.evaluate(() =>
  document.querySelectorAll("#lista .semfiltro").length);
orfaos === 0 ? ok("sem resto de estado vazio na lista") : erro("sobrou o aviso de filtro vazio");

/* ---------- 4. texto do usuário não vira markup ---------- */
console.log("\n4. Texto do usuário");

const NOME_HOSTIL = `<img src=x onerror="window.__xss=1">Chagas`;
await pag.locator("#btnNovo").click();
await pag.locator("#dlgNovo").waitFor({ state: "visible" });
await pag.locator("#nvNome").fill(NOME_HOSTIL);
await pag.locator("#dlgNovo button.btn:not(.sec)").click();
await pag.locator("#dlgNovo").waitFor({ state: "hidden" });
await pag.waitForTimeout(400);

const executou = await pag.evaluate(() => window.__xss === 1);
executou ? erro("o markup do nome foi executado") : ok("markup no nome não executa");

const literal = await pag.evaluate((n) =>
  [...document.querySelectorAll("#lista .row .nome")].some((e) => e.textContent === n), NOME_HOSTIL);
literal ? ok("nome aparece literalmente, como digitado") : erro("o nome hostil não foi exibido como texto");

const imgs = await pag.locator("#lista img").count();
imgs === 0 ? ok("nenhum elemento injetado no DOM") : erro(`${imgs} <img> injetadas`);

/* ---------- 5. remoção ---------- */
console.log("\n5. Remoção");
const antesRem = await contar();
// Remover saiu da linha e passou a morar no diálogo de registro.
await pag.locator("#lista .row").first().locator("button.reg").click();
await pag.locator("#dlgReg").waitFor({ state: "visible" });
await pag.locator("#regRemover").click();
await pag.locator("#dlgReg").waitFor({ state: "hidden" });
await pag.waitForTimeout(400);
const depoisRem = await contar();
depoisRem === antesRem - 1 ? ok("remover tira exatamente uma linha") : erro(`${antesRem} -> ${depoisRem}`);

problemas.length ? erro("console: " + problemas.join(" | ")) : ok("console limpo o tempo todo");

await nav.close();
console.log(falhas.length ? `\n${falhas.length} FALHA(S)\n` : "\nRender ok.\n");
process.exit(falhas.length ? 1 : 0);
