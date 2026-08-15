/* Testes da fila offline.
 *
 * O ponto sensível é a fusão: um evento existe em duas cópias enquanto o
 * servidor não confirma (a local, sem seq, e a que volta no GET, com seq).
 * Se a fusão errar, o registro aparece duplicado ou some da fila.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ---------- ambiente de navegador, mínimo ---------- */
const guardado = new Map();
globalThis.localStorage = {
  getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
  setItem: (k, v) => guardado.set(k, String(v)),
  removeItem: (k) => guardado.delete(k),
  clear: () => guardado.clear(),
};
// O Node 24 já define `navigator`, e só com getter — daí o defineProperty.
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true }, writable: true, configurable: true,
});
globalThis.document = { visibilityState: "visible" };
globalThis.addEventListener = () => {};

let chamadas = [];
let servidor = [];   // eventos já gravados, com seq
globalThis.fetch = async (url, opcoes) => {
  chamadas.push({ url, opcoes });
  const resposta = (corpo) => ({ ok: true, status: 200, json: async () => corpo });

  if (opcoes?.method === "POST") {
    const { eventos } = JSON.parse(opcoes.body);
    for (const e of eventos) {
      if (servidor.some((s) => s.id === e.id)) continue;   // INSERT OR IGNORE
      servidor.push({ ...e, seq: servidor.length + 1 });
    }
    return resposta({ ok: true, seq: servidor.length });
  }
  const desde = Number(new URL(url, "https://x/").searchParams.get("desde"));
  const lote = servidor.filter((e) => e.seq > desde);
  return resposta({ eventos: lote, seq: lote.length ? lote.at(-1).seq : desde, fim: true });
};

/* O sync guarda o log em memória no escopo do módulo. Reimportar com uma
   query diferente força uma instância limpa por teste, em vez de expor um
   reiniciar() que só existiria para os testes. */
let sync;
let contador = 0;
beforeEach(async () => {
  guardado.clear();
  chamadas = [];
  servidor = [];
  navigator.onLine = true;
  sync = await import(`../sync.js?t=${++contador}`);
});

const dadosEstudo = (tema) => ({ tema, data: "2026-01-01", acertos: 80 });

/* ---------- fila ---------- */

test("adicionar grava local na hora, sem esperar a rede", () => {
  const ev = sync.adicionar("estudo", dadosEstudo("a/b"));
  assert.equal(sync.todos().length, 1);
  assert.equal(sync.todos()[0].id, ev.id);
  assert.equal(sync.todos()[0].seq, undefined, "ainda não confirmado pelo servidor");
  assert.ok(guardado.has("ritmo.log.v2"), "precisa sobreviver a fechar o app");
});

test("sincronizar envia o pendente e o traz de volta confirmado, sem duplicar", async () => {
  const ev = sync.adicionar("estudo", dadosEstudo("a/b"));
  await sync.sincronizar();

  const log = sync.todos();
  assert.equal(log.length, 1, "não pode existir uma cópia local e outra do servidor");
  assert.equal(log[0].id, ev.id);
  assert.equal(log[0].seq, 1, "passou a ser um evento confirmado");
  assert.equal(sync.estado(), "ok");
});

test("reenviar o mesmo evento não duplica no servidor", async () => {
  sync.adicionar("estudo", dadosEstudo("a/b"));
  await sync.sincronizar();
  await sync.sincronizar();
  assert.equal(servidor.length, 1);
  assert.equal(sync.todos().length, 1);
});

test("eventos de outro aparelho entram na fusão", async () => {
  servidor.push({ id: "doCelular", tipo: "estudo", ts: "2026-01-02T00:00:00.000Z", dados: dadosEstudo("c/d"), seq: 1 });
  sync.adicionar("estudo", dadosEstudo("a/b"));
  await sync.sincronizar();

  const ids = sync.todos().map((e) => e.id);
  assert.ok(ids.includes("doCelular"), "o registro do outro aparelho precisa aparecer");
  assert.equal(sync.todos().length, 2);
  assert.equal(sync.estado(), "ok");
});

/* ---------- offline ---------- */

test("offline acumula na fila e não perde nada ao voltar", async () => {
  navigator.onLine = false;
  sync.adicionar("estudo", dadosEstudo("a/b"));
  sync.adicionar("estudo", dadosEstudo("c/d"));
  await sync.sincronizar();

  assert.equal(chamadas.length, 0, "não deve tentar rede estando offline");
  assert.equal(sync.estado(), "offline");
  assert.equal(sync.todos().length, 2);

  navigator.onLine = true;
  await sync.sincronizar();

  assert.equal(servidor.length, 2);
  assert.equal(sync.todos().length, 2);
  assert.equal(sync.estado(), "ok");
});

test("falha de rede mantém os pendentes para a próxima tentativa", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("sem rota"); };

  sync.adicionar("estudo", dadosEstudo("a/b"));
  await sync.sincronizar();
  assert.equal(sync.todos().length, 1, "o registro não pode sumir");
  assert.equal(sync.estado(), "pendente");

  globalThis.fetch = real;
  await sync.sincronizar();
  assert.equal(servidor.length, 1);
  assert.equal(sync.estado(), "ok");
});

test("401 do Access vira aviso de sessão, sem descartar a fila", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

  sync.adicionar("estudo", dadosEstudo("a/b"));
  await sync.sincronizar();

  assert.equal(sync.estado(), "erro");
  assert.equal(sync.todos().length, 1, "recarregar para relogar não pode perder o registro");
  globalThis.fetch = real;
});

/* ---------- importação ---------- */

test("importar é aditivo e ignora o que já existe", () => {
  const ev = sync.adicionar("estudo", dadosEstudo("a/b"));
  const entraram = sync.importar([
    { id: ev.id, tipo: "estudo", ts: ev.ts, dados: ev.dados },       // repetido
    { id: "novo", tipo: "estudo", ts: "2026-02-02T00:00:00.000Z", dados: dadosEstudo("e/f") },
  ]);

  assert.equal(entraram, 1);
  assert.equal(sync.todos().length, 2);
});

test("importar rejeita arquivo sem eventos válidos", () => {
  assert.throws(() => sync.importar("não é lista"));
  assert.throws(() => sync.importar([{ semCampos: true }]));
});
