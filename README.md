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
localStorage (log de eventos)  ←→  Pages Functions       ←→  D1 (tabela eventos)
   ↓ derivar()                     /api/eventos
estado renderizado                 protegido por Access
```

Registrar um estudo grava local e devolve o controle na hora — a tela nunca espera a rede.
O que ainda não subiu fica marcado como pendente e sobrevive a fechar o app; o envio
acontece sozinho quando há sinal. O rodapé mostra o estado.

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

```bash
npx wrangler@4 d1 create ritmo
```

Copie o `database_id` devolvido para o `wrangler.toml` (substitui `PREENCHER-COM-O-ID-DO-D1`)
e crie a tabela:

```bash
npm run db:producao
```

### 3. Cloudflare Pages

**Workers & Pages** → **Create** → aba **Pages** → **Connect to Git** → escolha o repositório.

| Campo | Valor |
|---|---|
| Framework preset | `None` |
| Build command | `sh build.sh` |
| Build output directory | `/` |

O build command não é opcional: é ele que carimba a versão do commit no `sw.js`. Sem isso
o service worker mantém o mesmo nome de cache para sempre e o app instalado **nunca
recebe atualização**.

Depois do primeiro deploy, em **Settings → Functions → D1 database bindings**, ligue a
variável `DB` ao banco `ritmo`.

### 4. Login (Cloudflare Access)

Grátis até 50 usuários. Em **Zero Trust → Access → Applications → Add an application →
Self-hosted**:

- **Public hostname**: o domínio do projeto. **Apague o `*` do campo de subdomínio** —
  a política padrão cobre `*.projeto.pages.dev` mas deixa o apex `projeto.pages.dev`
  aberto, e é fácil não perceber.
- **Session duration**: 1 mês, senão o PWA pede login toda hora.
- **Policy**: Allow → Emails → o seu e-mail.

Anote o **Application Audience (AUD) tag** e o nome do seu time (`SEU-TIME` em
`https://SEU-TIME.cloudflareaccess.com`). Em **Settings → Environment variables** do
projeto Pages, adicione:

| Variável | Valor |
|---|---|
| `ACCESS_TEAM` | `SEU-TIME` |
| `ACCESS_AUD` | a tag AUD da aplicação |

A API confere o token por conta própria, além da checagem que o Access já faz na borda.
Sem essas duas variáveis ela **recusa tudo** — falha fechada, de propósito.

### 5. Instalar no celular

Abra o endereço no Chrome ou Safari → menu → **Adicionar à tela de início**.

---

## Como o cronograma funciona

**Fila de hoje** — os cinco temas com maior prioridade agora:

```
prioridade = incidência na prova  ×10
           + lacuna de desempenho (quanto pior o último acerto, mais sobe)
           + urgência da revisão   (dias de atraso desde a data prevista)
```

**Revisão espaçada** — ao registrar um estudo você informa o % de acertos, e o intervalo
até a próxima revisão se ajusta:

| Acertos | O que acontece | Próxima revisão |
|---|---|---|
| ≥ 80% | avança um degrau | 1 → 7 → 30 → 90 dias |
| 60–79% | mantém o degrau | repete o intervalo atual |
| < 60% | reinicia o ciclo | no dia seguinte |

Os estudos são reaplicados em ordem de **data de estudo**, não de registro — se você
registrar hoje um estudo de anteontem, ele entra na posição cronológica certa.

**Traçado de retenção** — a curvinha à direita de cada tema mostra o histórico: cada estudo
levanta a linha, e ela decai até a próxima revisão. Verde acima de 80%, âmbar entre 60 e 80,
vermelho abaixo.

**Peso dos temas** — a bolinha antes do nome indica incidência: vermelha = alta, âmbar =
média, cinza = baixa. Os 75 temas iniciais cobrem as cinco grandes áreas do acesso direto.
Ajuste os pesos conforme o perfil da sua banca — quem faz ENARE e quem faz USP não tem a
mesma distribuição.

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
npm test                 # 25 testes da lógica, sem dependências
npm run db:local         # cria a tabela no D1 local
npm run dev              # http://localhost:8788
```

Para rodar local é preciso um arquivo `.dev.vars` (já no `.gitignore`) com:

```
MODO_DEV=1
```

`MODO_DEV` desliga a verificação do Access — por isso ele mora só no `.dev.vars` e nunca
vai para o Pages.

Os testes de navegador (fluxo completo, CSP, offline, migração) precisam do servidor no ar
e do Playwright instalado sob demanda:

```bash
npx playwright@latest install --with-deps chromium
npm i --no-save playwright
node testes/navegador/fluxo.mjs
node testes/navegador/migracao.mjs
```

---

## Arquivos

```
index.html               markup
estilo.css               estilos e fontes locais
logica.js                catálogo, revisão espaçada, derivação  (puro, testável)
sync.js                  fila offline e conversa com a API
app.js                   render e interações
sw.js                    cache offline, versão carimbada no build
_headers                 CSP e política de cache
build.sh                 carimba o commit no sw.js
wrangler.toml            binding do D1
schema.sql               tabela de eventos
functions/api/eventos.js       GET (por cursor) e POST (idempotente)
functions/api/_middleware.js   verifica o JWT do Cloudflare Access
fontes/                  IBM Plex, subset latino
testes/                  node --test
manifest.webmanifest     instalação como aplicativo
icone.svg                ícone
```
