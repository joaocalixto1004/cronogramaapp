import { chromium } from "playwright";
import { SEMENTE, idTema } from "../../logica.js";
const B = process.env.RITMO_URL ?? "http://localhost:8788";
const falhas = [];
const ok = (m)=>console.log("  ok   "+m);
const erro = (m)=>{falhas.push(m);console.log("  FALHA "+m);};

// Estado no formato v1, com ids por índice — como está hoje no seu navegador.
const iTb = SEMENTE.findIndex(([,n])=>n==="Tuberculose");
const iAp = SEMENTE.findIndex(([,n])=>n==="Apendicite aguda");
const velho = {
  prova:{nome:"USP", data:"2026-11-15"},
  temas: SEMENTE.map((t,i)=>({id:"t"+i, area:t[0], nome:t[1], peso:t[2], etapa:0, proxima:null, historico:[]}))
};
velho.temas[iTb].historico=[{d:"2026-01-01",a:90},{d:"2026-01-08",a:85}];
velho.temas[iAp].historico=[{d:"2026-02-01",a:40}];
velho.temas.splice(SEMENTE.findIndex(([,n])=>n==="Anemias"),1);          // tema apagado
velho.temas.push({id:"t1700000000000",area:"Cirurgia",nome:"Tema Meu",peso:1,etapa:0,proxima:null,historico:[{d:"2026-03-01",a:70}]});

const nav = await chromium.launch();
const ctx = await nav.newContext();
const pag = await ctx.newPage();
await pag.addInitScript((v)=>localStorage.setItem("ritmo.v1", JSON.stringify(v)), velho);
await pag.goto(B,{waitUntil:"networkidle"});
await pag.waitForFunction(()=>document.getElementById("sync").dataset.estado==="ok",null,{timeout:10000}).catch(()=>{});

const cob = await pag.locator("#stCob").textContent();
cob === `3/${SEMENTE.length}` ? ok(`cobertura migrada: ${cob}`) : erro(`stCob=${cob}, esperava 3/${SEMENTE.length}`);

const provaNome = await pag.locator("#provaNome").textContent();
provaNome==="USP" ? ok("prova migrada") : erro("prova: "+provaNome);

const temTb = await pag.locator(`[data-reg="${idTema("Clínica Médica","Tuberculose")}"]`).count();
temTb ? ok("Tuberculose migrou para id estável") : erro("Tuberculose não encontrada pelo id novo");

const temAnemias = await pag.getByText("Anemias",{exact:true}).count();
temAnemias===0 ? ok("tema apagado continua apagado") : erro("tema apagado reapareceu");

const temMeu = await pag.getByText("Tema Meu",{exact:true}).count();
temMeu ? ok("tema criado à mão migrou") : erro("tema personalizado sumiu");

// A chave antiga precisa sobreviver como rede de segurança.
const guardou = await pag.evaluate(()=>!!localStorage.getItem("ritmo.v1"));
guardou ? ok("ritmo.v1 preservado como backup") : erro("ritmo.v1 foi apagado");

// Recarregar não pode duplicar nada.
await pag.reload({waitUntil:"networkidle"});
await pag.waitForTimeout(1500);
const cob2 = await pag.locator("#stCob").textContent();
cob2===cob ? ok("recarregar não duplica a migração") : erro(`apos reload: ${cob2} (antes ${cob})`);

await nav.close();
console.log(falhas.length?`\n${falhas.length} FALHA(S)\n`:"\nMigração ok.\n");
process.exit(falhas.length?1:0);
