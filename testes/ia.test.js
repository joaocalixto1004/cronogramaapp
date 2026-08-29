/* O que a ponte para a NVIDIA precisa garantir.
 *
 * Dois riscos moram aqui, e nenhum deles é "a resposta veio boa": a chave
 * vazar para o cliente e o cliente escolher o que gastar. Os testes cobrem
 * as duas coisas, além do caminho de erro — a rede da NVIDIA cai, e quando
 * cai o app não pode receber um 500 sem explicação.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { conversarIA, MODELOS } from "../servidor/ia.js";

const CHAVE = "nvapi-de-teste";
const env = { NVAPI_KEY: CHAVE };
const req = (corpo) =>
  new Request("https://x/api/ia", { method: "POST", body: JSON.stringify(corpo) });
const ola = [{ papel: "user", texto: "oi" }];

// Substitui o fetch global e guarda o que a NVIDIA teria recebido.
function espionar(resposta) {
  const original = globalThis.fetch;
  const visto = {};
  globalThis.fetch = async (url, opcoes) => {
    visto.url = url;
    visto.opcoes = opcoes;
    visto.corpo = JSON.parse(opcoes.body);
    return resposta();
  };
  return { visto, restaurar: () => { globalThis.fetch = original; } };
}

const respostaOk = (texto = "tudo certo") =>
  new Response(JSON.stringify({
    choices: [{ message: { content: texto } }],
    usage: { total_tokens: 42 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

/* ---------- a chave ---------- */

test("a chave vai no header para a NVIDIA e não volta na resposta", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(visto.opcoes.headers.Authorization, "Bearer " + CHAVE);

    const corpo = await r.text();
    assert.equal(corpo.includes(CHAVE), false, "a chave não pode aparecer no que o cliente recebe");
  } finally { restaurar(); }
});

test("sem NVAPI_KEY responde 503, e não tenta chamar a NVIDIA", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    const r = await conversarIA(req({ mensagens: ola }), {});
    assert.equal(r.status, 503);
    assert.match((await r.json()).erro, /NVAPI_KEY/);
    assert.equal(visto.url, undefined, "não deveria gastar crédito sem chave configurada");
  } finally { restaurar(); }
});

test("erro de auth da NVIDIA não repassa o corpo dela", async () => {
  const vazamento = "sem permissão para a chave " + CHAVE;
  const { restaurar } = espionar(() => new Response(vazamento, { status: 401 }));
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 502);
    assert.equal((await r.text()).includes(CHAVE), false);
  } finally { restaurar(); }
});

/* ---------- quem escolhe o modelo ---------- */

test("a tarefa vira modelo pelo mapa do servidor", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    await conversarIA(req({ tarefa: "codigo", mensagens: ola }), env);
    assert.equal(visto.corpo.model, MODELOS.codigo);
  } finally { restaurar(); }
});

test("sem tarefa usa o padrão rápido", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    await conversarIA(req({ mensagens: ola }), env);
    assert.equal(visto.corpo.model, MODELOS.rapido);
  } finally { restaurar(); }
});

test("modelo mandado pelo cliente é ignorado — só a tarefa decide", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    await conversarIA(req({ model: "modelo/caro-demais", mensagens: ola }), env);
    assert.equal(visto.corpo.model, MODELOS.rapido);
    assert.equal(Object.values(MODELOS).includes(visto.corpo.model), true);
  } finally { restaurar(); }
});

test("tarefa fora do mapa é recusada antes de chamar a NVIDIA", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    const r = await conversarIA(req({ tarefa: "caro", mensagens: ola }), env);
    assert.equal(r.status, 422);
    assert.equal(visto.url, undefined);
  } finally { restaurar(); }
});

/* ---------- validação da entrada ---------- */

test("JSON inválido é 400", async () => {
  const r = await conversarIA(
    new Request("https://x/api/ia", { method: "POST", body: "{{" }), env);
  assert.equal(r.status, 400);
});

test("recusa corpo sem mensagens, lista vazia e papel inválido", async () => {
  for (const corpo of [{}, { mensagens: [] }, { mensagens: [{ papel: "system", texto: "x" }] }]) {
    const r = await conversarIA(req(corpo), env);
    assert.equal(r.status, 422, "deveria recusar " + JSON.stringify(corpo));
  }
});

test("recusa mensagem longa demais e conversa longa demais", async () => {
  const longa = await conversarIA(req({ mensagens: [{ papel: "user", texto: "a".repeat(8001) }] }), env);
  assert.equal(longa.status, 422);

  const muitas = Array.from({ length: 5 }, () => ({ papel: "user", texto: "a".repeat(7000) }));
  const total = await conversarIA(req({ mensagens: muitas }), env);
  assert.equal(total.status, 422);
});

test("recusa mais mensagens que o teto", async () => {
  const lista = Array.from({ length: 21 }, () => ({ papel: "user", texto: "oi" }));
  assert.equal((await conversarIA(req({ mensagens: lista }), env)).status, 422);
});

test("campo extra do cliente não chega na NVIDIA", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    await conversarIA(req({ mensagens: [{ papel: "user", texto: "oi", surpresa: "x" }] }), env);
    assert.deepEqual(visto.corpo.messages, [{ role: "user", content: "oi" }]);
  } finally { restaurar(); }
});

test("sistema entra como primeira mensagem", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    await conversarIA(req({ sistema: "seja breve", mensagens: ola }), env);
    assert.deepEqual(visto.corpo.messages[0], { role: "system", content: "seja breve" });
  } finally { restaurar(); }
});

/* ---------- respostas ---------- */

test("resposta boa devolve texto, modelo e tokens", async () => {
  const { restaurar } = espionar(() => respostaOk("resumo do dia"));
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      texto: "resumo do dia", modelo: MODELOS.rapido, tokens: 42,
    });
    assert.equal(r.headers.get("Cache-Control"), "no-store");
  } finally { restaurar(); }
});

test("resposta sem conteúdo vira 502, não um texto vazio para a tela", async () => {
  const { restaurar } = espionar(() =>
    new Response(JSON.stringify({ choices: [] }), { status: 200 }));
  try {
    assert.equal((await conversarIA(req({ mensagens: ola }), env)).status, 502);
  } finally { restaurar(); }
});

test("429 da NVIDIA continua 429 — é o limite de 40 req/min, não um defeito", async () => {
  const { restaurar } = espionar(() => new Response("slow down", { status: 429 }));
  try {
    assert.equal((await conversarIA(req({ mensagens: ola }), env)).status, 429);
  } finally { restaurar(); }
});

test("rede caindo vira 502 com a causa, não uma exceção solta", async () => {
  const { restaurar } = espionar(() => { throw new Error("ECONNRESET"); });
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 502);
    assert.match((await r.json()).erro, /ECONNRESET/);
  } finally { restaurar(); }
});

test("fluxo:true pede stream à NVIDIA e repassa como event-stream", async () => {
  const { visto, restaurar } = espionar(() =>
    new Response("data: {}\n\n", { status: 200 }));
  try {
    const r = await conversarIA(req({ mensagens: ola, fluxo: true }), env);
    assert.equal(visto.corpo.stream, true);
    assert.equal(r.headers.get("Content-Type"), "text/event-stream");
    assert.equal(r.headers.get("Cache-Control"), "no-store");
  } finally { restaurar(); }
});

test("sem fluxo não pede stream", async () => {
  const { visto, restaurar } = espionar(() => respostaOk());
  try {
    await conversarIA(req({ mensagens: ola }), env);
    assert.equal(visto.corpo.stream, false);
  } finally { restaurar(); }
});
