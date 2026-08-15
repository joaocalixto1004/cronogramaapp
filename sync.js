/* Fila offline e sincronização com /api/eventos.
 *
 * O log local é a cópia de trabalho e nunca espera a rede: registrar um estudo
 * grava em localStorage e devolve o controle na hora. Um evento sem `seq` é
 * um evento que o servidor ainda não confirmou — é essa a fila de pendentes,
 * então ela sobrevive a fechar o app, ficar sem sinal ou trocar de aba.
 */

const CHAVE = "ritmo.log.v2";
const API = "api/eventos";

let eventos = [];       // [{id, tipo, ts, dados, seq?}]
let cursor = 0;         // maior seq já recebido do servidor
let ouvintes = [];
let estadoAtual = "ok";
let sincronizando = false;
let agendado = null;

/* ---------- persistência local ---------- */

function ler() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return;
    const g = JSON.parse(bruto);
    if (Array.isArray(g?.eventos)) eventos = g.eventos;
    if (Number.isInteger(g?.cursor)) cursor = g.cursor;
  } catch (e) {
    console.warn("log local ilegível, começando vazio:", e);
  }
}

function gravar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ eventos, cursor }));
  } catch (e) {
    console.warn("não foi possível gravar o log local:", e);
    definirEstado("erro", "sem espaço para salvar neste navegador");
  }
}

/* ---------- estado exposto ---------- */

function definirEstado(novo, detalhe = "") {
  estadoAtual = novo;
  ouvintes.forEach((fn) => fn({ estado: novo, detalhe, pendentes: pendentes().length }));
}

const pendentes = () => eventos.filter((e) => e.seq == null);

export const todos = () => eventos;
export const estado = () => estadoAtual;
export function aoMudar(fn) {
  ouvintes.push(fn);
}

/* ---------- escrita ---------- */

/** Registra um fato novo: aplica local, agenda envio. Nunca falha por rede. */
export function adicionar(tipo, dados) {
  const ev = { id: crypto.randomUUID(), tipo, ts: new Date().toISOString(), dados };
  eventos.push(ev);
  gravar();
  definirEstado(navigator.onLine ? "pendente" : "offline");
  agendar(400);
  return ev;
}

/** Funde eventos vindos de fora (servidor ou arquivo importado). */
function fundir(novos) {
  const porId = new Map(eventos.map((e) => [e.id, e]));
  let mudou = false;
  for (const n of novos) {
    const atual = porId.get(n.id);
    // Uma cópia confirmada pelo servidor substitui a local ainda sem seq.
    if (!atual || (atual.seq == null && n.seq != null)) {
      porId.set(n.id, n);
      mudou = true;
    }
  }
  if (mudou) eventos = [...porId.values()];
  return mudou;
}

/* ---------- rede ---------- */

async function enviarPendentes() {
  const fila = pendentes();
  if (!fila.length) return;

  // Em lotes, porque o servidor recusa envios grandes demais.
  for (let i = 0; i < fila.length; i += 400) {
    const lote = fila.slice(i, i + 400).map(({ id, tipo, ts, dados }) => ({ id, tipo, ts, dados }));
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventos: lote }),
    });
    if (!r.ok) throw Object.assign(new Error(`POST ${r.status}`), { status: r.status });
  }
}

async function baixarNovos() {
  // Pagina até o servidor dizer que acabou.
  for (let volta = 0; volta < 50; volta++) {
    const r = await fetch(`${API}?desde=${cursor}`);
    if (!r.ok) throw Object.assign(new Error(`GET ${r.status}`), { status: r.status });
    const g = await r.json();
    if (Array.isArray(g.eventos) && g.eventos.length) fundir(g.eventos);
    if (Number.isInteger(g.seq)) cursor = g.seq;
    if (g.fim !== false) break;
  }
}

export async function sincronizar() {
  if (sincronizando) return;
  if (!navigator.onLine) {
    definirEstado("offline");
    return;
  }
  sincronizando = true;
  try {
    await enviarPendentes();
    await baixarNovos();
    gravar();
    definirEstado(pendentes().length ? "pendente" : "ok");
    ouvintes.forEach((fn) => fn({ estado: estadoAtual, recarregar: true, pendentes: pendentes().length }));
  } catch (e) {
    // 401 = sessão do Access expirou. Os pendentes continuam salvos, então
    // recarregar (e passar pelo login) não perde nada.
    if (e.status === 401) definirEstado("erro", "sessão expirada — recarregue a página");
    else if (e.status >= 400 && e.status < 500) definirEstado("erro", `recusado pelo servidor (${e.status})`);
    else definirEstado(navigator.onLine ? "pendente" : "offline");
    console.warn("sync:", e);
  } finally {
    sincronizando = false;
  }
}

function agendar(ms) {
  clearTimeout(agendado);
  agendado = setTimeout(sincronizar, ms);
}

/* ---------- importação de arquivo ---------- */

/** Une o conteúdo de um backup ao log. Nunca substitui: com log de eventos,
 *  importar é aditivo por construção. Devolve quantos eventos entraram. */
export function importar(lista) {
  if (!Array.isArray(lista)) throw new Error("formato");
  const validos = lista.filter(
    (e) =>
      e && typeof e === "object" &&
      typeof e.id === "string" && e.id &&
      typeof e.tipo === "string" &&
      typeof e.ts === "string" &&
      e.dados && typeof e.dados === "object",
  );
  if (!validos.length) throw new Error("formato");

  const antes = eventos.length;
  // Entram como pendentes (sem seq) para serem reenviados ao servidor.
  fundir(validos.map(({ id, tipo, ts, dados }) => ({ id, tipo, ts, dados })));
  gravar();
  agendar(200);
  return eventos.length - antes;
}

/* ---------- ciclo de vida ---------- */

export function iniciar() {
  ler();
  definirEstado(navigator.onLine ? "ok" : "offline");

  addEventListener("online", () => agendar(0));
  addEventListener("offline", () => definirEstado("offline"));
  // Voltar para a aba é o momento mais provável de haver novidade de outro aparelho.
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") agendar(0);
  });

  agendar(0);
}

/** Usado pela migração do formato antigo: injeta eventos já como pendentes. */
export function semear(lista) {
  const mudou = fundir(lista);
  if (mudou) gravar();
  return mudou;
}
