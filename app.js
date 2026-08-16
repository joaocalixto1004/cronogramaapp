/* ============================================================
   Ritmo — cronograma de residência médica

   O log de eventos é a fonte da verdade; o que se vê na tela é sempre
   derivado dele. Nada aqui edita estado no lugar — registrar um estudo
   acrescenta um fato, e a tela é recalculada do zero.
============================================================ */

import * as sync from "./sync.js";
import {
  INTERVALOS, AREAS, PERFIS, PERFIL_PADRAO, ID_VALIDO, NOME_FASE,
  ROTINA_PADRAO, BLOCO_PADRAO,
  slug, idTema, hoje, diasEntre, somaDias, fmt,
  ultimo, desempenho, atraso, prioridade, pesoDe, questoesFeitas,
  provaAlvo, fase, intervaloAjustado, duracaoTipica, planoDoDia,
  derivar, eventosDoFormatoAntigo,
} from "./logica.js";

const CHAVE_ANTIGA = "ritmo.v1";
const MARCA_MIGRACAO = "ritmo.migrado.v2";
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const $ = (id) => document.getElementById(id);
// Não há escape de HTML neste arquivo: todo texto vindo do usuário entra por
// textContent. O único innerHTML restante é o SVG do traço, gerado aqui.

/* ---------- estado de tela ---------- */
let dados = { provas: [], rotina: ROTINA_PADRAO, simulados: [], temas: [] };
let alvo = null;                 // prova mais próxima ainda não realizada
let filtro = "todos";
let alvoId = null;               // tema aberto no diálogo de registro
let provaEditando = null;        // prova em correção no diálogo de provas

const horas = (min) => {
  if (!min) return "0";
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h${String(m).padStart(2, "0")}` : h ? `${h}h` : `${m}min`;
};

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

/* ---------- render incremental ----------
   Cada tema tem um nó de DOM próprio, reaproveitado entre renders: só o que
   mudou é reescrito, em vez de refazer a lista inteira a cada ação. */

const MOLDE_LINHA = document.createElement("template");
MOLDE_LINHA.innerHTML =
  `<div class="row"><div class="main">` +
  `<div class="tema"><i class="peso"></i><span class="nome"></span></div>` +
  `<div class="meta"></div></div>` +
  `<span class="traco"></span>` +
  `<button class="reg">registrar</button></div>`;

// <details>: 97 temas abertos de uma vez davam 13.000px de rolagem no celular.
const MOLDE_AREA = document.createElement("template");
MOLDE_AREA.innerHTML =
  `<details class="areablock"><summary class="areahead">` +
  `<h3></h3><div class="bar-prog"><i></i></div><span class="resumo"></span>` +
  `</summary></details>`;

/* Quais áreas ficam abertas é preferência de tela, não dado de estudo: mora
   no localStorage e não no log de eventos. */
const CHAVE_AREAS = "ritmo.areas.v1";
let areasAbertas = new Set();
try { areasAbertas = new Set(JSON.parse(localStorage.getItem(CHAVE_AREAS) ?? "[]")); }
catch { /* preferência ilegível: começa tudo fechado */ }
function guardarAreas() {
  try { localStorage.setItem(CHAVE_AREAS, JSON.stringify([...areasAbertas])); } catch { /* sem espaço */ }
}

const linhas = new Map();
const blocos = new Map();

const assinaturaLinha = (t, hj, perfil) =>
  `${t.nome}|${t.area}|${pesoDe(t, perfil)}|${t.proxima}|${ultimo(t)?.d ?? ""}|${ultimo(t)?.a ?? ""}|${questoesFeitas(t)}|${hj}`;
const assinaturaTraco = (t, hj) =>
  `${hj}|${t.historico.slice(-4).map((h) => h.d + ":" + h.a).join(",")}`;

function criarLinha(id) {
  const el = MOLDE_LINHA.content.firstElementChild.cloneNode(true);
  el.querySelector(".reg").dataset.reg = id;
  return {
    el,
    peso: el.querySelector(".peso"),
    nome: el.querySelector(".nome"),
    meta: el.querySelector(".meta"),
    traco: el.querySelector(".traco"),
    assin: null,
    assinTraco: null,
  };
}

function pedacosMeta(t) {
  const d = desempenho(t), a = atraso(t), u = ultimo(t), q = questoesFeitas(t);
  const partes = [];
  if (u) partes.push(["", `último ${fmt(u.d)}`]);
  if (d !== null) partes.push([d >= 70 ? "ok" : "due", `${d}% acertos`]);
  if (q) partes.push(["", `${q} questões`]);
  if (a !== null) partes.push(a > 0 ? ["due", `revisar — ${a}d atrás`] : ["", `revisar ${fmt(t.proxima)}`]);
  if (!partes.length) partes.push(["", "ainda não estudado"]);
  return partes;
}

function atualizarLinha(l, t, hj, perfil) {
  const assin = assinaturaLinha(t, hj, perfil);
  if (l.assin === assin) return;
  l.assin = assin;

  const peso = Math.round(pesoDe(t, perfil));
  l.peso.className = `peso p${peso}`;
  l.peso.title = `incidência ${peso}/3`;
  l.nome.textContent = t.nome;

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
  const perfil = alvo?.perfil ?? PERFIL_PADRAO;
  let visiveis = ts;
  if (filtro === "pendentes") visiveis = ts.filter((t) => { const a = atraso(t); return a === null || a >= 0; });
  if (filtro === "fracos") visiveis = ts.filter((t) => { const d = desempenho(t); return d !== null && d < 70; });

  const destino = $("lista");
  const ordem = AREAS.concat([...new Set(ts.map((t) => t.area))].filter((a) => !AREAS.includes(a)));
  const mostrados = new Set();
  const secoes = [];

  for (const area of ordem) {
    const doGrupo = visiveis.filter((t) => t.area === area)
      .sort((a, b) => prioridade(b, hj, alvo) - prioridade(a, hj, alvo));
    if (!doGrupo.length) continue;

    let bloco = blocos.get(area);
    if (!bloco) {
      const el = MOLDE_AREA.content.firstElementChild.cloneNode(true);
      el.querySelector("h3").textContent = area;
      el.addEventListener("toggle", () => {
        // Abertura forçada por filtro é temporária, não vira preferência.
        if (filtro !== "todos") return;
        if (el.open) areasAbertas.add(area); else areasAbertas.delete(area);
        guardarAreas();
      });
      bloco = { el, barra: el.querySelector(".bar-prog i"), resumo: el.querySelector(".resumo") };
      blocos.set(area, bloco);
    }

    const todos = ts.filter((t) => t.area === area);
    const cobertos = todos.filter((t) => t.historico.length).length;
    const atrasadas = todos.filter((t) => { const a = atraso(t, hj); return a !== null && a > 0; }).length;
    const pct = todos.length ? Math.round((cobertos / todos.length) * 100) : 0;

    // Largura pelo CSSOM: a CSP estrita bloqueia style="" no markup, não isto.
    bloco.barra.style.width = pct + "%";
    // Fechada, a área precisa dizer sozinha se merece atenção.
    bloco.resumo.className = "resumo" + (atrasadas ? " atrasadas" : "");
    bloco.resumo.textContent = atrasadas
      ? `${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}`
      : `${cobertos}/${todos.length}`;

    // Filtrar é pedir para ver o resultado: abre as áreas que sobraram.
    bloco.el.open = filtro !== "todos" || areasAbertas.has(area);

    let ancora = bloco.el.firstElementChild;
    for (const t of doGrupo) {
      let l = linhas.get(t.id);
      if (!l) { l = criarLinha(t.id); linhas.set(t.id, l); }
      atualizarLinha(l, t, hj, perfil);
      mostrados.add(t.id);
      if (ancora.nextSibling !== l.el) bloco.el.insertBefore(l.el, ancora.nextSibling);
      ancora = l.el;
    }
    secoes.push(bloco.el);
  }

  // Sai do DOM mas fica em cache: alternar filtro é a ação mais repetida.
  for (const [id, l] of linhas) if (!mostrados.has(id)) l.el.remove();

  if (!secoes.length) {
    const p = document.createElement("p");
    p.className = "semfiltro";
    p.textContent = "Nenhum tema neste filtro.";
    destino.replaceChildren(p);
    blocos.clear();
    return;
  }

  if (destino.firstElementChild?.className === "semfiltro") destino.replaceChildren();
  let ancora = null;
  for (const sec of secoes) {
    const esperado = ancora ? ancora.nextSibling : destino.firstChild;
    if (esperado !== sec) destino.insertBefore(sec, esperado);
    ancora = sec;
  }
  while (ancora.nextSibling) ancora.nextSibling.remove();
}

/* ---------- plano do dia ---------- */
function renderPlano() {
  const p = planoDoDia(dados.temas, dados.rotina, dados.provas, hoje());
  const plural = (n) => (n > 1 ? "s" : "");

  $("hojeMinutos").textContent = p.minutosDisponiveis
    ? `${horas(p.minutosFeitos)} de ${horas(p.minutosDisponiveis)}${p.questoesHoje ? ` · ${p.questoesHoje} questões` : ""}`
    : "dia sem horas na rotina";

  $("barraDia").style.width =
    p.minutosDisponiveis ? Math.min(100, Math.round((p.minutosFeitos / p.minutosDisponiveis) * 100)) + "%" : "0%";

  const chip = $("chipFase");
  chip.hidden = false;
  chip.dataset.fase = p.fase;
  chip.textContent = NOME_FASE[p.fase];

  // Só a sequência: "N temas na fila" contava todo tema não estudado hoje,
  // ou seja, quase o catálogo inteiro — número grande e sem significado.
  const seq = sequencia();
  $("hojeRodape").textContent = seq
    ? `${seq} dia${seq > 1 ? "s" : ""} seguido${seq > 1 ? "s" : ""} de estudo`
    : "";

  $("tituloFila").textContent =
    !p.minutosDisponiveis ? "Hoje é dia de descanso"
    : p.blocos.length ? `${p.blocos.length} bloco${plural(p.blocos.length)} para hoje`
    : p.minutosFeitos ? "Plano do dia cumprido"
    : "Nada pendente";

  if (!p.blocos.length) {
    const li = document.createElement("li");
    li.className = "vazio";
    li.textContent =
      !p.minutosDisponiveis ? "Sua rotina não prevê estudo hoje. Descanso também consolida memória."
      : p.minutosFeitos ? "Meta de hoje cumprida. Parar aqui é o que consolida — o resto está agendado."
      : "Tudo em dia.";
    $("fila").replaceChildren(li);
    return;
  }

  $("fila").replaceChildren(...p.blocos.map((b) => {
    const li = document.createElement("li");

    const min = document.createElement("span");
    min.className = "min";
    min.textContent = `${b.minutos}min`;

    const nome = document.createElement("span");
    nome.className = "nome";
    nome.textContent = b.tema.nome;

    const motivo = document.createElement("span");
    motivo.className = "motivo";
    motivo.textContent = b.motivo;

    const area = document.createElement("span");
    area.className = "area";
    area.textContent = b.tema.area.split(" ")[0];

    const bt = document.createElement("button");
    bt.dataset.reg = b.tema.id;
    bt.textContent = "registrar";

    li.append(min, nome, motivo, area, bt);
    return li;
  }));
}

/* ---------- render ---------- */
function render() {
  alvo = provaAlvo(dados.provas, hoje());

  const dias = alvo ? diasEntre(hoje(), alvo.data) : null;
  $("dias").textContent = dias === null ? "—" : dias < 0 ? "0" : dias;
  $("provaNome").textContent = alvo?.nome || "a prova";
  $("provaData").textContent = alvo
    ? new Date(alvo.data + "T00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
    : "Cadastre suas provas para ver a contagem e o ritmo se ajustarem.";

  const seguinte = dados.provas.filter((x) => x.data && x.data > (alvo?.data ?? ""))[0];
  $("provaSeguinte").textContent = seguinte
    ? `depois: ${seguinte.nome} em ${new Date(seguinte.data + "T00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`
    : "";

  const ts = dados.temas;
  const cob = ts.filter((t) => t.historico.length).length;
  const atr = ts.filter((t) => { const a = atraso(t); return a !== null && a > 0; }).length;
  const notas = ts.map(desempenho).filter((n) => n !== null);
  const qst = ts.reduce((s, t) => s + questoesFeitas(t), 0);

  $("stCob").textContent = cob + "/" + ts.length;
  $("stAtr").textContent = atr;
  $("stAce").textContent = notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) / notas.length) + "%" : "—";
  $("stQst").textContent = qst;   // a sequência migrou para o rodapé do plano

  renderPlano();
  renderLista(ts);
}

function sequencia() {
  const dias = new Set(dados.temas.flatMap((t) => t.historico.map((h) => h.d)));
  let n = 0, cursor = hoje();
  if (!dias.has(cursor)) cursor = somaDias(cursor, -1); // o dia ainda não acabou
  while (dias.has(cursor)) { n++; cursor = somaDias(cursor, -1); }
  return n;
}

/* ---------- avisos ----------
   No lugar de alert() e confirm(), que travam a página e não cabem no meio
   de uma sessão de estudo. */
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

  const editProva = e.target.closest("[data-prova-edit]");
  if (editProva) { editarProva(editProva.dataset.provaEdit); return; }

  const delProva = e.target.closest("[data-prova-del]");
  if (delProva) {
    const p = dados.provas.find((x) => x.prova === delProva.dataset.provaDel);
    if (!p) return;
    registrarEvento("prova-", { prova: p.prova });
    if (provaEditando === p.prova) limparFormularioProva();
    renderListaProvas();
    avisar(`“${p.nome}” removida.`, {
      rotulo: "desfazer",
      aoClicar: () => { registrarEvento("prova", p); renderListaProvas(); },
    });
  }
});

/* ---------- diálogo: registrar estudo ---------- */
const dlgReg = $("dlgReg");
const rangeAc = $("regAcertos");

function lerInteiro(id) {
  const v = parseInt($(id).value, 10);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function abrirRegistro(id) {
  const t = dados.temas.find((x) => x.id === id);
  if (!t) return;
  alvoId = id;
  $("regTema").textContent = t.nome;
  $("regArea").textContent = t.area;
  $("regData").value = hoje();
  $("regQuestoes").value = "";
  $("regCertas").value = "";
  $("regMinutos").value = duracaoTipica(t);
  rangeAc.value = desempenho(t) ?? 70;
  atualizaHint();
  dlgReg.showModal();
}

/** Percentual da vez: da contagem quando houver, senão do controle. */
function percentualDoFormulario() {
  const q = lerInteiro("regQuestoes"), c = lerInteiro("regCertas");
  if (q && c !== null) return Math.round((Math.min(c, q) / q) * 100);
  return null;
}

function atualizaHint() {
  const q = lerInteiro("regQuestoes");
  const pct = percentualDoFormulario();

  // O controle de domínio só aparece quando não há contagem de questões.
  $("regSemQuestoes").hidden = !!q;
  $("regPct").textContent = pct === null ? "—" : pct + "%";
  $("regOut").textContent = rangeAc.value + "%";

  const v = pct ?? +rangeAc.value;
  const t = dados.temas.find((x) => x.id === alvoId);
  const etapa = v >= 80 ? Math.min((t?.etapa ?? 0) + 1, INTERVALOS.length - 1) : v >= 60 ? (t?.etapa ?? 0) : 0;
  const data = $("regData").value || hoje();
  const dias = intervaloAjustado(etapa, data, alvo?.data ?? "");
  const quando = fmt(somaDias(data, dias));

  const prazo = `${dias} dia${dias > 1 ? "s" : ""} — ${quando}`;
  $("regHint").textContent =
    v >= 80 ? `Bom domínio, sobe um degrau: próxima revisão em ${prazo}`
    : v >= 60 ? `Parcial, mantém o intervalo: revisão em ${prazo}`
    : `Abaixo de 60% reinicia o ciclo: revisão em ${prazo}`;
}

for (const id of ["regQuestoes", "regCertas", "regData"]) $(id).addEventListener("input", atualizaHint);
rangeAc.addEventListener("input", atualizaHint);

// Remover mora aqui, não numa coluna repetida em cada uma das 97 linhas.
$("regRemover").addEventListener("click", () => {
  const t = dados.temas.find((x) => x.id === alvoId);
  if (!t) return;
  dlgReg.close("cancel");
  registrarEvento("tema-", { tema: t.id });
  avisar(`“${t.nome}” saiu do cronograma.`, {
    rotulo: "desfazer",
    aoClicar: () => registrarEvento("tema+", { tema: t.id, nome: t.nome, area: t.area, pesos: t.pesos }),
  });
});

dlgReg.addEventListener("close", () => {
  if (dlgReg.returnValue !== "ok") return;
  const t = dados.temas.find((x) => x.id === alvoId);
  if (!t) return;

  const q = lerInteiro("regQuestoes");
  const c = lerInteiro("regCertas");
  const minutos = lerInteiro("regMinutos");
  const data = $("regData").value || hoje();

  if (q && c !== null && c > q) {
    avisar("Não dá para acertar mais questões do que você fez.");
    return;
  }

  const registro = { tema: t.id, data };
  if (minutos) registro.minutos = minutos;
  if (q && c !== null) { registro.questoes = q; registro.certas = c; }
  else registro.acertos = +rangeAc.value;

  const ev = registrarEvento("estudo", registro);
  const atualizado = dados.temas.find((x) => x.id === t.id);
  const pct = q && c !== null ? Math.round((c / q) * 100) : +rangeAc.value;

  avisar(`${t.nome}: ${pct}% — volta em ${fmt(atualizado?.proxima)}`, {
    rotulo: "desfazer",
    aoClicar: () => registrarEvento("estudo-", { evento: ev.id }),
  });
});

/* ---------- diálogo: novo tema ---------- */
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
  const peso = +$("nvPeso").value;
  registrarEvento("tema+", { tema: id, nome, area, pesos: { enamed: peso, sesdf: peso } });
});

/* ---------- diálogo: provas ---------- */
const dlgProvas = $("dlgProvas");

function renderListaProvas() {
  const alvoAtual = provaAlvo(dados.provas, hoje());
  const itens = dados.provas.map((p) => {
    const li = document.createElement("li");
    if (p.prova === provaEditando) li.dataset.editando = "1";

    // Botão, não texto: editar precisa ser alcançável por teclado também.
    const qual = document.createElement("button");
    qual.type = "button";               // dentro de um form: não pode submeter
    qual.className = "qual";
    qual.dataset.provaEdit = p.prova;
    qual.textContent = p.nome + (p.prova === alvoAtual?.prova ? " — alvo atual" : "");

    const quando = document.createElement("span");
    quando.className = "quando";
    quando.textContent = p.data ? fmt(p.data) + "/" + p.data.slice(0, 4) : "sem data";

    const bt = document.createElement("button");
    bt.type = "button";                    // dentro de um form: não pode submeter
    bt.className = "del";
    bt.dataset.provaDel = p.prova;
    bt.textContent = "×";
    bt.setAttribute("aria-label", `Remover ${p.nome}`);

    li.append(qual, quando, bt);
    return li;
  });

  if (!itens.length) {
    const li = document.createElement("li");
    li.className = "vazia";
    li.textContent = "Nenhuma prova cadastrada ainda.";
    itens.push(li);
  }
  $("listaProvas").replaceChildren(...itens);
}

/** Deixa o formulário pronto para cadastrar uma prova nova. */
function limparFormularioProva() {
  provaEditando = null;
  $("pvNome").value = "";
  $("pvData").value = "";
  $("pvPerfil").value = PERFIL_PADRAO;
  $("btnSalvarProva").textContent = "salvar prova";
}

/** Carrega uma prova existente no formulário para correção. */
function editarProva(id) {
  const p = dados.provas.find((x) => x.prova === id);
  if (!p) return;
  provaEditando = p.prova;
  $("pvNome").value = p.nome;
  $("pvData").value = p.data;
  $("pvPerfil").value = p.perfil;
  $("btnSalvarProva").textContent = "atualizar prova";
  renderListaProvas();
  $("pvData").focus();
}

$("btnProvas").addEventListener("click", () => {
  limparFormularioProva();
  renderListaProvas();
  dlgProvas.showModal();
});

dlgProvas.addEventListener("close", () => {
  const editava = provaEditando;
  provaEditando = null;
  if (dlgProvas.returnValue !== "ok") return;

  const nome = $("pvNome").value.trim();
  const data = $("pvData").value;
  if (!nome || !data) { avisar("Prova precisa de nome e data."); return; }

  const id = slug(nome).slice(0, 60) || "prova-" + Date.now();
  const perfil = PERFIS.includes($("pvPerfil").value) ? $("pvPerfil").value : PERFIL_PADRAO;
  const anterior = editava ? dados.provas.find((x) => x.prova === editava) : null;

  registrarEvento("prova", { prova: id, nome, data, perfil });

  // O id vem do slug do nome. Renomeando, o id muda — sem apagar o antigo
  // sobraria uma prova órfã com o nome velho concorrendo pela contagem.
  if (editava && editava !== id) registrarEvento("prova-", { prova: editava });

  if (anterior) {
    const mudou = anterior.data !== data ? `${fmt(anterior.data)} → ${fmt(data)}` : fmt(data);
    avisar(`${nome}: ${mudou}`, {
      rotulo: "desfazer",
      aoClicar: () => {
        registrarEvento("prova", anterior);
        if (editava !== id) registrarEvento("prova-", { prova: id });
      },
    });
  } else {
    avisar(`${nome} em ${fmt(data)}.`);
  }
});

/* ---------- diálogo: rotina ---------- */
const dlgRotina = $("dlgRotina");

function camposRotina() {
  return DIAS.map((_, i) => $("rot" + i));
}
function somaRotina() {
  const total = camposRotina().reduce((s, el) => s + (parseInt(el.value, 10) || 0), 0);
  $("rotinaTotal").textContent = `${horas(total)} por semana`;
}

// A grade é montada uma vez; os valores entram na abertura.
$("semana").replaceChildren(...DIAS.map((d, i) => {
  const wrap = document.createElement("div");
  const lb = document.createElement("label");
  lb.htmlFor = "rot" + i;
  lb.textContent = d;
  const inp = document.createElement("input");
  inp.type = "number"; inp.id = "rot" + i;
  inp.min = "0"; inp.max = "960"; inp.step = "15"; inp.inputMode = "numeric";
  inp.addEventListener("input", somaRotina);
  wrap.append(lb, inp);
  return wrap;
}));

$("btnRotina").addEventListener("click", () => {
  camposRotina().forEach((el, i) => { el.value = dados.rotina[i]; });
  somaRotina();
  dlgRotina.showModal();
});

dlgRotina.addEventListener("close", () => {
  if (dlgRotina.returnValue !== "ok") return;
  const minutos = camposRotina().map((el) => {
    const v = parseInt(el.value, 10);
    return Number.isFinite(v) && v > 0 ? Math.min(v, 960) : 0;
  });
  registrarEvento("rotina", { minutos });
  avisar(`Rotina salva: ${horas(minutos.reduce((a, b) => a + b, 0))} por semana.`);
});

/* ---------- filtros ---------- */
document.querySelectorAll("[data-filtro]").forEach((b) => {
  b.addEventListener("click", () => {
    filtro = b.dataset.filtro;
    document.querySelectorAll("[data-filtro]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderLista(dados.temas);
  });
});

/* ---------- backup manual ---------- */
$("btnExp").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ versao: 3, eventos: sync.todos() }, null, 2)], { type: "application/json" });
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
