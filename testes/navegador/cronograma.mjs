/* Rotina, provas múltiplas, fases e registro com volume de questões.
 *
 * O que importa aqui é a ligação entre as três coisas novas: a rotina define
 * o tamanho do dia, a prova mais próxima define o ritmo e o peso, e o registro
 * com contagem alimenta os dois.
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
await pag.goto(B, { waitUntil: "networkidle" });
const txt = (sel) => pag.locator(sel).textContent();

/* ---------- 1. rotina ---------- */
console.log("\n1. Rotina semanal");
await pag.locator("#btnRotina").click();
await pag.locator("#dlgRotina").waitFor({ state: "visible" });
for (let i = 0; i < 7; i++) await pag.locator("#rot" + i).fill("120");
const total = await txt("#rotinaTotal");
/14h/.test(total) ? ok(`total calculado: ${total.trim()}`) : erro(`total inesperado: ${total}`);
await pag.locator("#dlgRotina button.btn:not(.sec)").click();
await pag.locator("#dlgRotina").waitFor({ state: "hidden" });

const hoje0 = await txt("#hojeMinutos");
/0 de 2h/.test(hoje0) ? ok(`dia dimensionado pela rotina: "${hoje0.trim()}"`) : erro(`hojeMinutos = ${hoje0}`);

/* ---------- 2. provas múltiplas ---------- */
console.log("\n2. Provas");
const addProva = async (nome, data, perfil) => {
  await pag.locator("#btnProvas").click();
  await pag.locator("#dlgProvas").waitFor({ state: "visible" });
  await pag.locator("#pvNome").fill(nome);
  await pag.locator("#pvData").fill(data);
  await pag.locator("#pvPerfil").selectOption(perfil);
  await pag.locator("#dlgProvas button.btn:not(.sec)").click();
  await pag.locator("#dlgProvas").waitFor({ state: "hidden" });
  // Esperar só o aviso aparecer não basta: ele pode ter sobrado da prova
  // anterior. O texto traz o nome, então dá para esperar por esta gravação.
  await pag.waitForFunction(
    (n) => (document.getElementById("avisoTexto")?.textContent ?? "").includes(n),
    nome, { timeout: 6000 },
  );
};
// Cadastra fora de ordem de propósito: a mais distante primeiro.
await addProva("SES-DF", "2029-01-11", "sesdf");
await addProva("ENAMED", "2028-09-13", "enamed");

const nomeAlvo = (await txt("#provaNome")).trim();
nomeAlvo === "ENAMED"
  ? ok("a contagem aponta para a prova mais próxima, não para a última cadastrada")
  : erro(`provaNome = ${JSON.stringify(nomeAlvo)}`);

const seguinte = await txt("#provaSeguinte");
/SES-DF/.test(seguinte) ? ok(`a seguinte aparece: "${seguinte.trim()}"`) : erro(`provaSeguinte = ${seguinte}`);

const dias = Number(await txt("#dias"));
dias > 700 && dias < 800 ? ok(`${dias} dias até o ENAMED`) : erro(`contagem estranha: ${dias}`);

await pag.locator("#btnProvas").click();
await pag.locator("#dlgProvas").waitFor({ state: "visible" });
const naLista = await pag.locator("#listaProvas li").count();
const alvoMarcado = await pag.locator("#listaProvas li").first().textContent();
naLista === 2 ? ok("as duas provas listadas") : erro(`${naLista} provas na lista`);
/alvo atual/.test(alvoMarcado) ? ok("o alvo atual está sinalizado") : erro(`primeira linha: ${alvoMarcado}`);
await pag.locator("#dlgProvas button.btn.sec").click();
await pag.locator("#dlgProvas").waitFor({ state: "hidden" });

/* ---------- 2b. corrigir uma prova ---------- */
console.log("\n2b. Corrigir prova");

// Espera o valor chegar em vez de ler logo: o handler de close roda depois
// de o diálogo já contar como escondido.
const esperaTexto = (sel, esperado, ms = 6000) =>
  pag.waitForFunction(
    ([s, e]) => (document.querySelector(s)?.textContent ?? "").trim() === e,
    [sel, esperado], { timeout: ms },
  ).then(() => true).catch(() => false);

const salvarProva = async () => {
  await pag.locator("#dlgProvas button.btn:not(.sec)").click();
  await pag.locator("#dlgProvas").waitFor({ state: "hidden" });
};

await pag.locator("#btnProvas").click();
await pag.locator("#dlgProvas").waitFor({ state: "visible" });
await pag.locator(`[data-prova-edit="enamed"]`).click();

const carregado = [await pag.locator("#pvNome").inputValue(), await pag.locator("#pvData").inputValue()];
carregado[0] === "ENAMED" && carregado[1] === "2028-09-13"
  ? ok("tocar na prova carrega nome e data no formulário")
  : erro(`formulário veio com ${carregado.join(" / ")}`);
(await txt("#btnSalvarProva")).includes("atualizar")
  ? ok("o botão avisa que vai atualizar, não criar")
  : erro("botão não mudou de rótulo");

// A data errada vira quatro dias depois.
await pag.locator("#pvData").fill("2028-09-17");
await salvarProva();

(await esperaTexto("#dias", String(dias + 4)))
  ? ok(`contagem foi de ${dias} para ${dias + 4} dias`)
  : erro(`dias = ${(await txt("#dias")).trim()}, esperava ${dias + 4}`);
/17 de setembro/.test(await txt("#provaData"))
  ? ok("a data nova aparece por extenso")
  : erro(`provaData = ${await txt("#provaData")}`);

await pag.locator("#btnProvas").click();
await pag.locator("#dlgProvas").waitFor({ state: "visible" });
const apos = await pag.locator("#listaProvas li").count();
apos === 2 ? ok("corrigir não duplicou a prova") : erro(`${apos} provas depois da correção`);

// Renomear muda o id: a prova antiga não pode sobrar órfã.
await pag.locator(`[data-prova-edit="enamed"]`).click();
await pag.locator("#pvNome").fill("ENAMED 2028");
await salvarProva();

(await esperaTexto("#provaNome", "ENAMED 2028"))
  ? ok("renome aplicado")
  : erro(`provaNome = ${(await txt("#provaNome")).trim()}`);

await pag.locator("#btnProvas").click();
await pag.locator("#dlgProvas").waitFor({ state: "visible" });
const nomes = await pag.locator("#listaProvas li .qual").allTextContents();
nomes.length === 2 && !nomes.some((t) => t.startsWith("ENAMED —"))
  ? ok("o id antigo saiu junto, sem prova órfã")
  : erro("sobrou: " + nomes.join(" | "));
await pag.locator("#dlgProvas button.btn.sec").click();
await pag.locator("#dlgProvas").waitFor({ state: "hidden" });

/* ---------- 3. fase ---------- */
console.log("\n3. Fase");
const fase = await txt("#chipFase");
/cobertura/.test(fase) ? ok(`a mais de 365 dias, fase "${fase.trim()}"`) : erro(`chipFase = ${fase}`);

/* ---------- 4. plano do dia ---------- */
console.log("\n4. Plano do dia");
const nBlocos = await pag.locator("#fila li").count();
nBlocos >= 2 ? ok(`${nBlocos} blocos para 120 min`) : erro(`só ${nBlocos} blocos`);

const minutos = await pag.$$eval("#fila li .min", (ns) => ns.map((n) => n.textContent));
const soma = minutos.reduce((s, m) => s + parseInt(m, 10), 0);
soma <= 120 ? ok(`blocos somam ${soma} min e não estouram os 120`) : erro(`blocos somam ${soma} min`);

const motivos = await pag.$$eval("#fila li .motivo", (ns) => ns.map((n) => n.textContent).filter(Boolean));
motivos.length === nBlocos ? ok(`cada bloco diz por que está ali (ex.: "${motivos[0]}")`) : erro("bloco sem motivo");

const areas = await pag.$$eval("#fila li .area", (ns) => ns.map((n) => n.textContent));
new Set(areas).size > 1 ? ok(`rodízio de área no plano: ${[...new Set(areas)].join(", ")}`) : erro(`todas do mesmo bloco: ${areas}`);

/* ---------- 5. registro com questões e minutos ---------- */
console.log("\n5. Registro com volume");
await pag.locator("#fila li button").first().click();
await pag.locator("#dlgReg").waitFor({ state: "visible" });

const sliderAntes = await pag.locator("#regSemQuestoes").isVisible();
sliderAntes ? ok("sem questões, o controle de domínio aparece") : erro("controle de domínio deveria estar visível");

await pag.locator("#regQuestoes").fill("20");
await pag.locator("#regCertas").fill("15");
await pag.locator("#regMinutos").fill("60");

const pct = await txt("#regPct");
pct.trim() === "75%" ? ok("percentual calculado da contagem: 75%") : erro(`regPct = ${pct}`);
(await pag.locator("#regSemQuestoes").isVisible())
  ? erro("com contagem, o controle de domínio deveria sumir")
  : ok("com contagem, o controle de domínio some");

const dica = await txt("#regHint");
/revisão em/.test(dica) ? ok(`dica com data: "${dica.trim()}"`) : erro(`regHint = ${dica}`);

await pag.locator("#regOk").click();
await pag.locator("#dlgReg").waitFor({ state: "hidden" });
await pag.waitForTimeout(400);

const qst = (await txt("#stQst")).trim();
qst === "20" ? ok("20 questões contabilizadas") : erro(`stQst = ${JSON.stringify(qst)}`);
const hoje1 = await txt("#hojeMinutos");
/1h de 2h/.test(hoje1) ? ok(`minutos do dia andaram: "${hoje1.trim()}"`) : erro(`hojeMinutos = ${hoje1}`);
/20 questões/.test(hoje1) ? ok("questões do dia aparecem no topo") : erro("faltou o total de questões do dia");

const largura = await pag.evaluate(() => document.getElementById("barraDia").style.width);
largura === "50%" ? ok("barra do dia em 50%") : erro(`barraDia = ${largura}`);

/* ---------- 6. sem diálogo nativo, console limpo ---------- */
console.log("\n6. Higiene");
dialogoNativo ? erro("apareceu alert/confirm nativo") : ok("nenhum diálogo nativo");
const csp = problemas.filter((p) => /Content Security Policy|Refused to/i.test(p));
csp.length ? erro("violações de CSP: " + csp.join(" | ")) : ok("nenhuma violação de CSP");
problemas.length ? erro("console: " + problemas.join(" | ")) : ok("console limpo");

await nav.close();
console.log(falhas.length ? `\n${falhas.length} FALHA(S)\n` : "\nCronograma ok.\n");
process.exit(falhas.length ? 1 : 0);
