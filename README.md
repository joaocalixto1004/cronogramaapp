# Ritmo — cronograma de residência médica

Site estático de página única para organizar o estudo para a residência: revisão espaçada,
priorização automática por desempenho e incidência, e contagem regressiva até a prova.

Os dados sincronizam sozinhos entre o celular e o notebook, ficam atrás de login, e o app
continua funcionando offline. Tudo dentro do plano gratuito da Cloudflare.

---

## Como os dados são guardados

O app grava um **log de eventos**, não um estado. Registrar um estudo acrescenta um fato
(`{tema, data, acertos}`); a tela é sempre recalculada a partir do log inteiro.

Isso resolve o problema de usar dois aparelhos: como só existem inserções, nunca
sobrescritas, o celular offline e o notebook geram eventos diferentes e **os dois entram**.
Não há conflito a resolver nem versão que ganha.

```
navegador                          borda Cloudflare          dados
─────────                          ────────────────          ─────
localStorage (log de eventos)  ←→  Worker /api/eventos   ←→  D1 (tabela eventos)
   ↓ derivar()
estado renderizado                 protegido por Access
```

Registrar um estudo grava local e devolve o controle na hora — a tela nunca espera a rede.
O que ainda não subiu fica marcado como pendente e sobrevive a fechar o app; o envio
acontece sozinho quando há sinal. O rodapé mostra o estado.

**Provas e rotina** também são eventos: cadastrar uma prova, removê-la ou mudar a
rotina da semana entram no log como qualquer outra coisa, e por isso chegam sozinhos
nos outros aparelhos.

**Desfazer.** Registrar no tema errado e remover um tema acontecem na hora, sem caixa de
confirmação, e ficam desfazíveis por alguns segundos no aviso que aparece no rodapé.
Como o log não admite apagar, desfazer acrescenta um evento que anula o anterior — o que
também significa que a correção se propaga para os outros aparelhos como qualquer
outra coisa.

---

## Subir no ar

Só é preciso fazer isto uma vez.

### 1. Repositório

Pode ser privado — o Cloudflare publica igual.

```bash
git init
git add .
git commit -m "Ritmo"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/cronograma-residencia.git
git push -u origin main
```

### 2. Banco D1

Já está criado e o `database_id` já está no `wrangler.toml`. O que segue é só para
recriar do zero, num outro lugar ou noutra conta.

Pelo painel, sem terminal — **Storage & Databases** → **D1 SQL Database** →
**Create Database**, com o nome `ritmo`. Abra o banco, vá em **Console**, cole o conteúdo
de [`schema.sql`](schema.sql) e execute. O **Database ID** aparece na página do banco:
copie para o `wrangler.toml`.

Pelo terminal, se preferir (exige um login próprio da Cloudflare, que costuma não
funcionar dentro de um Codespace):

```bash
npx wrangler@4 d1 create ritmo   # devolve o database_id
npm run db:producao              # cria a tabela
```

O `database_id` é um identificador, não um segredo — por isso vive em arquivo
versionado. Quem protege o banco é o token da conta, que não entra no repositório.

### 3. Worker

Em **Workers & Pages** → **Create** → **Workers** → **Connect to Git**, escolha o
repositório e configure:

| Campo | Valor |
|---|---|
| Build command | `sh build.sh` |
| Deploy command | `npx wrangler deploy` |

O build command não é opcional. É ele que monta `publico/` — sem isso não existe
diretório de assets para publicar — e que carimba a versão do commit no `sw.js`. Sem o
carimbo, o service worker mantém o mesmo nome de cache para sempre e o app instalado
**nunca recebe atualização**.

A binding do D1 já está no `wrangler.toml` e vale em produção: não precisa repetir
no painel.

### 4. Login (Cloudflare Access)

Grátis até 50 usuários. **No Worker**, não no Zero Trust: abra o Worker → aba
**Access** → **Protect this Worker behind Access** → **All traffic** → defina a política
(Allow → Emails → o seu e-mail) → **Apply Access**.

O caminho pelo Zero Trust (*Add an application → Self-hosted*) **não funciona em
`workers.dev`**: aplicação self-hosted exige que o hostname pertença a uma zona ativa da
sua conta, e `workers.dev` é domínio compartilhado da Cloudflare. A política é criada,
mas nunca casa, e nenhuma tela de login aparece. Esse caminho só passa a valer se você
apontar um domínio próprio para o Worker.

Ligado assim, a plataforma autentica antes de o código rodar e entrega a identidade
pronta em `ctx.access` — não há nada a configurar no repositório.

**Se um dia usar domínio próprio**, aí sim vale a aplicação self-hosted, e o Worker passa
a verificar o token por conta própria. Nesse caso, anote o **Application Audience (AUD)
tag** e o nome do time (`SEU-TIME` em `https://SEU-TIME.cloudflareaccess.com`) e
adicione em **Settings → Variables and Secrets**:

| Variável | Valor |
|---|---|
| `ACCESS_TEAM` | `SEU-TIME` |
| `ACCESS_AUD` | a tag AUD da aplicação |

E aí lembre de apagar o `*` do campo de subdomínio ao criar a aplicação: a política
padrão cobre os subdomínios mas deixa o apex de fora.

Sem nenhum dos dois caminhos, a API **recusa tudo** — falha fechada, de propósito.

### 5. Instalar no celular

Abra o endereço no Chrome ou Safari → menu → **Adicionar à tela de início**.

---

## Como o cronograma funciona

O app é montado para duas provas com calendários diferentes: **ENAMED**, meados de
setembro, e **SES-DF**, dezembro/janeiro. Tudo — contagem, ritmo das revisões e peso dos
temas — segue sempre a **prova mais próxima que ainda não passou**. Quando o ENAMED
passa, o alvo vira a SES-DF sozinho, sem você mexer em nada.

### Rotina

Você declara quantos minutos tem em cada dia da semana. É daqui que sai o tamanho do
plano diário — e só daqui. Um dia com zero minutos é dia de descanso, não dívida.

### Ciclo, não calendário

O plano do dia não é uma grade com horário marcado. É um ciclo: os blocos saem da
prioridade do momento, com **rodízio de área** — não repete área enquanto houver outra
elegível. Duas consequências:

- **Interleaving de graça.** Alternar assuntos é uma das poucas técnicas com evidência
  boa em educação médica, e aqui ela é o padrão em vez de disciplina sua.
- **Semana ruim não quebra nada.** Como o ciclo não guarda posição, um dia perdido não
  desalinha o resto — no dia seguinte o atraso simplesmente entra na conta da prioridade.

A duração de cada bloco é a **mediana do que você já gastou naquele tema**. Os 45 minutos
iniciais são só um chute até haver histórico.

### Fases

A fase é derivada da distância até a prova, não configurada — o que muda o certo a fazer
é o tempo restante, não a sua vontade:

| Fase | Quando | O que muda |
|---|---|---|
| Cobertura | mais de 365 dias | tema nunca visto sobe na fila; prioridade é fechar a primeira passada |
| Consolidação | 180 a 365 dias | equilíbrio entre revisão vencida e tema novo |
| Aprofundamento | 60 a 180 dias | desempenho fraco e alta incidência dominam |
| Reta final | menos de 60 dias | **tema nunca visto sai do plano** — abrir assunto novo na véspera custa mais do que rende |

### Revisão espaçada

Ao registrar, você informa quantas questões fez e quantas acertou; o percentual sai da
contagem. Sem questões, dá para estimar o domínio no controle deslizante.

| Acertos | O que acontece | Próxima revisão |
|---|---|---|
| ≥ 80% | avança um degrau | 1 → 7 → 30 → 90 dias |
| 60–79% | mantém o degrau | repete o intervalo atual |
| < 60% | **cai um degrau** | volta ao intervalo anterior |

A queda é de um degrau, não até o chão: um dia ruim não deve jogar à estaca zero um tema
já consolidado. É o mesmo motivo que levou o Anki a abandonar o SM-2, onde a punição
quase não se recuperava. Errar de novo continua descendo, então insistir no erro chega ao
degrau mais baixo do mesmo jeito.

**A prova aperta o ritmo.** O intervalo nunca passa da metade do tempo que falta: a 40
dias da prova, o degrau de 90 marcaria a revisão para depois dela — ou seja, nunca.

Os estudos são reaplicados em ordem de **data de estudo**, não de registro. Registrar hoje
um estudo de anteontem o coloca na posição cronológica certa.

### Caderno de erros

Ao registrar, se houve questão errada o app pergunta **onde** o erro foi: falta de
conhecimento, interpretação ou desatenção. A categoria vale mais que a contagem — erro por
desatenção não se conserta estudando o tema de novo, e sem separar os dois você trata os
dois igual. O painel mostra qual categoria mais te custa.

### Nota projetada e simulados

A projeção pondera o seu acerto em cada área pela fatia que ela ocupa na prova. Tema ainda
não estudado entra valendo **25%**, o acerto ao acaso numa prova de quatro alternativas —
é o que torna o número honesto em vez de otimista, e o que faz a cobertura aparecer nele.

Simulado cronometrado entra por **simulado** e é comparado com a projeção. Quando os dois
divergem, o simulado é o dado mais confiável.

### A carga cabe no tempo?

O painel compara as horas que a sua rotina oferece até a prova com as horas estimadas para
cobrir o edital e sustentar as revisões. Quando não cabe, ele diz de quanto seria a semana
necessária. Serve para descobrir em janeiro que o plano é impossível, e não em junho.

### Pontos de currículo (SES-DF)

A nota final da SES-DF não é só a prova: é a objetiva **mais até 10 pontos de currículo**
(edital, itens 12.1 e 14.2). Como cada questão vale 1,25, esses 10 pontos equivalem a
**8 questões** — e não dependem de acertar nada no dia.

O botão **currículo** traz o quadro de atribuição do edital, com as 13 alíneas, o valor
unitário e o teto de cada uma. G e H dividem o mesmo teto; B e D não têm teto próprio.

O que o app faz além de somar: **monitoria, extensão, iniciação científica e experiência
no SUS só contam por semestre completo**. Conforme a prova se aproxima, o teto realmente
alcançável cai — e o painel mostra esse número, não só o total atual. É a diferença entre
descobrir a janela com quatro semestres pela frente ou seis meses antes, quando já não dá
para recuperar.

### Temas e pesos

São 97 temas nas **sete áreas da Matriz de Referência do ENAMED** (Portaria INEP
478/2025): as cinco grandes áreas clássicas mais **Medicina de Família e Comunidade** e
**Saúde Mental**, que uma prova de acesso direto tradicional quase não cobra e o ENAMED
cobra bastante.

Cada tema tem **dois pesos**, um por perfil de prova, porque as duas não cobram a mesma
coisa. A bolinha antes do nome mostra o peso do perfil da prova alvo — ela muda quando o
alvo muda. Os pesos iniciais são editoriais: ajuste conforme for resolvendo questões e
descobrindo o perfil de cada banca.

---

## Modelos de IA (NVIDIA)

`POST /api/ia` fala com o catálogo gratuito da NVIDIA, que serve uma API
compatível com a da OpenAI. A rota fica atrás do Access, como todo o `/api/*`.
A página **`/ia`** (link "assistente" no cabeçalho do cronograma) é o cliente
dela: um chat simples, com histórico separado por tarefa em `localStorage`.

**Por que passa pelo Worker.** A chave não pode ir para o navegador. O site é
estático e público: o que estiver em `app.js` está visível a quem abrir o
DevTools, e uma `NVAPI_KEY` exposta é conta de outra pessoa gastando os
créditos. O cliente fala com `/api/ia` e só o Worker conhece a chave — a CSP
do site (`connect-src 'self'`) reforça isso: uma chamada direta à NVIDIA
nem seria permitida pelo navegador.

**O cliente escolhe a tarefa, não o modelo.** Se o id viesse do navegador,
qualquer um poderia apontar para o mais caro do catálogo. O mapa
`tarefa → lista de modelos` vive em `servidor/ia.js`.

**Por que lista, e não um modelo fixo.** Escaneamos os 83 modelos que
`/v1/models` lista para esta chave, um por um, chamando `/chat/completions`
de verdade — não por nome. Resultado: só 15 a 17 respondiam naquele momento;
o resto ou não tinha inferência hospedada (404) ou estava sem cota. E
`openai/gpt-oss-120b`, o mais rápido e estável de toda uma sessão anterior
(409 ms, 3/3 sem falha), apareceu **fora do ar** nesse scan — confirmado com
`curl` direto, sem nenhum código nosso no meio. Um modelo fixo por tarefa
não sobrevive a isso. Testando de verdade contra a NVIDIA (não só com mock),
a tarefa `codigo` — que tinha só 2 candidatos — ficou sem nenhum responder ao
mesmo tempo (`minimax-m3` sem cota, `kimi-k3` sem resposta em 20 s); por isso
toda tarefa tem hoje 3 candidatos, tentados em ordem:

| tarefa   | candidatos, em ordem                                                          |
|----------|--------------------------------------------------------------------------------|
| `rapido` | `gpt-oss-120b` → `gpt-oss-20b` → `nemotron-3-super-120b-a12b`                  |
| `geral`  | `nemotron-3-super-120b-a12b` → `gpt-oss-20b` → `kimi-k3`                       |
| `codigo` | `minimax-m3` → `kimi-k3` → `gpt-oss-20b`                                       |
| `agente` | `kimi-k3` → `minimax-m3` → `gpt-oss-20b`                                       |

A troca acontece em 429 (sem cota), 5xx, timeout de 20 s ou resposta sem
conteúdo — no máximo 3 tentativas por pedido. `deepseek-v4-flash-0731` e
`deepseek-v4-pro-0813` ficam de fora de propósito: o primeiro foi o mais
lento medido apesar do nome (14,5 s, com 504 e depois 529 num scan
seguinte); o segundo tem ~180 s de cold start, tempo demais para qualquer
candidato de failover.

Uso:

```js
const r = await fetch("api/ia", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tarefa: "rapido",
    sistema: "Responda em português, direto ao ponto.",
    mensagens: [{ papel: "user", texto: "resuma meu desempenho em cardiologia" }],
  }),
});
const { texto, modelo, tokens } = await r.json();
```

Com `fluxo: true` a resposta vem como `text/event-stream`, repassada sem
bufferizar assim que o primeiro candidato responde 200 — não há mais troca de
modelo depois que o streaming começa, porque parte do corpo já pode ter ido
ao cliente. O header `X-Modelo` diz qual candidato de fato respondeu (útil
quando o primeiro da lista está fora do ar e o segundo assumiu).

O que a rota recusa antes de gastar crédito: tarefa fora do mapa, papel que
não seja `user`/`assistant`, mensagem acima de 8 000 caracteres, conversa
acima de 24 000, mais de 20 mensagens. Campo extra enviado pelo cliente é
descartado na reserialização, como em `eventos.js`.

Erros: **503** sem chave no ambiente, **429** só quando *todos* os candidatos
da tarefa estavam sem cota, **502** quando a lista se esgotou por qualquer
outro motivo (a mensagem lista quem foi tentado e por quê, sem repassar o
corpo de erro de cada um — pode conter detalhe de auth).

**A chave.** Local, em `.dev.vars` (já no `.gitignore`) — copie de
`.dev.vars.exemplo`. Em produção:

```
npx wrangler@4 secret put NVAPI_KEY
```

Gerada em <https://build.nvidia.com>. O plano gratuito dá ~1 000 créditos de
inferência no cadastro (até 5 000 sob pedido); não é ilimitado.

---

## Backup

Não é mais tarefa sua: o histórico fica no D1 e chega sozinho em qualquer aparelho onde
você entrar. O **exportar .json** continua ali como saída de emergência, para levar os
dados para fora.

**Importar nunca substitui** — os eventos do arquivo são unidos aos que já existem, e os
repetidos são ignorados pelo id. Não há como um arquivo errado apagar seu histórico.

Quem já usava a versão anterior não precisa fazer nada: na primeira abertura o histórico
guardado em `localStorage` é convertido para eventos e enviado. A chave antiga
(`ritmo.v1`) é preservada como rede de segurança.

---

## Desenvolvimento

```bash
npm test                 # 99 testes de lógica e autenticação, sem dependências
npm run db:local         # cria a tabela no D1 local
npm run dev              # monta publico/ e sobe em http://localhost:8788
                         # (o app é servido de publico/: rode build.sh depois de editar)
```

Para rodar local é preciso um arquivo `.dev.vars` (já no `.gitignore`) com:

```
MODO_DEV=1
```

`MODO_DEV` desliga a verificação do Access — por isso ele mora só no `.dev.vars` e nunca
vai para a Cloudflare.

Os testes de navegador (fluxo completo, CSP, offline, migração) precisam do servidor no ar
e do Playwright instalado sob demanda:

```bash
npx playwright@latest install --with-deps chromium
npm i --no-save playwright
node testes/navegador/fluxo.mjs
node testes/navegador/migracao.mjs
node testes/navegador/assistente.mjs   # chama a NVIDIA de verdade — precisa de NVAPI_KEY
```

---

## Arquivos

```
index.html               markup do cronograma
ia.html                  markup do assistente (página própria, fora da SPA)
estilo.css               estilos e fontes locais, das duas páginas
logica.js                catálogo, provas, fases, ciclo e derivação  (puro, testável)
sync.js                  fila offline e conversa com a API
app.js                   render incremental e interações do cronograma
ia-chat.js               cliente do assistente: streaming, histórico por tarefa
sw.js                    cache offline, versão carimbada no build
_headers                 CSP e política de cache
worker.js                entrada: roteia /api/* e delega o resto aos assets
servidor/acesso.js       verifica o JWT do Cloudflare Access
servidor/eventos.js      GET (por cursor) e POST (idempotente)
servidor/ia.js           ponte para os modelos da NVIDIA (a chave nunca sai daqui)
build.sh                 monta publico/ e carimba o commit no sw.js
wrangler.toml            entrada, assets e binding do D1
schema.sql               tabela de eventos
fontes/                  IBM Plex, subset latino
testes/                  node --test  +  roteiros de navegador
manifest.webmanifest     instalação como aplicativo
icone.svg                ícone
publico/                 saída do build (não versionada)
```
