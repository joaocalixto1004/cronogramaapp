/* Ponte para os modelos da NVIDIA (endpoint compatível com OpenAI).
 *
 * Existe por um motivo só: a chave não pode ir para o navegador. O site é
 * estático e público — o que está em app.js está visível a quem abrir o
 * DevTools, e uma NVAPI_KEY exposta é conta de outra pessoa gastando os
 * créditos. Então o navegador fala com /api/ia, e só o Worker conhece a chave.
 *
 * A guarda do Access já correu no worker.js antes de chegar aqui: /api/* é
 * fechado por definição, e esta rota não abre exceção.
 */

const ORIGEM = "https://integrate.api.nvidia.com/v1/chat/completions";

/* O cliente escolhe a *tarefa*, nunca o modelo.
 *
 * Se o id viesse do navegador, qualquer um poderia apontar para o modelo mais
 * caro do catálogo e torrar os créditos — e trocar de modelo viraria um deploy
 * do front. Aqui é uma linha neste arquivo.
 *
 * Medianas de 3 chamadas reais, medidas — não tiradas do nome do modelo:
 *
 *   gpt-oss-120b        409 ms   3/3 sem falha
 *   nemotron-3-super    605 ms   3/3 sem falha
 *   minimax-m3         1213 ms
 *   kimi-k3            2129 ms
 *   deepseek-v4-flash 14543 ms   e um 504 no meio
 *
 * Dois ficaram de fora por medição, não por opinião. deepseek-v4-flash tem
 * "flash" no nome e foi o mais lento de todos, com timeout intermitente;
 * deepseek-v4-pro responde, mas com ~180 s de cold start — tempo demais para
 * o Worker segurar uma resposta.
 */
const MODELOS = {
  rapido: "openai/gpt-oss-120b",
  codigo: "minimaxai/minimax-m3",
  agente: "moonshotai/kimi-k3",
  geral:  "nvidia/nemotron-3-super-120b-a12b",
};
const TAREFA_PADRAO = "rapido";

const MENSAGENS_MAX = 20;
const TEXTO_MAX = 8000;     // por mensagem
const TOTAL_MAX = 24000;    // soma da conversa
const SISTEMA_MAX = 2000;
const SAIDA_MAX = 2048;     // teto de tokens de resposta

const json = (corpo, status = 200) =>
  Response.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
const erro = (status, msg) => json({ erro: msg }, status);

/* ---------- validação ---------- */
// Mesmo critério de servidor/eventos.js: o que não bate com o formato é
// rejeitado, não consertado. A diferença é que aqui o destino não é o banco,
// é uma chamada que consome crédito — motivo a mais para não adivinhar.

const texto = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const PAPEIS = ["user", "assistant"];

function limpar(corpo) {
  if (!corpo || typeof corpo !== "object") return { erro: "esperado um objeto" };

  const tarefa = corpo.tarefa ?? TAREFA_PADRAO;
  if (!Object.hasOwn(MODELOS, tarefa)) {
    return { erro: `tarefa desconhecida: use ${Object.keys(MODELOS).join(", ")}` };
  }

  const lista = corpo.mensagens;
  if (!Array.isArray(lista) || lista.length === 0) return { erro: "esperado {mensagens:[...]}" };
  if (lista.length > MENSAGENS_MAX) return { erro: `no máximo ${MENSAGENS_MAX} mensagens` };

  let total = 0;
  const mensagens = [];
  for (const m of lista) {
    if (!m || typeof m !== "object") return { erro: "mensagem não é um objeto" };
    if (!PAPEIS.includes(m.papel)) return { erro: `papel inválido: use ${PAPEIS.join(" ou ")}` };
    if (!texto(m.texto, TEXTO_MAX)) return { erro: `texto vazio ou acima de ${TEXTO_MAX} caracteres` };
    total += m.texto.length;
    if (total > TOTAL_MAX) return { erro: `conversa acima de ${TOTAL_MAX} caracteres` };
    // Reserializa: campo extra que o cliente mandar não chega na NVIDIA.
    mensagens.push({ role: m.papel, content: m.texto });
  }

  if (corpo.sistema !== undefined && !texto(corpo.sistema, SISTEMA_MAX)) {
    return { erro: `sistema vazio ou acima de ${SISTEMA_MAX} caracteres` };
  }
  if (corpo.sistema) mensagens.unshift({ role: "system", content: corpo.sistema });

  return { tarefa, mensagens, fluxo: corpo.fluxo === true };
}

/* ---------- chamada ---------- */
export async function conversarIA(request, env) {
  // Sem chave a rota não existe na prática. 503 e não 500: é configuração
  // faltando no ambiente, não defeito do código.
  if (!env.NVAPI_KEY) return erro(503, "NVAPI_KEY não configurada neste ambiente");

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erro(400, "JSON inválido");
  }

  const limpo = limpar(corpo);
  if (limpo.erro) return erro(422, limpo.erro);

  let resposta;
  try {
    resposta = await fetch(ORIGEM, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NVAPI_KEY}`,
        "Content-Type": "application/json",
        Accept: limpo.fluxo ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify({
        model: MODELOS[limpo.tarefa],
        messages: limpo.mensagens,
        temperature: 0.2,
        max_tokens: SAIDA_MAX,
        stream: limpo.fluxo,
      }),
    });
  } catch (e) {
    // Rede caiu no meio. 502 deixa claro que o problema é do outro lado.
    return erro(502, `modelo inacessível: ${e.message}`);
  }

  if (!resposta.ok) {
    // O corpo da NVIDIA pode trazer a chave em mensagens de erro de auth, e
    // ele não é repassado por isso. O status basta para o cliente decidir.
    //
    // 429 passa como 429 de propósito: o limite gratuito é de ~40 req/min e
    // chega fácil em rajada (apareceu no banco de medições acima). Quem chama
    // precisa distinguir "espere e tente de novo" de "quebrou".
    return erro(resposta.status === 429 ? 429 : 502, `modelo respondeu ${resposta.status}`);
  }

  // Streaming: repassa o corpo sem bufferizar, para o texto aparecer na tela
  // conforme chega em vez de tudo de uma vez no fim.
  if (limpo.fluxo) {
    return new Response(resposta.body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  }

  const dados = await resposta.json();
  const conteudo = dados?.choices?.[0]?.message?.content;
  if (typeof conteudo !== "string") return erro(502, "resposta do modelo sem conteúdo");

  return json({
    texto: conteudo,
    modelo: MODELOS[limpo.tarefa],
    tokens: dados?.usage?.total_tokens ?? null,
  });
}

export { MODELOS };
