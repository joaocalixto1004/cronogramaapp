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
 * Cada tarefa tem uma LISTA de candidatos, tentados em ordem, porque um único
 * modelo fixo não sobrevive à realidade do catálogo gratuito: escaneamos os
 * 83 modelos que /v1/models lista (agent/scan-catalogo.mjs), e só 15 a 17
 * respondiam naquele momento — o resto ou não tinha inferência hospedada
 * (404) ou estava sem cota. O mesmo scan pegou openai/gpt-oss-120b, que tinha
 * sido o mais rápido e estável da sessão anterior (409 ms, 3/3), fora do ar
 * por instabilidade transitória do lado da NVIDIA. Lista fixa teria
 * derrubado a rota; lista com substituto não.
 *
 * Relatório completo em agent/catalogo-nvidia.md.
 *
 * Toda tarefa tem pelo menos 3 candidatos — 2 não bastou. Testando de
 * verdade contra a NVIDIA (não só com mock) na tarefa "codigo", que tinha só
 * 2, os dois estavam fora ao mesmo tempo (minimax-m3 sem cota, kimi-k3 sem
 * resposta em 20s) e a rota devolveu 502 de verdade. gpt-oss-20b entra como
 * rede de segurança em toda tarefa: não é especialista em nenhuma, mas
 * respondeu em todos os testes desta sessão.
 */
const MODELOS = {
  rapido: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "nvidia/nemotron-3-super-120b-a12b"],
  codigo: ["minimaxai/minimax-m3", "moonshotai/kimi-k3", "openai/gpt-oss-20b"],
  agente: ["moonshotai/kimi-k3", "minimaxai/minimax-m3", "openai/gpt-oss-20b"],
  geral:  ["nvidia/nemotron-3-super-120b-a12b", "openai/gpt-oss-20b", "moonshotai/kimi-k3"],
};
const TAREFA_PADRAO = "rapido";

// deepseek-v4-flash-0731 e deepseek-v4-pro-0813 ficam de fora de propósito:
// o primeiro é o mais lento medido apesar do nome (14,5 s, com um 504 e
// depois um 529 no scan); o segundo tem ~180 s de cold start, tempo demais
// para qualquer candidato de failover num Worker.

const TENTATIVAS_MAX = 3;       // não tenta mais candidatos que isso por pedido
const TIMEOUT_TENTATIVA_MS = 20000;

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

/* ---------- chamada com failover ---------- */

/* Tenta os candidatos da tarefa em ordem. Troca de candidato em 429 (sem
 * cota), 5xx, timeout ou resposta sem conteúdo — tudo o que um modelo
 * específico pode fazer sem que o pedido em si esteja errado. Não troca em
 * erro que seria o mesmo em qualquer modelo (ex: JSON do pedido inválido —
 * mas esse já foi barrado em limpar(), antes de chegar aqui).
 *
 * Só tenta os primeiros TENTATIVAS_MAX candidatos: uma tarefa com muitos
 * substitutos não pode virar uma cascata de timeouts de 20 s cada.
 */
async function tentarCandidatos(candidatos, corpoBase, chave, aviso) {
  const tentados = [];
  for (const id of candidatos.slice(0, TENTATIVAS_MAX)) {
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), TIMEOUT_TENTATIVA_MS);
    try {
      const resposta = await fetch(ORIGEM, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chave}`,
          "Content-Type": "application/json",
          Accept: corpoBase.stream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify({ ...corpoBase, model: id }),
        signal: controlador.signal,
      });
      clearTimeout(corte);

      if (resposta.status === 429) { tentados.push(`${id}: sem cota`); continue; }
      if (resposta.status >= 500) { tentados.push(`${id}: HTTP ${resposta.status}`); continue; }
      if (!resposta.ok) {
        // 4xx que não é 429 tende a ser específico do modelo (ex: não aceita
        // algum parâmetro) — vale tentar o próximo, não é erro do pedido.
        tentados.push(`${id}: HTTP ${resposta.status}`);
        continue;
      }
      return { resposta, id };
    } catch (e) {
      clearTimeout(corte);
      const motivo = e.name === "AbortError" ? `sem resposta em ${TIMEOUT_TENTATIVA_MS / 1000}s` : e.message;
      tentados.push(`${id}: ${motivo}`);
    }
  }
  return { falhou: tentados };
}

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

  const corpoBase = {
    messages: limpo.mensagens,
    temperature: 0.2,
    max_tokens: SAIDA_MAX,
    stream: limpo.fluxo,
  };

  const resultado = await tentarCandidatos(MODELOS[limpo.tarefa], corpoBase, env.NVAPI_KEY, null);
  if (resultado.falhou) {
    // O corpo de erro de cada tentativa não é repassado ao cliente — pode
    // conter detalhe de auth — mas a lista de quem foi tentado ajuda a
    // diagnosticar sem expor nada sensível.
    const semCota = resultado.falhou.every((t) => t.includes("sem cota"));
    return erro(semCota ? 429 : 502, `nenhum modelo disponível para "${limpo.tarefa}": ${resultado.falhou.join("; ")}`);
  }

  const { resposta, id } = resultado;

  // Streaming: repassa o corpo sem bufferizar, para o texto aparecer na tela
  // conforme chega em vez de tudo de uma vez no fim. Só chega aqui depois de
  // um candidato já ter respondido 200 — não há mais troca de modelo a
  // partir daqui, porque parte do corpo já poderia ter ido ao cliente.
  if (limpo.fluxo) {
    return new Response(resposta.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream", "Cache-Control": "no-store",
        "X-Modelo": id,
      },
    });
  }

  const dados = await resposta.json();
  const conteudo = dados?.choices?.[0]?.message?.content;
  if (typeof conteudo !== "string" || !conteudo) return erro(502, "resposta do modelo sem conteúdo");

  return json({
    texto: conteudo,
    modelo: id,
    tokens: dados?.usage?.total_tokens ?? null,
  });
}

export { MODELOS };
