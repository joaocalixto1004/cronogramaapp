/* Cliente do assistente — fala só com /api/ia, nunca com a NVIDIA direto.
 *
 * A CSP do site (`connect-src 'self'`, ver _headers) já impediria uma
 * chamada direta à NVIDIA mesmo que este arquivo tentasse; a chave nunca
 * chega ao navegador de propósito (ver servidor/ia.js).
 *
 * O cliente escolhe a *tarefa* (rapido, codigo, agente, geral) — quem decide
 * o modelo, por padrão, é o servidor, com failover entre candidatos. O app
 * fica atrás do Access, então dá pra abrir mão desse padrão e pedir um
 * modelo exato pelo diálogo "modelo"; nesse caso não há substituto — se o
 * escolhido estiver fora do ar, a mensagem falha em vez de outro assumir
 * escondido. A escolha é global (vale pra qualquer tarefa), guardada em
 * `ia.modeloForcado`; "" significa automático. Cada tarefa continua com seu
 * próprio histórico, em `ia.historico.<tarefa>`.
 */

const CHAVE = (tarefa) => `ia.historico.${tarefa}`;
const CHAVE_ULTIMA_TAREFA = "ia.ultimaTarefa";
const CHAVE_MODELO_FORCADO = "ia.modeloForcado";
const $ = (sel) => document.querySelector(sel);

const elTarefa = $("#iaTarefa");
const elLimpar = $("#iaLimpar");
const elAviso = $("#iaAviso");
const elConversa = $("#iaConversa");
const elForma = $("#iaForma");
const elEntrada = $("#iaEntrada");
const elEnviar = $("#iaEnviar");
const elAbrirModelo = $("#iaAbrirModelo");
const elModeloAtual = $("#iaModeloAtual");
const dlgModelo = $("#dlgModelo");

let enviando = false;

function avisar(texto) {
  elAviso.textContent = texto ?? "";
  elAviso.hidden = !texto;
}

/* ---------- histórico ---------- */

function ler(tarefa) {
  try { return JSON.parse(localStorage.getItem(CHAVE(tarefa)) ?? "[]"); }
  catch { return []; }
}
function gravar(tarefa, historico) {
  try { localStorage.setItem(CHAVE(tarefa), JSON.stringify(historico)); }
  catch (e) { avisar("não foi possível salvar o histórico neste navegador: " + e.message); }
}

function bolha({ papel, texto, modelo }) {
  const linha = document.createElement("div");
  linha.className = "ia-msg ia-msg-" + (papel === "user" ? "eu" : papel === "erro" ? "erro" : "ia");
  const balao = document.createElement("div");
  balao.className = "ia-balao";
  balao.textContent = texto;
  linha.appendChild(balao);
  if (modelo) {
    const legenda = document.createElement("div");
    legenda.className = "ia-legenda";
    legenda.textContent = modelo;
    linha.appendChild(legenda);
  }
  return linha;
}

function renderizar(historico) {
  elConversa.innerHTML = "";
  if (!historico.length) {
    elConversa.innerHTML = '<p class="ia-vazio">Sem conversa ainda nesta tarefa.</p>';
    return;
  }
  for (const m of historico) elConversa.appendChild(bolha(m));
  elConversa.scrollTop = elConversa.scrollHeight;
}

/* ---------- troca de tarefa ---------- */

function tarefaAtual() { return elTarefa.value; }

function trocarTarefa() {
  try { localStorage.setItem(CHAVE_ULTIMA_TAREFA, elTarefa.value); } catch { /* sem espaço; segue sem lembrar */ }
  renderizar(ler(tarefaAtual()));
  avisar("");
}

elTarefa.addEventListener("change", trocarTarefa);

elLimpar.addEventListener("click", () => {
  const tarefa = tarefaAtual();
  if (!confirm(`Apagar o histórico de "${elTarefa.selectedOptions[0].text}"?`)) return;
  localStorage.removeItem(CHAVE(tarefa));
  renderizar([]);
});

/* ---------- modelo escolhido ---------- */

function modeloForcado() {
  try { return localStorage.getItem(CHAVE_MODELO_FORCADO) || ""; }
  catch { return ""; }
}

// Compara valores em JS, não em seletor CSS — os ids têm "/", e escapar isso
// num atributo dinâmico é mais risco do que precisa.
function radioDoModelo(id) {
  return [...dlgModelo.querySelectorAll('input[name="modeloEscolha"]')].find((r) => r.value === id);
}

function atualizarRotuloModelo() {
  const escolhido = modeloForcado();
  const radio = escolhido && radioDoModelo(escolhido);
  // Nome curto pro botão: o primeiro nó de texto do rótulo, antes do <small>.
  elModeloAtual.textContent = radio
    ? radio.closest(".modelo-opcao").querySelector(".modelo-nome").firstChild.textContent.trim()
    : "automático";
}

elAbrirModelo.addEventListener("click", () => {
  const escolhido = modeloForcado();
  const radio = (escolhido && radioDoModelo(escolhido)) || radioDoModelo("");
  radio.checked = true;
  dlgModelo.showModal();
});

dlgModelo.addEventListener("close", () => {
  if (dlgModelo.returnValue !== "ok") return;
  const marcado = dlgModelo.querySelector('input[name="modeloEscolha"]:checked');
  try { localStorage.setItem(CHAVE_MODELO_FORCADO, marcado?.value ?? ""); } catch { /* sem espaço; segue sem lembrar */ }
  atualizarRotuloModelo();
});

/* ---------- textarea ---------- */

elEntrada.addEventListener("input", () => {
  elEntrada.style.height = "auto";
  elEntrada.style.height = Math.min(elEntrada.scrollHeight, 160) + "px";
});
elEntrada.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); elForma.requestSubmit(); }
});

/* ---------- envio ---------- */

elForma.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (enviando) return;
  const texto = elEntrada.value.trim();
  if (!texto) return;

  const tarefa = tarefaAtual();
  const modelo = modeloForcado();
  enviando = true;
  elEnviar.disabled = true;
  elEntrada.value = "";
  elEntrada.style.height = "auto";
  avisar("");

  const historico = ler(tarefa);
  historico.push({ papel: "user", texto });
  renderizar(historico);
  gravar(tarefa, historico);

  const linhaIA = bolha({ papel: "assistant", texto: "" });
  const balaoIA = linhaIA.querySelector(".ia-balao");
  elConversa.appendChild(linhaIA);
  elConversa.scrollTop = elConversa.scrollHeight;

  try {
    const r = await fetch("api/ia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tarefa,
        modelo: modelo || undefined,
        fluxo: true,
        // O servidor só aceita user/assistant; entradas locais de erro
        // (papel "erro") existem só para exibição e nunca são reenviadas.
        mensagens: historico
          .filter((m) => m.papel === "user" || m.papel === "assistant")
          .map(({ papel, texto }) => ({ papel, texto })),
      }),
    });

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}));
      throw new Error(corpo.erro || `HTTP ${r.status}`);
    }

    const modeloUsado = r.headers.get("X-Modelo");
    let acumulado = "";
    const leitor = r.body.getReader();
    const decodificador = new TextDecoder();
    let sobra = "";

    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      sobra += decodificador.decode(value, { stream: true });
      const linhas = sobra.split("\n");
      sobra = linhas.pop();
      for (const linha of linhas) {
        const dados = linha.replace(/^data:\s*/, "").trim();
        if (!dados || dados === "[DONE]") continue;
        try {
          const delta = JSON.parse(dados)?.choices?.[0]?.delta?.content;
          if (delta) { acumulado += delta; balaoIA.textContent = acumulado; elConversa.scrollTop = elConversa.scrollHeight; }
        } catch { /* fragmento incompleto entre dois pedaços de rede; ignora */ }
      }
    }

    if (!acumulado.trim()) throw new Error("resposta vazia");
    historico.push({ papel: "assistant", texto: acumulado, modelo: modeloUsado || undefined });
    gravar(tarefa, historico);
    if (modeloUsado) {
      const legenda = document.createElement("div");
      legenda.className = "ia-legenda";
      legenda.textContent = modeloUsado;
      linhaIA.appendChild(legenda);
    }
  } catch (err) {
    linhaIA.remove();
    historico.push({ papel: "erro", texto: "Falhou: " + err.message });
    renderizar(historico);
    gravar(tarefa, historico);
    avisar(err.message);
  } finally {
    enviando = false;
    elEnviar.disabled = false;
    elEntrada.focus();
  }
});

/* ---------- início ---------- */

try {
  const salva = localStorage.getItem(CHAVE_ULTIMA_TAREFA);
  if (salva && [...elTarefa.options].some((o) => o.value === salva)) elTarefa.value = salva;
} catch { /* sem localStorage; segue com o padrão do <select> */ }

renderizar(ler(tarefaAtual()));
atualizarRotuloModelo();
