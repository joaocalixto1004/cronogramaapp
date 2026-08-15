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
  derivar, eventosDoFormatoAntigo,
} from "./logica.js";

const CHAVE_ANTIGA = "ritmo.v1";
const MARCA_MIGRACAO = "ritmo.migrado.v2";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

function renderFila(ts) {
  const hj = hoje();
  const feitosHoje = ts.filter((t) => ultimo(t) && ultimo(t).d === hj).length;
  const pend = ts.filter((t) => !(ultimo(t) && ultimo(t).d === hj))
                 .sort((a, b) => prioridade(b) - prioridade(a))
                 .slice(0, 5);
  $("tituloFila").textContent = feitosHoje
    ? `Mais ${pend.length ? "temas" : "nada"} para hoje — ${feitosHoje} já registrado${feitosHoje > 1 ? "s" : ""}`
    : "O que estudar agora";
  $("fila").innerHTML = pend.map((t) => {
    const a = atraso(t);
    const tag = a === null ? '<span class="tag novo">novo</span>'
      : a > 0 ? `<span class="tag atr">${a}d atrás</span>`
      : a === 0 ? '<span class="tag hoje">hoje</span>'
      : '<span class="tag novo">antecipar</span>';
    return `<li>${tag}<span class="nome">${esc(t.nome)}</span>
      <span class="area">${esc(t.area.split(" ")[0])}</span>
      <button data-reg="${esc(t.id)}">registrar</button></li>`;
  }).join("") || '<li class="vazio">Tudo em dia. Um descanso também consolida memória.</li>';
}

function renderLista(ts) {
  let visiveis = ts;
  if (filtro === "pendentes") visiveis = ts.filter((t) => { const a = atraso(t); return a === null || a >= 0; });
  if (filtro === "fracos") visiveis = ts.filter((t) => { const d = desempenho(t); return d !== null && d < 70; });

  const ordem = AREAS.concat([...new Set(ts.map((t) => t.area))].filter((a) => !AREAS.includes(a)));
  $("lista").innerHTML = ordem.map((area) => {
    const doGrupo = visiveis.filter((t) => t.area === area).sort((a, b) => prioridade(b) - prioridade(a));
    if (!doGrupo.length) return "";
    const todos = ts.filter((t) => t.area === area);
    const pct = todos.length ? Math.round((todos.filter((t) => t.historico.length).length / todos.length) * 100) : 0;
    return `<section class="areablock">
      <div class="areahead">
        <h3>${esc(area)}</h3>
        <div class="bar-prog"><i data-pct="${pct}"></i></div>
        <span class="eyebrow">${pct}%</span>
      </div>
      ${doGrupo.map(linha).join("")}
    </section>`;
  }).join("") || '<p class="semfiltro">Nenhum tema neste filtro.</p>';

  // A largura vai pelo CSSOM, não por style="": a CSP estrita bloqueia
  // atributos de estilo no markup, mas não a manipulação via script.
  for (const i of $("lista").querySelectorAll(".bar-prog i")) i.style.width = i.dataset.pct + "%";
}

function linha(t) {
  const d = desempenho(t), a = atraso(t), u = ultimo(t);
  const partes = [];
  if (u) partes.push(`<span>último ${fmt(u.d)}</span>`);
  if (d !== null) partes.push(`<span class="${d >= 70 ? "ok" : "due"}">${d}% acertos</span>`);
  if (a !== null) partes.push(a > 0 ? `<span class="due">revisar — ${a}d atrás</span>` : `<span>revisar ${fmt(t.proxima)}</span>`);
  if (!partes.length) partes.push("<span>ainda não estudado</span>");
  return `<div class="row">
    <div class="main">
      <div class="tema"><i class="peso p${t.peso}" title="incidência ${t.peso}/3"></i>${esc(t.nome)}</div>
      <div class="meta">${partes.join("")}</div>
    </div>
    <div class="right">${tracado(t)}
      <button class="reg" data-reg="${esc(t.id)}">registrar</button>
      <button class="del" data-del="${esc(t.id)}" title="remover tema" aria-label="Remover ${esc(t.nome)}">×</button>
    </div>
  </div>`;
}

/* ---------- ponte com o log ---------- */
function recalcular() {
  dados = derivar(sync.todos());
  render();
}
function registrarEvento(tipo, dadosEv) {
  sync.adicionar(tipo, dadosEv);
  recalcular();
}

/* ---------- interações ---------- */
document.addEventListener("click", (e) => {
  const reg = e.target.closest("[data-reg]");
  if (reg) { abrirRegistro(reg.dataset.reg); return; }
  const del = e.target.closest("[data-del]");
  if (del) {
    const t = dados.temas.find((x) => x.id === del.dataset.del);
    if (t && confirm(`Remover “${t.nome}” do cronograma?`)) registrarEvento("tema-", { tema: t.id });
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
  registrarEvento("estudo", { tema: t.id, data: $("regData").value || hoje(), acertos: +rangeAc.value });
});

const dlgNovo = $("dlgNovo");
$("btnNovo").addEventListener("click", () => {
  const areas = [...new Set(AREAS.concat(dados.temas.map((t) => t.area)))];
  $("nvArea").innerHTML = areas.map((a) => `<option>${esc(a)}</option>`).join("");
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
    alert("Use ao menos uma letra ou número no nome do tema.");
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
    alert(n ? `${n} evento${n > 1 ? "s" : ""} importado${n > 1 ? "s" : ""}.` : "Nada novo: o arquivo já estava todo aqui.");
  } catch {
    alert("Este arquivo não é um backup do Ritmo. Selecione um .json exportado pelo próprio app.");
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
  const aviso = $("aviso");
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const novo = reg.installing;
      novo?.addEventListener("statechange", () => {
        // controller existente = já havia uma versão rodando, logo é atualização.
        if (novo.state === "installed" && navigator.serviceWorker.controller) {
          aviso.dataset.visivel = "1";
          $("btnAtualizar").onclick = () => {
            novo.postMessage({ tipo: "assumir" });
            aviso.dataset.visivel = "0";
          };
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
