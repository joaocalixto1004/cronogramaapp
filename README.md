# Ritmo — cronograma de residência médica

Site estático de página única para organizar o estudo para a residência: revisão espaçada,
priorização automática por desempenho e incidência, e contagem regressiva até a prova.

Sem servidor, sem banco de dados, sem custo. Os dados ficam no `localStorage` do navegador.

---

## Subir no ar (GitHub + Cloudflare Pages)

### 1. Criar o repositório

No GitHub, crie um repositório novo — pode ser **privado**, o Cloudflare publica igual.
Sugestão de nome: `cronograma-residencia`.

Pelo terminal, dentro da pasta com estes arquivos:

```bash
git init
git add .
git commit -m "Cronograma de residência"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/cronograma-residencia.git
git push -u origin main
```

Se preferir sem terminal: no repositório vazio, use **Add file → Upload files**, arraste os
quatro arquivos (`index.html`, `manifest.webmanifest`, `sw.js`, `icone.svg`) e confirme o commit.

### 2. Conectar ao Cloudflare Pages

1. Entre em <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → aba **Pages**
2. **Connect to Git** → autorize o GitHub → escolha o repositório
3. Nas configurações de build, deixe assim:

   | Campo | Valor |
   |---|---|
   | Framework preset | `None` |
   | Build command | *(vazio)* |
   | Build output directory | `/` |

4. **Save and Deploy**

Em cerca de 30 segundos o site está em `https://cronograma-residencia.pages.dev`.
Cada `git push` na branch `main` republica sozinho.

### 3. Instalar no celular

Abra o endereço no Chrome ou Safari → menu → **Adicionar à tela de início**.
Vira ícone próprio e abre offline.

---

## Como o cronograma funciona

**Fila de hoje** — os cinco temas com maior prioridade agora. A pontuação combina três coisas:

```
prioridade = incidência na prova  ×10
           + lacuna de desempenho (quanto pior o último acerto, mais sobe)
           + urgência da revisão   (dias de atraso desde a data prevista)
```

**Revisão espaçada** — ao registrar um estudo você informa o % de acertos nas questões,
e o intervalo até a próxima revisão se ajusta:

| Acertos | O que acontece | Próxima revisão |
|---|---|---|
| ≥ 80% | avança um degrau | 1 → 7 → 30 → 90 dias |
| 60–79% | mantém o degrau | repete o intervalo atual |
| < 60% | reinicia o ciclo | no dia seguinte |

**Traçado de retenção** — a curvinha à direita de cada tema mostra o histórico: cada estudo
levanta a linha, e ela decai até a próxima revisão. Verde acima de 80%, âmbar entre 60 e 80,
vermelho abaixo. Serve para bater o olho e ver onde a memória está caindo.

**Peso dos temas** — a bolinha antes do nome indica incidência: vermelha = alta, âmbar = média,
cinza = baixa. Os 74 temas iniciais cobrem as cinco grandes áreas do acesso direto. Ajuste os
pesos conforme o perfil da sua banca — quem faz ENARE e quem faz USP não tem a mesma distribuição.

---

## Backup e troca de aparelho

`localStorage` é por navegador e por dispositivo. Para levar o histórico do notebook para o
celular, use **exportar .json** de um lado e **importar** do outro. Vale exportar uma vez por
semana — se você limpar os dados do navegador, o histórico vai junto.

Se um dia a sincronização automática fizer falta, dá para trocar o `localStorage` por Supabase
(plano gratuito) sem mexer no resto do código: as únicas funções que tocam em armazenamento são
`carregar()` e `salvar()`.

## Arquivos

```
index.html            todo o app — HTML, CSS e JS, sem dependências
manifest.webmanifest  instalação como aplicativo
sw.js                 cache para uso offline
icone.svg             ícone
```
