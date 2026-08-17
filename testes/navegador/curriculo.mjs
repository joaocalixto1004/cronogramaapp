/* Pontos de currículo — a segunda etapa da SES-DF.
 *
 * O que importa é o prazo: monitoria, extensão, IC e serviço no SUS só contam
 * por semestre completo, então o teto real cai conforme a prova se aproxima.
 */
import { chromium } from "playwright";

const B = process.env.RITMO_URL ?? "http://localhost:8788";
const falhas = [];
const ok = (m) => console.log("  ok   " + m);
const erro = (m) => { falhas.push(m); console.log("  FALHA " + m); };

const nav = await chromium.launch();
const pag = await (await nav.newContext()).newPage();
const problemas = [];
let dialogoNativo = false;
pag.on("console", (m) => { if (m.type() === "error") problemas.push(m.text()); });
pag.on("pageerror", (e) => problemas.push("pageerror: " + e.message));
pag.on("dialog", async (d) => { dialogoNativo = true; await d.dismiss(); });

await pag.addInitScript(() => localStorage.clear());
await pag.goto(B, { waitUntil: "load" });
await pag.waitForFunction(() => document.querySelectorAll("#lista .row").length > 50, null, { timeout: 20000 });
const txt = (s) => pag.locator(s).textContent();
const esperaAviso = (f) => pag.waitForFunction(
  (x) => (document.getElementById("avisoTexto")?.textContent ?? "").includes(x), f, { timeout: 6000 });

const addProva = async (nome, data) => {
  await pag.locator("#btnProvas").click();
  await pag.locator("#dlgProvas").waitFor({ state: "visible" });
  await pag.locator("#pvNome").fill(nome);
  await pag.locator("#pvData").fill(data);
  await pag.locator("#pvPerfil").selectOption("sesdf");
  await pag.locator("#dlgProvas button.btn:not(.sec)").click();
  await pag.locator("#dlgProvas").waitFor({ state: "hidden" });
  await esperaAviso(nome);
};

/* ---------- 1. o quadro do edital ---------- */
console.log("\n1. Quadro de pontos");
await pag.locator("#btnCurriculo").click();
await pag.locator("#dlgCurriculo").waitFor({ state: "visible" });

const nItens = await pag.locator("#curriculoLista .item").count();
nItens === 13 ? ok("as 13 alíneas do edital") : erro(`${nItens} alíneas`);

const semPrazo = await pag.locator('#curriculoLista .item[data-semestral="1"]').count();
semPrazo === 4 ? ok("quatro itens marcados como semestrais (A, C, I, L)") : erro(`${semPrazo} semestrais`);

/* ---------- 2. tetos ---------- */
console.log("\n2. Tetos");
await pag.locator("#curA").fill("10");            // monitoria: teto 1,0
await pag.waitForTimeout(150);
(await txt("#ptsA")).trim() === "1" ? ok("10 semestres de monitoria continuam valendo 1,0") : erro(`ptsA = ${await txt("#ptsA")}`);

await pag.locator("#curG").fill("2");             // G e H dividem 1,0
await pag.locator("#curH").fill("5");
await pag.waitForTimeout(150);
(await txt("#ptsG")).trim() === "1" && (await txt("#ptsH")).trim() === "—"
  ? ok("G ocupa o teto compartilhado e não sobra para H")
  : erro(`G=${await txt("#ptsG")} H=${await txt("#ptsH")}`);

await pag.locator("#curH").fill("0");
await pag.locator("#curG").fill("0");
await pag.locator("#curA").fill("0");

/* ---------- 3. salvar e ver no painel ---------- */
console.log("\n3. Salvar");
await pag.locator("#curK").fill("1");             // Rondon: 1,0 de uma vez
await pag.locator("#curE").fill("3");             // 3 congressos: 0,3
await pag.waitForTimeout(150);
await pag.locator("#curOk").click();
await pag.locator("#dlgCurriculo").waitFor({ state: "hidden" });
await esperaAviso("Currículo").then(() => ok("salvou e avisou"), () => erro("nada avisado"));

await pag.locator("#painel .painel-topo").click();
const resumo = (await txt("#curriculoResumo")).trim();
/1,3 de 10 pontos/.test(resumo) ? ok(`painel: "${resumo}"`) : erro(`curriculoResumo = ${resumo}`);

// Reabrir tem de trazer os valores de volta.
await pag.locator("#btnCurriculo").click();
await pag.locator("#dlgCurriculo").waitFor({ state: "visible" });
(await pag.locator("#curK").inputValue()) === "1" && (await pag.locator("#curE").inputValue()) === "3"
  ? ok("reabrir traz o que foi salvo")
  : erro("valores não voltaram");
await pag.locator("#dlgCurriculo button.btn.sec").click();
await pag.locator("#dlgCurriculo").waitFor({ state: "hidden" });

/* ---------- 4. o prazo dos semestrais ---------- */
console.log("\n4. O prazo");
await addProva("SES-DF longe", "2029-01-11");
await pag.locator("#btnCurriculo").click();
await pag.locator("#dlgCurriculo").waitFor({ state: "visible" });
const longe = await txt("#curriculoHint");
/ainda cabem/.test(longe) ? ok(`com anos pela frente: "${longe.trim().slice(0, 70)}…"`) : erro(`hint = ${longe}`);
await pag.locator("#dlgCurriculo button.btn.sec").click();
await pag.locator("#dlgCurriculo").waitFor({ state: "hidden" });

// Agora uma prova logo ali: a janela dos semestrais fecha.
await addProva("SES-DF perto", "2026-11-01");
await pag.locator("#btnCurriculo").click();
await pag.locator("#dlgCurriculo").waitFor({ state: "visible" });
const perto = await txt("#curriculoHint");
/teto real/.test(perto) && /semestre completo/.test(perto)
  ? ok(`com a prova perto: "${perto.trim().slice(0, 80)}…"`)
  : erro(`hint = ${perto}`);
await pag.locator("#dlgCurriculo button.btn.sec").click();
await pag.locator("#dlgCurriculo").waitFor({ state: "hidden" });

const resumoPerto = (await txt("#curriculoResumo")).trim();
/teto real hoje/.test(resumoPerto) ? ok(`painel avisa a perda: "${resumoPerto}"`) : erro(`resumo = ${resumoPerto}`);

/* ---------- 5. higiene ---------- */
console.log("\n5. Higiene");
dialogoNativo ? erro("apareceu alert/confirm nativo") : ok("nenhum diálogo nativo");
const csp = problemas.filter((p) => /Content Security Policy|Refused to/i.test(p));
csp.length ? erro("CSP: " + csp.join(" | ")) : ok("nenhuma violação de CSP");
problemas.length ? erro("console: " + problemas.join(" | ")) : ok("console limpo");

await nav.close();
console.log(falhas.length ? `\n${falhas.length} FALHA(S)\n` : "\nCurrículo ok.\n");
process.exit(falhas.length ? 1 : 0);
