/* ============================================================
   Ritmo — cronograma de residência médica

   O log de eventos é a fonte da verdade; o que se vê na tela é sempre
   derivado dele. Nada aqui edita estado no lugar — registrar um estudo
   acrescenta um fato, e a tela é recalculada do zero.
============================================================ */

import * as sync from "./sync.js";
import {
  INTERVALOS, AREAS, ID_VALIDO,
  idTema, hoje, diasEntre, somaDias, fmt,
  ultimo, desempenho, atraso, prioridade,
  derivar, eventosDoFormatoAntigo, filaDeHoje,
} from "./logica.js";

const CHAVE_ANTIGA = "ritmo.v1";
const MARCA_MIGRACAO = "ritmo.migrado.v2";

const $ = (id) => document.getElementById(id);
// Não há mais escape de HTML neste arquivo: todo texto vindo do usuário entra
// por textContent. O único innerHTML restante é o SVG do traço, gerado aqui.

/* ---------- estado de tela ---------- */
let dados = { prova: { nome: "a prova", data: "" }, temas: [] };
let filtro = "todos";
let alvoId = null;

/* ---------- migração do formato antigo ---------- */
function migrar() {
  if (localStorage.getItem(MARCA_MIGRACAO)) return;
  try {
    const bruto = localStorage.getItem(CHAVE_ANTIGA);
    if (bruto) {
      const novos = eventosDoFormatoAntigo(JSON.parse(bruto));
      if (novos.length) sync.semear(novos);
    }
  } catch (e) {
    console.warn("nada a migrar do formato antigo:", e);
  }
  localStorage.setItem(MARCA_MIGRACAO, "1");
  // A chave antiga fica onde está, de propósito: rede de segurança.
}

/* ---------- curva de retenção (SVG) ---------- */
function tracado(t) {
  const W = 84, H = 26, hj = hoje();
  const marcos = t.historico.slice(-4);
  if (!marcos.length) {
    return `<svg class="trace" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <line x1="0" y1="${H - 3}" x2="${W}" y2="${H - 3}" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="3 3"/></svg>`;
  }
  const inicio = marcos[0].d;
  const span = Math.max(diasEntre(inicio, hj), 1);
  let d = "", cor = "var(--verde)";
  marcos.forEach((m, i) => {
    const x0 = (diasEntre(inicio, m.d) / span) * W;
    const fim = i < marcos.length - 1 ? diasEntre(inicio, marcos[i + 1].d) : span;
    const x1 = (fim / span) * W;
    const topo = H - 3 - (H - 8) * (m.a / 100);
    d += `M${x0.toFixed(1)},${topo.toFixed(1)} `;
    for (let s = 1; s <= 6; s++) {
      const x = x0 + (x1 - x0) * (s / 6);
      const decai = Math.exp(-1.05 * (s / 6));
      const y = H - 3 - (H - 8) * (m.a / 100) * (0.35 + 0.65 * decai);
      d += `L${x.toFixed(1)},${y.toFixed(1)} `;
    }
  });
  const u = ultimo(t).a;
  if (u < 60) cor = "var(--vermelho)"; else if (u < 80) cor = "var(--ambar)";
  const pontos = marcos.map((m) => {
    const x = (diasEntre(inicio, m.d) / span) * W;
    const y = H - 3 - (H - 8) * (m.a / 100);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="${cor}"/>`;
  }).join("");
  return `<svg class="trace" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Retenção estimada: último desempenho ${u}%">
    <line x1="0" y1="${H - 3}" x2="${W}" y2="${H - 3}" stroke="var(--rule)" stroke-width="1"/>
    <path d="${d}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linejoin="round"/>${pontos}</svg>`;
}

/* ---------- render ---------- */
function render() {
  const dias = dados.prova.data ? diasEntre(hoje(), dados.prova.data) : null;
  $("dias").textContent = dias === null ? "—" : dias < 0 ? "0" : dias;
  $("provaNome").textContent = dados.prova.nome || "a prova";
  $("provaData").textContent = dados.prova.data
    ? new Date(dados.prova.data + "T00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
    : "Defina a data em “ajustar prova” para ver a contagem.";

  const ts = dados.temas;
  const cob = ts.filter((t) => t.historico.length).length;
  const atr = ts.filter((t) => { const a = atraso(t); return a !== null && a > 0; }).length;
  const notas = ts.map(desempenho).filter((n) => n !== null);
  $("stCob").textContent = cob + "/" + ts.length;
  $("stAtr").textContent = atr;
  $("stAce").textContent = notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) / notas.length) + "%" : "—";
  $("stSeq").textContent = sequencia() + "d";

  renderFila(ts);
  renderLista(ts);
}

function sequencia() {
  const dias = new Set(dados.temas.flatMap((t) => t.historico.map((h) => h.d)));
  let n = 0, cursor = hoje();
  if (!dias.has(cursor)) cursor = somaDias(cursor, -1); // o dia ainda não acabou
  while (dias.has(cursor)) { n++; cursor = somaDias(cursor, -1); }
  return n;
}

/* ---------- render incremental ----------
   Antes, cada ação refazia o innerHTML da lista inteira: 75 linhas e 75 SVGs
   reconstruídos para mudar uma. Agora cada tema tem um nó de DOM próprio,
   reaproveitado entre renders, e só o que mudou é reescrito.

   De quebra, o texto vindo do usuário passa a entrar por textContent em vez
   de concatenação de HTML — não há mais o que escapar. */

const MOLDE_LINHA = document.createElement("template");
MOLDE_LINHA.innerHTML =
  `<div class="row"><div class="main">` +
  `<div class="tema"><i class="peso"></i><span class="nome"></span></div>` +
  `<div class="meta"></div></div>` +
  `<div class="right"><span class="traco"></span>` +
  `<button class="reg">registrar</button>` +
  `<button class="del" title="remover tema">×</button></div></div>`;

const MOLDE_AREA = document.createElement("template");
MOLDE_AREA.innerHTML =
  `<section class="areablock"><div class="areahead">` +
  `<h3></h3><div class="bar-prog"><i></i></div><span class="eyebrow"></span>` +
  `</div></section>`;

const linhas = new Map();   // id do tema -> nó e assinaturas
const blocos = new Map();   // área -> nó

/* Assinaturas: o que precisa mudar na tela para a linha valer um retoque.
   O traço tem a sua própria porque gerar o SVG é o passo caro. */
const assinaturaLinha = (t, hj) =>
  `${t.nome}|${t.area}|${t.peso}|${t.proxima}|${ultimo(t)?.d ?? ""}|${ultimo(t)?.a ?? ""}|${hj}`;
const assinaturaTraco = (t, hj) =>
  `${hj}|${t.historico.slice(-4).map((h) => h.d + ":" + h.a).join(",")}`;

function criarLinha(id) {
  const el = MOLDE_LINHA.content.firstElementChild.cloneNode(true);
  const reg = el.querySelector(".reg");
  const del = el.querySelector(".del");
  reg.dataset.reg = id;
  del.dataset.del = id;
  return {
    el,
    peso: el.querySelector(".peso"),
    nome: el.querySelector(".nome"),
    meta: el.querySelector(".meta"),
    traco: el.querySelector(".traco"),
    del,
    assin: null,
    assinTraco: null,
  };
}

/** Os trechos de "último X • Y% acertos • revisar Z" da linha. */
function pedacosMeta(t) {
  const d = desempenho(t), a = atraso(t), u = ultimo(t);
  const partes = [];
  if (u) partes.push(["", `último ${fmt(u.d)}`]);
  if (d !== null) partes.push([d >= 70 ? "ok" : "due", `${d}% acertos`]);
  if (a !== null) partes.push(a > 0 ? ["due", `revisar — ${a}d atrás`] : ["", `revisar ${fmt(t.proxima)}`]);
  if (!partes.length) partes.push(["", "ainda não estudado"]);
  return partes;
}

function atualizarLinha(l, t, hj) {
  const assin = assinaturaLinha(t, hj);
  if (l.assin === assin) return;
  l.assin = assin;

  l.peso.className = `peso p${t.peso}`;
  l.peso.title = `incidência ${t.peso}/3`;
  l.nome.textContent = t.nome;
  l.del.setAttribute("aria-label", `Remover ${t.nome}`);

  l.meta.replaceChildren(...pedacosMeta(t).map(([classe, texto]) => {
    const s = document.createElement("span");
    if (classe) s.className = classe;
    s.textContent = texto;
    return s;
  }));

  const at = assinaturaTraco(t, hj);
  if (l.assinTraco !== at) {
    l.assinTraco = at;
    l.traco.innerHTML = tracado(t);      // SVG gerado por nós, sem dado do usuário
  }
}

function renderLista(ts) {
  const hj = hoje();
  let visiveis = ts;
  if (filtro === "pendentes") visiveis = ts.filter((t) => { const a = atraso(t); return a === null || a >= 0; });
  if (filtro === "fracos") visiveis = ts.filter((t) => { const d = desempenho(t); return d !== null && d < 70; });

  const alvo = $("lista");
  const ordem = AREAS.concat([...new Set(ts.map((t) => t.area))].filter((a) => !AREAS.includes(a)));
  const mostrados = new Set();
  const secoes = [];

  for (const area of ordem) {
    const doGrupo = visiveis.filter((t) => t.area === area).sort((a, b) => prioridade(b, hj) - prioridade(a, hj));
    if (!doGrupo.length) continue;

    let bloco = blocos.get(area);
    if (!bloco) {
      const el = MOLDE_AREA.content.firstElementChild.cloneNode(true);
      el.querySelector("h3").textContent = area;
      bloco = { el, barra: el.querySelector(".bar-prog i"), pct: el.querySelector(".eyebrow") };
      blocos.set(area, bloco);
    }

    const todos = ts.filter((t) => t.area === area);
    const pct = todos.length ? Math.round((todos.filter((t) => t.historico.length).length / todos.length) * 100) : 0;
    // Largura pelo CSSOM: a CSP estrita bloqueia style="" no markup, não isto.
    bloco.barra.style.width = pct + "%";
    bloco.pct.textContent = pct + "%";

    // Percorre na ordem desejada arrastando uma âncora: só encosta no DOM
    // a linha que está fora de lugar. O cabeçalho da área é a âncora inicial.
    let ancora = bloco.el.firstElementChild;
    for (const t of doGrupo) {
      let l = linhas.get(t.id);
      if (!l) { l = criarLinha(t.id); linhas.set(t.id, l); }
      atualizarLinha(l, t, hj);
      mostrados.add(t.id);
      if (ancora.nextSibling !== l.el) bloco.el.insertBefore(l.el, ancora.nextSibling);
      ancora = l.el;
    }
    secoes.push(bloco.el);
  }

  // Sai do DOM mas fica no cache: alternar filtro é a ação mais repetida, e
  // reconstruir a linha (incluindo o SVG) só para ela voltar seria desperdício.
  // O cache é limitado pelo número de temas que já existiram — dezenas.
  for (const [id, l] of linhas) if (!mostrados.has(id)) l.el.remove();

  if (!secoes.length) {
    const p = document.createElement("p");
    p.className = "semfiltro";
    p.textContent = "Nenhum tema neste filtro.";
    alvo.replaceChildren(p);
    blocos.clear();
    return;
  }

  // Mesma técnica de âncora para as seções: um filtro que esvazia uma área
  // não deve remexer as outras.
  if (alvo.firstElementChild?.className === "semfiltro") alvo.replaceChildren();
  let ancora = null;
  for (const sec of secoes) {
    const esperado = ancora ? ancora.nextSibling : alvo.firstChild;
    if (esperado !== sec) alvo.insertBefore(sec, esperado);
    ancora = sec;
  }
  while (ancora.nextSibling) ancora.nextSibling.remove();
}

function renderFila(ts) {
  const { meta, feitos, itens, restam } = filaDeHoje(ts, dados.prova.data);
  const plural = (n) => (n > 1 ? "s" : "");

  $("tituloFila").textContent =
    !restam ? "Tudo em dia"
    : itens.length ? `${itens.length} de ${meta} para hoje${feitos ? ` — ${feitos} já registrado${plural(feitos)}` : ""}`
    : `Meta do dia cumprida — ${feitos} registrado${plural(feitos)}`;

  if (!itens.length) {
    const li = document.createElement("li");
    li.className = "vazio";
    li.textContent = restam
      ? "Meta do dia cumprida. Parar aqui é o que consolida — o resto está agendado."
      : "Tudo em dia. Um descanso também consolida memória.";
    $("fila").replaceChildren(li);
    return;
  }

  $("fila").replaceChildren(...itens.map((t) => {
    const a = atraso(t);
    const [classe, rotulo] =
      a === null ? ["novo", "novo"]
      : a > 0 ? ["atr", `${a}d atrás`]
      : a === 0 ? ["hoje", "hoje"]
      : ["novo", "antecipar"];

    const li = document.createElement("li");
    const tag = document.createElement("span");
    tag.className = `tag ${classe}`;
    tag.textContent = rotulo;
    const nome = document.createElement("span");
    nome.className = "nome";
    nome.textContent = t.nome;
    const area = document.createElement("span");
    area.className = "area";
    area.textContent = t.area.split(" ")[0];
    const bt = document.createElement("button");
    bt.dataset.reg = t.id;
    bt.textContent = "registrar";

    li.append(tag, nome, area, bt);
    return li;
  }));
}

/* ---------- avisos ----------
   No lugar de alert() e confirm(), que travam a página e não cabem no meio
   de uma sessão de estudo. Remover e registrar acontecem na hora e ficam
   desfazíveis por alguns segundos — mais rápido que confirmar toda vez, e
   mais seguro, porque cobre também o clique errado que um confirm aprovaria. */
const AVISO_SEGUNDOS = 7;
let avisoTimer = null;

function avisar(texto, acao) {
  const caixa = $("aviso"), bt = $("avisoAcao");
  clearTimeout(avisoTimer);
  $("avisoTexto").textContent = texto;

  bt.hidden = !acao;
  bt.onclick = null;
  if (acao) {
    bt.textContent = acao.rotulo;
    bt.onclick = () => { esconderAviso(); acao.aoClicar(); };
  }

  caixa.dataset.visivel = "1";
  if (!acao?.fixo) avisoTimer = setTimeout(esconderAviso, AVISO_SEGUNDOS * 1000);
}
function esconderAviso() {
  clearTimeout(avisoTimer);
  $("aviso").dataset.visivel = "0";
}

/* ---------- ponte com o log ---------- */
function recalcular() {
  dados = derivar(sync.todos());
  render();
}
function registrarEvento(tipo, dadosEv) {
  const ev = sync.adicionar(tipo, dadosEv);
  recalcular();
  return ev;
}

/* ---------- interações ---------- */
document.addEventListener("click", (e) => {
  const reg = e.target.closest("[data-reg]");
  if (reg) { abrirRegistro(reg.dataset.reg); return; }
  const del = e.target.closest("[data-del]");
  if (del) {
    const t = dados.temas.find((x) => x.id === del.dataset.del);
    if (!t) return;
    registrarEvento("tema-", { tema: t.id });
    avisar(`“${t.nome}” saiu do cronograma.`, {
      rotulo: "desfazer",
      aoClicar: () => registrarEvento("tema+", { tema: t.id, nome: t.nome, area: t.area, peso: t.peso }),
    });
  }
});

const dlgReg = $("dlgReg");
const rangeAc = $("regAcertos");
function abrirRegistro(id) {
  const t = dados.temas.find((x) => x.id === id);
  if (!t) return;
  alvoId = id;
  $("regTema").textContent = t.nome;
  $("regArea").textContent = t.area;
  $("regData").value = hoje();
  rangeAc.value = desempenho(t) ?? 70;
  atualizaHint();
  dlgReg.showModal();
}
function atualizaHint() {
  const v = +rangeAc.value;
  $("regOut").textContent = v + "%";
  const t = dados.temas.find((x) => x.id === alvoId);
  const etapa = v >= 80 ? Math.min((t?.etapa ?? 0) + 1, INTERVALOS.length - 1) : v >= 60 ? (t?.etapa ?? 0) : 0;
  $("regHint").textContent =
    v >= 80 ? `Bom domínio — próxima revisão em ${INTERVALOS[etapa]} dias.`
    : v >= 60 ? `Parcial — mantém o intervalo: revisão em ${INTERVALOS[etapa]} dias.`
    : "Abaixo de 60% reinicia o ciclo: revisão amanhã.";
}
rangeAc.addEventListener("input", atualizaHint);
dlgReg.addEventListener("close", () => {
  if (dlgReg.returnValue !== "ok") return;
  const t = dados.temas.find((x) => x.id === alvoId);
  if (!t) return;
  const acertos = +rangeAc.value;
  const ev = registrarEvento("estudo", { tema: t.id, data: $("regData").value || hoje(), acertos });
  const novo = dados.temas.find((x) => x.id === t.id);
  avisar(`${t.nome}: ${acertos}% — volta em ${fmt(novo?.proxima)}`, {
    rotulo: "desfazer",
    aoClicar: () => registrarEvento("estudo-", { evento: ev.id }),
  });
});

const dlgNovo = $("dlgNovo");
$("btnNovo").addEventListener("click", () => {
  const areas = [...new Set(AREAS.concat(dados.temas.map((t) => t.area)))];
  $("nvArea").replaceChildren(...areas.map((a) => new Option(a, a)));
  $("nvNome").value = "";
  dlgNovo.showModal();
});
dlgNovo.addEventListener("close", () => {
  if (dlgNovo.returnValue !== "ok") return;
  const nome = $("nvNome").value.trim();
  const area = $("nvArea").value;
  if (!nome) return;
  const id = idTema(area, nome);
  if (!ID_VALIDO.test(id)) {
    avisar("Use ao menos uma letra ou número no nome do tema.");
    return;
  }
  registrarEvento("tema+", { tema: id, nome, area, peso: +$("nvPeso").value });
});

const dlgProva = $("dlgProva");
$("btnProva").addEventListener("click", () => {
  $("pvNome").value = dados.prova.nome === "a prova" ? "" : dados.prova.nome;
  $("pvData").value = dados.prova.data;
  dlgProva.showModal();
});
dlgProva.addEventListener("close", () => {
  if (dlgProva.returnValue !== "ok") return;
  registrarEvento("prova", { nome: $("pvNome").value.trim(), data: $("pvData").value || "" });
});

document.querySelectorAll("[data-filtro]").forEach((b) => {
  b.addEventListener("click", () => {
    filtro = b.dataset.filtro;
    document.querySelectorAll("[data-filtro]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderLista(dados.temas);
  });
});

/* ---------- backup manual ----------
   Deixou de ser o mecanismo de backup (isso agora é o servidor) e passou a ser
   saída de emergência: levar o histórico para fora, ou trazer de um arquivo. */
$("btnExp").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ versao: 2, eventos: sync.todos() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ritmo-${hoje()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("btnImp").addEventListener("click", () => $("fileImp").click());
$("fileImp").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const arq = JSON.parse(await f.text());
    // v2 traz eventos; um export v1 antigo traz {temas:[...]} e é convertido.
    const lista = Array.isArray(arq?.eventos) ? arq.eventos
      : Array.isArray(arq?.temas) ? eventosDoFormatoAntigo(arq)
      : null;
    if (!lista) throw new Error("formato");
    const n = sync.importar(lista);
    recalcular();
    avisar(n ? `${n} evento${n > 1 ? "s" : ""} importado${n > 1 ? "s" : ""}.` : "Nada novo: o arquivo já estava todo aqui.");
  } catch {
    avisar("Este arquivo não é um backup do Ritmo. Selecione um .json exportado pelo próprio app.");
  }
  e.target.value = "";
});

/* ---------- estado da sincronização ---------- */
const TEXTO_SYNC = {
  ok: () => "tudo sincronizado",
  pendente: (n) => `${n} registro${n > 1 ? "s" : ""} aguardando envio`,
  offline: (n) => (n ? `offline — ${n} registro${n > 1 ? "s" : ""} na fila` : "offline"),
  erro: () => "",
};
sync.aoMudar(({ estado, detalhe, pendentes, recarregar }) => {
  const el = $("sync");
  el.dataset.estado = estado;
  el.textContent = detalhe || TEXTO_SYNC[estado]?.(pendentes) || "";
  if (recarregar) recalcular();
});

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const novo = reg.installing;
      novo?.addEventListener("statechange", () => {
        // controller existente = já havia uma versão rodando, logo é atualização.
        if (novo.state === "installed" && navigator.serviceWorker.controller) {
          // fixo: uma atualização não deve sumir sozinha antes de ser vista.
          avisar("Nova versão disponível.", {
            rotulo: "recarregar", fixo: true,
            aoClicar: () => novo.postMessage({ tipo: "assumir" }),
          });
        }
      });
    });
  }).catch(() => {});

  let recarregando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recarregando) return;
    recarregando = true;
    location.reload();
  });
}

/* ---------- início ---------- */
migrar();
sync.iniciar();
recalcular();
