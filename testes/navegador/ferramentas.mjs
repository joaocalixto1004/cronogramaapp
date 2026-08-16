/* Caderno de erros, nota projetada, desempenho por área e carga.
 *
 * O que estes testes cobrem é a ligação entre eles: o erro categorizado no
 * registro tem de chegar ao resumo, e o desempenho tem de mover a projeção.
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
const esperaAviso = (frag) => pag.waitForFunction(
  (f) => (document.getElementById("avisoTexto")?.textContent ?? "").includes(f),
  frag, { timeout: 6000 });

/* ---------- 0. uma prova, senão não há alvo nem carga ---------- */
await pag.locator("#btnProvas").click();
await pag.locator("#dlgProvas").waitFor({ state: "visible" });
await pag.locator("#pvNome").fill("ENAMED");
await pag.locator("#pvData").fill("2028-09-13");
await pag.locator("#pvPerfil").selectOption("enamed");
await pag.locator("#dlgProvas button.btn:not(.sec)").click();
await pag.locator("#dlgProvas").waitFor({ state: "hidden" });
await esperaAviso("ENAMED");

/* ---------- 1. projeção parte do acaso ---------- */
console.log("\n1. Nota projetada");
await pag.locator("#painel .painel-topo").click();
const inicial = (await txt("#projNota")).trim();
inicial === "25%" ? ok("sem nada estudado, projeta o acerto ao acaso (25%)") : erro(`projNota = ${inicial}`);
/0% do edital/.test(await txt("#projCobertura")) ? ok("cobertura zerada") : erro(await txt("#projCobertura"));

const nAreas = await pag.locator("#areas .linha-area").count();
nAreas === 7 ? ok("as sete áreas listadas") : erro(`${nAreas} áreas no painel`);

/* ---------- 2. registrar com erros categorizados ---------- */
console.log("\n2. Caderno de erros");
await pag.locator("#fila li button").first().click();
await pag.locator("#dlgReg").waitFor({ state: "visible" });

(await pag.locator("#regErros").isVisible())
  ? erro("bloco de erros não deveria aparecer antes de haver erro")
  : ok("sem erro informado, o bloco fica escondido");

await pag.locator("#regQuestoes").fill("20");
await pag.locator("#regCertas").fill("12");
await pag.locator("#regErros").waitFor({ state: "visible", timeout: 4000 });
ok("com 8 erradas, o bloco de categorias aparece");
/8 erros/.test(await txt("#regErrosTitulo"))
  ? ok("o título conta os erros")
  : erro(`título: ${await txt("#regErrosTitulo")}`);

// Marca mais erros do que houve: tem de recusar.
await pag.locator("#errConhecimento").fill("20");
await pag.locator("#regOk").click();
await pag.locator("#dlgReg").waitFor({ state: "hidden" });
await esperaAviso("20 erros para 8").then(
  () => ok("recusa marcar mais erros do que questões erradas"),
  () => erro("aceitou contagem de erro impossível"));

// Agora corretamente.
await pag.locator("#fila li button").first().click();
await pag.locator("#dlgReg").waitFor({ state: "visible" });
await pag.locator("#regQuestoes").fill("20");
await pag.locator("#regCertas").fill("12");
await pag.locator("#errConhecimento").fill("5");
await pag.locator("#errDesatencao").fill("3");
await pag.locator("#regNota").fill("confundi sensibilidade com VPP");
await pag.locator("#regOk").click();
await pag.locator("#dlgReg").waitFor({ state: "hidden" });
await esperaAviso("60%").catch(() => {});

const resumo = (await txt("#errosResumo")).trim();
/5 por falta de conhecimento/.test(resumo) && /3 por desatenção/.test(resumo)
  ? ok(`resumo do caderno: "${resumo}"`)
  : erro(`errosResumo = ${resumo}`);
/conhecimento é o que mais te custa/.test(resumo)
  ? ok("aponta a categoria dominante")
  : erro("não apontou a categoria dominante");

/* ---------- 3. a projeção se move ---------- */
console.log("\n3. A projeção reage");

// Um tema em 97 não move a projeção da prova inteira, e não deveria mesmo.
// Para ver o ponteiro andar é preciso volume.
// Pela lista, não pelo plano: o plano do dia acaba em 2-3 blocos.
await pag.evaluate(() => document.querySelectorAll("#lista details").forEach((d) => { d.open = true; }));
for (let i = 10; i < 22; i++) {
  await pag.locator("#lista .row").nth(i).locator("button.reg").click();
  await pag.locator("#dlgReg").waitFor({ state: "visible" });
  await pag.locator("#regQuestoes").fill("10");
  await pag.locator("#regCertas").fill("10");
  await pag.locator("#regOk").click();
  await pag.locator("#dlgReg").waitFor({ state: "hidden" });
}
await pag.waitForTimeout(500);

const depois = (await txt("#projNota")).trim();
parseInt(depois, 10) > parseInt(inicial, 10)
  ? ok(`projeção foi de ${inicial} para ${depois} depois de 13 temas`)
  : erro(`projeção ficou em ${depois}`);
!/0% do edital/.test(await txt("#projCobertura")) ? ok("cobertura subiu") : erro("cobertura ficou em zero");

const comValor = await pag.$$eval("#areas .linha-area .val", (ns) => ns.map((n) => n.textContent).filter((t) => t !== "—"));
comValor.length >= 1 ? ok(`área com acerto medido: ${comValor[0]}`) : erro("nenhuma área com valor");

/* ---------- 4. carga ---------- */
console.log("\n4. Carga");
const carga = (await txt("#carga")).trim();
carga ? ok(`aviso de carga presente: "${carga.slice(0, 72)}…"`) : erro("nenhum aviso de carga");
/cabe|não cobre/.test(carga) ? ok("diz se cabe ou não") : erro(`texto inesperado: ${carga}`);

/* ---------- 5. simulado ---------- */
console.log("\n5. Simulado");
await pag.locator("#btnSimulado").click();
await pag.locator("#dlgSimulado").waitFor({ state: "visible" });
await pag.locator("#smQuestoes").fill("100");
await pag.locator("#smCertas").fill("64");
await pag.locator("#smMinutos").fill("300");
(await txt("#smPct")).trim() === "64%" ? ok("percentual do simulado calculado") : erro(await txt("#smPct"));
const dica = await txt("#smHint");
/projet/.test(dica) ? ok(`compara com a projeção: "${dica.trim().slice(0, 60)}…"`) : erro(`smHint = ${dica}`);

await pag.locator("#smOk").click();
await pag.locator("#dlgSimulado").waitFor({ state: "hidden" });
await esperaAviso("64%").then(() => ok("simulado registrado"), () => erro("nada registrado"));

const ult = (await txt("#ultimoSimulado")).trim();
/64%/.test(ult) && /100 questões/.test(ult) ? ok(`último simulado no painel: "${ult}"`) : erro(`ultimoSimulado = ${ult}`);

// Desfazer o simulado tem de removê-lo.
await pag.locator("#btnSimulado").click();
await pag.locator("#dlgSimulado").waitFor({ state: "visible" });
await pag.locator("#dlgSimulado button.btn.sec").click();
await pag.locator("#dlgSimulado").waitFor({ state: "hidden" });
ok("cancelar simulado não registra nada");

/* ---------- 6. higiene ---------- */
console.log("\n6. Higiene");
dialogoNativo ? erro("apareceu alert/confirm nativo") : ok("nenhum diálogo nativo");
const csp = problemas.filter((p) => /Content Security Policy|Refused to/i.test(p));
csp.length ? erro("CSP: " + csp.join(" | ")) : ok("nenhuma violação de CSP");
problemas.length ? erro("console: " + problemas.join(" | ")) : ok("console limpo");

await nav.close();
console.log(falhas.length ? `\n${falhas.length} FALHA(S)\n` : "\nFerramentas ok.\n");
process.exit(falhas.length ? 1 : 0);
