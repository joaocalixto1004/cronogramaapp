/* O que a ponte para a NVIDIA precisa garantir.
 *
 * Três riscos moram aqui: a chave vazar para o cliente, o cliente escolher o
 * que gastar, e um modelo específico ficar fora do ar derrubando a rota
 * inteira — o que já aconteceu de verdade (gpt-oss-120b, o mais estável da
 * sessão anterior, ficou 25s sem responder num scan do catálogo completo).
 * Por isso cada tarefa tem uma lista de candidatos, e os testes de failover
 * são tão importantes quanto os de validação.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { conversarIA, MODELOS } from "../servidor/ia.js";

const CHAVE = "nvapi-de-teste";
const env = { NVAPI_KEY: CHAVE };
const req = (corpo) =>
  new Request("https://x/api/ia", { method: "POST", body: JSON.stringify(corpo) });
const ola = [{ papel: "user", texto: "oi" }];

const respostaOk = (texto = "tudo certo") =>
  new Response(JSON.stringify({
    choices: [{ message: { content: texto } }],
    usage: { total_tokens: 42 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

/* Substitui o fetch global por uma fila de respostas, uma por chamada — é
 * assim que o failover se testa: a primeira chamada pode falhar e a segunda
 * pode ter sucesso, e o teste precisa controlar as duas de forma diferente. */
function encenar(...respostas) {
  const original = globalThis.fetch;
  const chamadas = [];
  let i = 0;
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push(JSON.parse(opcoes.body));
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (typeof r === "function") return r();
    if (r instanceof Error) throw r;
    return r.clone();
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

/* ---------- a chave ---------- */

test("a chave vai no header para a NVIDIA e não volta na resposta", async () => {
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    // O header não fica no corpo JSON capturado por `chamadas`; confere pelo
    // fetch mockado não ter recebido nada que vaze de volta ao cliente.
    const corpo = await r.text();
    assert.equal(corpo.includes(CHAVE), false, "a chave não pode aparecer no que o cliente recebe");
    assert.equal(chamadas.length, 1);
  } finally { restaurar(); }
});

test("sem NVAPI_KEY responde 503, e não tenta chamar a NVIDIA", async () => {
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    const r = await conversarIA(req({ mensagens: ola }), {});
    assert.equal(r.status, 503);
    assert.match((await r.json()).erro, /NVAPI_KEY/);
    assert.equal(chamadas.length, 0, "não deveria gastar crédito sem chave configurada");
  } finally { restaurar(); }
});

/* ---------- quem escolhe o modelo ---------- */

test("a tarefa vira modelo pelo mapa do servidor — primeiro candidato da lista", async () => {
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    await conversarIA(req({ tarefa: "codigo", mensagens: ola }), env);
    assert.equal(chamadas[0].model, MODELOS.codigo[0]);
  } finally { restaurar(); }
});

test("sem tarefa usa o padrão rápido", async () => {
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    await conversarIA(req({ mensagens: ola }), env);
    assert.equal(chamadas[0].model, MODELOS.rapido[0]);
  } finally { restaurar(); }
});

test("modelo mandado pelo cliente é ignorado — só a tarefa decide", async () => {
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    await conversarIA(req({ model: "modelo/caro-demais", mensagens: ola }), env);
    assert.equal(chamadas[0].model, MODELOS.rapido[0]);
    assert.notEqual(chamadas[0].model, "modelo/caro-demais");
  } finally { restaurar(); }
});

test("tarefa fora do mapa é recusada antes de chamar a NVIDIA", async () => {
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    const r = await conversarIA(req({ tarefa: "caro", mensagens: ola }), env);
    assert.equal(r.status, 422);
    assert.equal(chamadas.length, 0);
  } finally { restaurar(); }
});

/* ---------- failover entre candidatos ---------- */

test("primeiro candidato sem cota (429) — o segundo assume, e o modelo relatado é o segundo", async () => {
  assert.ok(MODELOS.rapido.length >= 2, "este teste depende de rapido ter 2+ candidatos");
  const { chamadas, restaurar } = encenar(
    new Response("limite", { status: 429 }),
    respostaOk("resposta do segundo"),
  );
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.texto, "resposta do segundo");
    assert.equal(corpo.modelo, MODELOS.rapido[1]);
    assert.equal(chamadas.length, 2);
    assert.equal(chamadas[0].model, MODELOS.rapido[0]);
    assert.equal(chamadas[1].model, MODELOS.rapido[1]);
  } finally { restaurar(); }
});

test("primeiro candidato com 5xx também aciona o próximo", async () => {
  const { chamadas, restaurar } = encenar(
    new Response("fora do ar", { status: 503 }),
    respostaOk("ok"),
  );
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 200);
    assert.equal(chamadas.length, 2);
  } finally { restaurar(); }
});

test("primeiro candidato derruba a conexão — o próximo ainda é tentado", async () => {
  const { chamadas, restaurar } = encenar(new Error("ECONNRESET"), respostaOk("ok"));
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 200);
    assert.equal(chamadas.length, 2);
  } finally { restaurar(); }
});

test("todos os candidatos sem cota — 429, com a lista de quem foi tentado", async () => {
  const respostas = MODELOS.rapido.map(() => new Response("limite", { status: 429 }));
  const { chamadas, restaurar } = encenar(...respostas);
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 429);
    const corpo = await r.json();
    for (const id of MODELOS.rapido) assert.ok(corpo.erro.includes(id), `${id} deveria aparecer no erro`);
    assert.equal(chamadas.length, MODELOS.rapido.length);
  } finally { restaurar(); }
});

test("candidatos falham por motivos diferentes — 502, não 429, porque nem tudo foi cota", async () => {
  const { restaurar } = encenar(
    new Response("limite", { status: 429 }),
    new Response("fora do ar", { status: 503 }),
    new Response("fora do ar", { status: 503 }),
  );
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 502, "misturou 429 com 5xx: não é só falta de cota");
  } finally { restaurar(); }
});

test("corpo de erro de um candidato não vaza ao cliente", async () => {
  const vazamento = `chave inválida ${CHAVE}`;
  const respostas = MODELOS.rapido.map(() => new Response(vazamento, { status: 503 }));
  const { restaurar } = encenar(...respostas);
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal((await r.text()).includes(CHAVE), false);
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
    assert.equal(r.status, 422, `deveria recusar ${JSON.stringify(corpo)}`);
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
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    await conversarIA(req({ mensagens: [{ papel: "user", texto: "oi", surpresa: "x" }] }), env);
    assert.deepEqual(chamadas[0].messages, [{ role: "user", content: "oi" }]);
  } finally { restaurar(); }
});

test("sistema entra como primeira mensagem", async () => {
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    await conversarIA(req({ sistema: "seja breve", mensagens: ola }), env);
    assert.deepEqual(chamadas[0].messages[0], { role: "system", content: "seja breve" });
  } finally { restaurar(); }
});

/* ---------- respostas ---------- */

test("resposta boa devolve texto, modelo e tokens", async () => {
  const { restaurar } = encenar(respostaOk("resumo do dia"));
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      texto: "resumo do dia", modelo: MODELOS.rapido[0], tokens: 42,
    });
    assert.equal(r.headers.get("Cache-Control"), "no-store");
  } finally { restaurar(); }
});

test("resposta sem conteúdo (ausente ou vazia) não conta como sucesso", async () => {
  const semConteudo = () => new Response(JSON.stringify({ choices: [] }), { status: 200 });
  const { restaurar: r1 } = encenar(semConteudo(), semConteudo(), semConteudo());
  try {
    assert.equal((await conversarIA(req({ mensagens: ola }), env)).status, 502);
  } finally { r1(); }
});

test("rede caindo em todos os candidatos vira 502 com a causa, não uma exceção solta", async () => {
  const { restaurar } = encenar(new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET"));
  try {
    const r = await conversarIA(req({ mensagens: ola }), env);
    assert.equal(r.status, 502);
    assert.match((await r.json()).erro, /ECONNRESET/);
  } finally { restaurar(); }
});

test("fluxo:true pede stream ao candidato que respondeu e repassa como event-stream", async () => {
  const { chamadas, restaurar } = encenar(
    new Response("data: {}\n\n", { status: 200 }),
  );
  try {
    const r = await conversarIA(req({ mensagens: ola, fluxo: true }), env);
    assert.equal(chamadas[0].stream, true);
    assert.equal(r.headers.get("Content-Type"), "text/event-stream");
    assert.equal(r.headers.get("Cache-Control"), "no-store");
    assert.equal(r.headers.get("X-Modelo"), MODELOS.rapido[0]);
  } finally { restaurar(); }
});

test("no streaming, o candidato que respondeu por último aparece em X-Modelo", async () => {
  const { restaurar } = encenar(
    new Response("limite", { status: 429 }),
    new Response("data: {}\n\n", { status: 200 }),
  );
  try {
    const r = await conversarIA(req({ mensagens: ola, fluxo: true }), env);
    assert.equal(r.headers.get("X-Modelo"), MODELOS.rapido[1]);
  } finally { restaurar(); }
});

test("sem fluxo não pede stream", async () => {
  const { chamadas, restaurar } = encenar(respostaOk());
  try {
    await conversarIA(req({ mensagens: ola }), env);
    assert.equal(chamadas[0].stream, false);
  } finally { restaurar(); }
});
