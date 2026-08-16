/* Sem alert/confirm: remover e registrar acontecem na hora e ficam
 * desfazíveis. O que importa é que desfazer volte ao estado exato. */
import { chromium } from "playwright";
const B = process.env.RITMO_URL ?? "http://localhost:8788";
const falhas = [];
const ok = (m)=>console.log("  ok   "+m);
const erro = (m)=>{falhas.push(m);console.log("  FALHA "+m);};

const nav = await chromium.launch();
const pag = await (await nav.newContext()).newPage();
let travou = false;
pag.on("dialog", async (d)=>{ travou = true; await d.dismiss(); });   // não pode aparecer nenhum
const problemas=[]; pag.on("pageerror",e=>problemas.push(e.message));

await pag.addInitScript(()=>localStorage.clear());
await pag.goto(B,{waitUntil:"networkidle"});
// As áreas nascem fechadas: 97 temas abertos davam 13.000px de rolagem.
// Para mexer nas linhas, abre todas.
const abrirAreas = () => pag.evaluate(() =>
  document.querySelectorAll("#lista details").forEach((d) => { d.open = true; }));
await abrirAreas();
const cont = ()=>pag.locator("#lista .row").count();
const cob  = ()=>pag.locator("#stCob").textContent();

console.log("\n1. Registrar e desfazer");
const cobInicial = await cob();
await pag.locator("#lista .row").first().locator("button.reg").click();
await pag.locator("#regOk").click();
await pag.locator("#dlgReg").waitFor({state:"hidden"});
await pag.waitForTimeout(300);

const visivel = await pag.locator("#aviso").getAttribute("data-visivel");
visivel==="1" ? ok(`aviso apareceu: "${(await pag.locator("#avisoTexto").textContent()).trim()}"`) : erro("nenhum aviso ao registrar");
(await cob()) !== cobInicial ? ok("registro contabilizado") : erro("cobertura não mudou");

await pag.locator("#avisoAcao").click();
await pag.waitForTimeout(400);
(await cob()) === cobInicial ? ok("desfazer devolveu a cobertura ao valor original") : erro(`cobertura ficou ${await cob()}, era ${cobInicial}`);
(await pag.locator("#aviso").getAttribute("data-visivel"))==="0" ? ok("aviso sumiu ao desfazer") : erro("aviso continuou visível");

console.log("\n2. Remover e desfazer");
const antes = await cont();
const nomeAlvo = await pag.locator("#lista .row").first().locator(".nome").textContent();
await pag.locator("#lista .row").first().locator("button.reg").click();
await pag.locator("#dlgReg").waitFor({state:"visible"});
await pag.locator("#regRemover").click();
await pag.locator("#dlgReg").waitFor({state:"hidden"});
await pag.waitForTimeout(300);
(await cont()) === antes-1 ? ok("removeu sem pedir confirmação") : erro(`linhas: ${antes} -> ${await cont()}`);

await pag.locator("#avisoAcao").click();
await pag.waitForTimeout(400);
(await cont()) === antes ? ok("desfazer trouxe o tema de volta") : erro(`linhas: ${await cont()}, esperava ${antes}`);
const voltou = await pag.evaluate((n)=>[...document.querySelectorAll("#lista .nome")].some(e=>e.textContent===n), nomeAlvo);
voltou ? ok(`"${nomeAlvo}" voltou pelo nome`) : erro("o tema que voltou não é o mesmo");

console.log("\n3. Nada bloqueia a página");
travou ? erro("apareceu um alert/confirm nativo") : ok("nenhum alert ou confirm nativo");

console.log("\n4. O aviso some sozinho");
await pag.waitForTimeout(7500);
(await pag.locator("#aviso").getAttribute("data-visivel"))==="0" ? ok("aviso expirou sozinho") : erro("aviso ficou preso na tela");

problemas.length ? erro("erros: "+problemas.join(" | ")) : ok("console limpo");
await nav.close();
console.log(falhas.length?`\n${falhas.length} FALHA(S)\n`:"\nDesfazer ok.\n");
process.exit(falhas.length?1:0);
