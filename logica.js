/* Núcleo do cronograma: catálogo, datas, revisão espaçada e derivação.
 *
 * Só funções puras — nada aqui toca DOM, rede ou localStorage. É o que
 * permite testar a regra de revisão e a migração fora do navegador.
 */

export const INTERVALOS = [1, 7, 30, 90]; // revisão espaçada, em dias

/* As sete áreas da Matriz de Referência do ENAMED (Portaria INEP 478/2025).
   "Medicina Preventiva" cobre Saúde Coletiva e mantém o nome antigo de
   propósito: o id de cada tema deriva do nome da área, então renomear
   desassociaria todo o histórico já registrado. */
export const AREAS = [
  "Clínica Médica",
  "Cirurgia",
  "Ginecologia e Obstetrícia",
  "Pediatria",
  "Medicina Preventiva",
  "Medicina de Família e Comunidade",
  "Saúde Mental",
];

/* Perfis de prova. Cada tema carrega um peso por perfil porque as provas não
   cobram a mesma coisa: MFC e Saúde Mental pesam no ENAMED e quase nada numa
   prova clássica de acesso direto; subespecialidade cirúrgica é o inverso. */
export const PERFIS = ["enamed", "sesdf"];
export const PERFIL_PADRAO = "enamed";

/* [área, tema, peso ENAMED, peso SES-DF] — 3 = alta incidência.
   Pesos editoriais, para você ajustar conforme resolve questões. */
export const SEMENTE = [
["Clínica Médica","Síndromes coronarianas agudas",3,3],
["Clínica Médica","Insuficiência cardíaca",3,3],
["Clínica Médica","Hipertensão arterial sistêmica",3,3],
["Clínica Médica","Arritmias e fibrilação atrial",2,2],
["Clínica Médica","Asma e DPOC",3,3],
["Clínica Médica","Pneumonias e derrame pleural",3,3],
["Clínica Médica","Tromboembolismo pulmonar",2,2],
["Clínica Médica","Distúrbios hidroeletrolíticos",2,3],
["Clínica Médica","Distúrbios ácido-base",2,2],
["Clínica Médica","Injúria renal aguda e DRC",3,3],
["Clínica Médica","Diabetes mellitus e complicações agudas",3,3],
["Clínica Médica","Tireoidopatias",2,2],
["Clínica Médica","Hepatites virais e cirrose",3,3],
["Clínica Médica","Hemorragia digestiva",2,2],
["Clínica Médica","HIV e infecções oportunistas",3,3],
["Clínica Médica","Tuberculose",3,3],
["Clínica Médica","Sepse e choque",3,3],
["Clínica Médica","Anemias",2,2],
["Clínica Médica","Leucemias e linfomas",1,2],
["Clínica Médica","Lúpus, artrite reumatoide e vasculites",2,2],
["Clínica Médica","AVC e emergências neurológicas",3,3],
["Clínica Médica","Cefaleias e epilepsia",2,1],
["Cirurgia","Trauma — ABCDE e ATLS",3,3],
["Cirurgia","Trauma abdominal e torácico",2,3],
["Cirurgia","Choque e reposição volêmica",3,3],
["Cirurgia","Abdome agudo inflamatório",3,3],
["Cirurgia","Apendicite aguda",3,3],
["Cirurgia","Colecistite e coledocolitíase",3,3],
["Cirurgia","Obstrução intestinal",2,2],
["Cirurgia","Pancreatite aguda",2,2],
["Cirurgia","Hérnias da parede abdominal",2,2],
["Cirurgia","Queimaduras",2,2],
["Cirurgia","Pré e pós-operatório",2,2],
["Cirurgia","Câncer gástrico e colorretal",1,2],
["Cirurgia","Doença arterial e venosa periférica",2,2],
["Cirurgia","Urologia — litíase e HPB",2,1],
["Ginecologia e Obstetrícia","Pré-natal de baixo risco",3,3],
["Ginecologia e Obstetrícia","Síndromes hipertensivas da gestação",3,3],
["Ginecologia e Obstetrícia","Hemorragias da primeira metade",3,3],
["Ginecologia e Obstetrícia","Hemorragias da segunda metade",3,3],
["Ginecologia e Obstetrícia","Trabalho de parto e partograma",3,3],
["Ginecologia e Obstetrícia","Diabetes na gestação",2,2],
["Ginecologia e Obstetrícia","Infecções congênitas",2,2],
["Ginecologia e Obstetrícia","SUA e PALM-COEIN",2,3],
["Ginecologia e Obstetrícia","Síndrome dos ovários policísticos",2,3],
["Ginecologia e Obstetrícia","Endometriose",2,2],
["Ginecologia e Obstetrícia","Climatério e terapia hormonal",2,2],
["Ginecologia e Obstetrícia","Rastreio e lesões do colo — HPV/NIC",3,3],
["Ginecologia e Obstetrícia","Câncer e nódulos de mama",3,3],
["Ginecologia e Obstetrícia","Infecções genitais e DIP",3,2],
["Ginecologia e Obstetrícia","Contracepção",3,2],
["Pediatria","Reanimação neonatal",3,3],
["Pediatria","Icterícia neonatal",3,3],
["Pediatria","Sepse neonatal e infecções perinatais",2,2],
["Pediatria","Aleitamento materno",3,2],
["Pediatria","Crescimento e desenvolvimento",3,2],
["Pediatria","Calendário vacinal",3,3],
["Pediatria","Diarreia e desidratação",3,3],
["Pediatria","Pneumonia e bronquiolite",3,3],
["Pediatria","Asma na infância",2,2],
["Pediatria","IVAS e otite média aguda",3,2],
["Pediatria","Doenças exantemáticas",2,2],
["Pediatria","Desnutrição e carências",2,2],
["Pediatria","ITU e refluxo vesicoureteral",1,1],
["Pediatria","Violência e maus-tratos",3,2],
["Medicina Preventiva","SUS — princípios e Leis 8.080/8.142",3,3],
["Medicina Preventiva","Atenção primária e ESF",3,3],
["Medicina Preventiva","Tipos de estudo epidemiológico",3,3],
["Medicina Preventiva","Medidas de associação e impacto",3,3],
["Medicina Preventiva","Testes diagnósticos — S, E, VPP, VPN",3,3],
["Medicina Preventiva","Indicadores de saúde",2,2],
["Medicina Preventiva","Vigilância e notificação compulsória",3,2],
["Medicina Preventiva","Bioestatística aplicada",2,2],
["Medicina Preventiva","Ética médica e bioética",3,2],
["Medicina Preventiva","Saúde do trabalhador",2,1],
["Medicina de Família e Comunidade","Método clínico centrado na pessoa",3,1],
["Medicina de Família e Comunidade","Prevenção quaternária e rastreamento",3,1],
["Medicina de Família e Comunidade","Hipertensão e diabetes na atenção primária",3,2],
["Medicina de Família e Comunidade","Multimorbidade e polifarmácia no idoso",3,1],
["Medicina de Família e Comunidade","Saúde da mulher na atenção primária",3,1],
["Medicina de Família e Comunidade","Acompanhamento da criança na atenção primária",3,1],
["Medicina de Família e Comunidade","Tabagismo, álcool e outras drogas",3,1],
["Medicina de Família e Comunidade","Registro clínico orientado por problemas",2,1],
["Medicina de Família e Comunidade","Visita domiciliar e cuidados paliativos",3,1],
["Medicina de Família e Comunidade","Territorialização e trabalho em equipe",2,1],
["Medicina de Família e Comunidade","Imunização na prática clínica",3,2],
["Medicina de Família e Comunidade","Manejo de sintomas comuns na atenção primária",3,1],
["Saúde Mental","Transtornos depressivos",3,2],
["Saúde Mental","Transtornos de ansiedade",3,2],
["Saúde Mental","Transtorno afetivo bipolar",3,1],
["Saúde Mental","Esquizofrenia e outras psicoses",3,1],
["Saúde Mental","Risco de suicídio e manejo da crise",3,2],
["Saúde Mental","Álcool — intoxicação e abstinência",3,2],
["Saúde Mental","Transtornos por uso de substâncias",3,1],
["Saúde Mental","Delirium e demências",3,2],
["Saúde Mental","Psicofármacos e efeitos adversos",3,1],
["Saúde Mental","RAPS e reforma psiquiátrica",3,2],
];

/* ---------- identidade dos temas ----------
   O ID vem do nome, não da posição no array. Com IDs por índice ("t7"),
   inserir um tema no meio da semente deslocava todos os seguintes e colava
   o histórico no tema errado. */
export const slug = (s) =>
  String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const idTema = (area, nome) => `${slug(area)}/${slug(nome)}`;
export const ID_VALIDO = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/* ---------- datas ---------- */
export const hoje = () => new Date().toISOString().slice(0, 10);
export const diasEntre = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 864e5);
export function somaDias(iso, n) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export const fmt = (iso) =>
  iso ? new Date(iso + "T00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "";
export const diaDaSemana = (iso) => new Date(iso + "T00:00").getDay(); // 0 = domingo

/* ---------- leitura de um tema ---------- */
export const ultimo = (t) => (t.historico.length ? t.historico[t.historico.length - 1] : null);
export const desempenho = (t) => (ultimo(t) ? ultimo(t).a : null);
export const atraso = (t, hj = hoje()) => (t.proxima ? diasEntre(t.proxima, hj) : null);

/** Peso do tema para o perfil da prova alvo. Sem perfil conhecido, a média —
 *  assim uma prova nova não zera a priorização enquanto não for classificada. */
export function pesoDe(t, perfil = PERFIL_PADRAO) {
  const p = t.pesos ?? {};
  if (Number.isFinite(p[perfil])) return p[perfil];
  const vals = PERFIS.map((k) => p[k]).filter(Number.isFinite);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 2;
}

/** Total de questões resolvidas no tema. */
export const questoesFeitas = (t) =>
  t.historico.reduce((s, h) => s + (Number.isInteger(h.q) ? h.q : 0), 0);

/* ---------- provas e fases ---------- */

/** A próxima prova ainda não realizada. É ela que aperta o ritmo. */
export function provaAlvo(provas, hj = hoje()) {
  return (provas ?? [])
    .filter((p) => p.data && diasEntre(hj, p.data) >= 0)
    .sort((a, b) => (a.data < b.data ? -1 : 1))[0] ?? null;
}

/** Fase do preparo, derivada da distância até a prova — não é configurável
 *  porque não deveria ser: o que muda o certo a fazer é o tempo restante. */
export function fase(dias) {
  if (dias === null || dias === undefined) return "livre";
  if (dias > 365) return "cobertura";
  if (dias > 180) return "consolidacao";
  if (dias > 60) return "aprofundamento";
  return "reta-final";
}

export const NOME_FASE = {
  livre: "sem prova marcada",
  cobertura: "cobertura",
  consolidacao: "consolidação",
  aprofundamento: "aprofundamento",
  "reta-final": "reta final",
};

/** Prioridade: incidência × lacuna de desempenho × urgência, com o ajuste
 *  que a fase pede. Na reta final, tema nunca visto é empurrado para o fim:
 *  abrir assunto novo às vésperas custa mais do que rende. */
export function prioridade(t, hj = hoje(), alvo = null) {
  const f = alvo ? fase(diasEntre(hj, alvo.data)) : "livre";
  const p = pesoDe(t, alvo?.perfil) * 10;
  const d = desempenho(t);
  const lacuna = d === null ? 22 : (100 - d) / 4;
  const at = atraso(t, hj);
  const urg = at === null ? 6 : at >= 0 ? 14 + Math.min(at, 20) : Math.max(0, 6 + at);
  const nunca = !t.historico.length;

  const ajuste =
    f === "cobertura" ? (nunca ? 15 : 0)
    : f === "aprofundamento" ? (d !== null && d < 70 ? 10 : 0)
    : f === "reta-final" ? (nunca ? -40 : 10)
    : 0;

  return p + lacuna + urg + ajuste;
}

/* ---------- revisão espaçada ---------- */

/** Intervalo da etapa, encurtado quando a prova está perto.
 *
 * Uma revisão marcada para depois da prova é uma revisão que não acontece:
 * a 40 dias do dia, o degrau de 90 significa "nunca mais". Metade do tempo
 * restante garante mais de uma passada antes da data, e o encurtamento se
 * acentua sozinho conforme a prova chega. */
export function intervaloAjustado(etapa, data, dataProva) {
  const base = INTERVALOS[etapa];
  if (!dataProva) return base;
  const restantes = diasEntre(data, dataProva);
  if (restantes <= 0) return base;           // prova já passou: volta ao ritmo normal
  return Math.max(1, Math.min(base, Math.floor(restantes / 2)));
}

/** Normaliza um registro de estudo para a forma guardada no histórico.
 *  Aceita os dois formatos: o antigo (`acertos` em %) e o novo (contagem). */
export function normalizarRegistro(d) {
  const q = Number.isInteger(d.questoes) && d.questoes > 0 ? d.questoes : null;
  const c = Number.isInteger(d.certas) && d.certas >= 0 ? Math.min(d.certas, q ?? d.certas) : null;
  const a =
    q !== null && c !== null ? Math.round((c / q) * 100)
    : Number.isFinite(d.acertos) ? Math.max(0, Math.min(100, Math.round(d.acertos)))
    : null;
  const m = Number.isInteger(d.minutos) && d.minutos > 0 ? d.minutos : null;
  return { d: d.data, a, q, c, m };
}

export function aplicarEstudo(t, registro, dataProva = "") {
  const h = normalizarRegistro(registro);
  if (h.a === null) return;                  // sem desempenho não há o que agendar
  t.historico.push(h);
  if (h.a >= 80) t.etapa = Math.min(t.etapa + 1, INTERVALOS.length - 1);
  else if (h.a < 60) t.etapa = 0;            // abaixo de 60% reinicia o ciclo
  // entre 60 e 79 consolida: mantém a etapa atual
  t.proxima = somaDias(h.d, intervaloAjustado(t.etapa, h.d, dataProva));
}

/* ---------- rotina ---------- */

/** Minutos por dia da semana, domingo primeiro. ~15,5 h/semana. */
export const ROTINA_PADRAO = [120, 120, 120, 120, 120, 120, 180];
export const BLOCO_PADRAO = 45;
export const BLOCO_MINIMO = 15;

export function normalizarRotina(minutos) {
  if (!Array.isArray(minutos) || minutos.length !== 7) return null;
  // Rejeita o array inteiro em vez de zerar o elemento ruim: um payload
  // corrompido apagando só uma terça-feira é pior que cair no padrão.
  if (!minutos.every((m) => Number.isInteger(m) && m >= 0)) return null;
  return minutos.map((m) => Math.min(m, 16 * 60));
}

/** Quanto esse tema costuma consumir. Mediana do que já foi registrado, para
 *  o plano refletir o seu ritmo em vez de um número inventado. */
export function duracaoTipica(t) {
  const ms = t.historico.map((h) => h.m).filter((m) => Number.isInteger(m) && m > 0);
  if (!ms.length) return BLOCO_PADRAO;
  const ord = [...ms].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 ? ord[meio] : Math.round((ord[meio - 1] + ord[meio]) / 2);
}

function motivoDe(t, hj) {
  const a = atraso(t, hj);
  if (a !== null && a > 0) return `revisão atrasada ${a}d`;
  if (a === 0) return "revisão de hoje";
  if (!t.historico.length) return "primeira passada";
  const d = desempenho(t);
  if (d !== null && d < 60) return "ponto fraco";
  return "adiantar revisão";
}

/** O plano de hoje, em minutos.
 *
 * Não é um calendário: é um ciclo. Os blocos saem da prioridade com rodízio de
 * área — não repete área enquanto houver outra elegível, que é o interleaving
 * que a evidência sustenta. Como nada guarda posição do ciclo, um dia perdido
 * não desalinha nada: no dia seguinte o atraso já entra na conta.
 */
export function planoDoDia(temas, rotina, provas, hj = hoje()) {
  const alvo = provaAlvo(provas, hj);
  const f = alvo ? fase(diasEntre(hj, alvo.data)) : "livre";
  const grade = normalizarRotina(rotina) ?? ROTINA_PADRAO;
  const disponiveis = grade[diaDaSemana(hj)] ?? 0;

  const feitosHoje = temas.flatMap((t) => t.historico.filter((h) => h.d === hj));
  const minutosFeitos = feitosHoje.reduce((s, h) => s + (h.m ?? 0), 0);
  const questoesHoje = feitosHoje.reduce((s, h) => s + (h.q ?? 0), 0);

  let elegiveis = temas.filter((t) => !t.historico.some((h) => h.d === hj));
  // Na reta final, tema nunca visto sai do plano.
  if (f === "reta-final") elegiveis = elegiveis.filter((t) => t.historico.length);

  const ordenados = [...elegiveis].sort((a, b) => prioridade(b, hj, alvo) - prioridade(a, hj, alvo));

  const blocos = [];
  const usados = new Set();
  let restam = Math.max(0, disponiveis - minutosFeitos);
  let ultimaArea = null;

  while (restam >= BLOCO_MINIMO) {
    const escolhido =
      ordenados.find((t) => !usados.has(t.id) && t.area !== ultimaArea) ??
      ordenados.find((t) => !usados.has(t.id));
    if (!escolhido) break;

    const minutos = Math.min(duracaoTipica(escolhido), restam);
    if (minutos < BLOCO_MINIMO) break;

    blocos.push({ tema: escolhido, minutos, motivo: motivoDe(escolhido, hj) });
    usados.add(escolhido.id);
    ultimaArea = escolhido.area;
    restam -= minutos;
  }

  return {
    fase: f, alvo,
    minutosDisponiveis: disponiveis, minutosFeitos, questoesHoje,
    blocos, sobra: restam,
    pendentes: elegiveis.length,
  };
}

/* ---------- derivação ----------
   Replay completo a cada mudança. Eventos de outro aparelho podem chegar com
   ts mais antigo que os locais, e só o replay em ordem cronológica produz a
   etapa correta da revisão espaçada. */
export function derivar(eventos) {
  const catalogo = new Map();
  for (const [area, nome, pe, ps] of SEMENTE) {
    const id = idTema(area, nome);
    catalogo.set(id, {
      id, area, nome, pesos: { enamed: pe, sesdf: ps },
      etapa: 0, proxima: null, historico: [],
    });
  }

  const porTs = [...eventos].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const removidos = new Set();
  const provas = new Map();
  const simulados = [];
  let rotina = null;

  // 1) catálogo, provas e rotina primeiro, independente de data de estudo:
  //    um tema criado hoje pode receber um estudo datado de ontem.
  for (const ev of porTs) {
    switch (ev.tipo) {
      case "tema+": {
        const { tema, nome, area } = ev.dados;
        // `peso` numérico é o formato antigo: vale para os dois perfis.
        const pesos = ev.dados.pesos ?? {
          enamed: ev.dados.peso ?? 2, sesdf: ev.dados.peso ?? 2,
        };
        const existente = catalogo.get(tema);
        if (existente) Object.assign(existente, { nome, area, pesos });
        else catalogo.set(tema, { id: tema, area, nome, pesos, etapa: 0, proxima: null, historico: [] });
        removidos.delete(tema);
        break;
      }
      case "tema-":
        removidos.add(ev.dados.tema);
        break;
      case "prova": {
        // Sem id é o formato antigo, quando só existia uma prova.
        const id = ev.dados.prova || "principal";
        provas.set(id, {
          prova: id,
          nome: ev.dados.nome || "a prova",
          data: ev.dados.data || "",
          perfil: PERFIS.includes(ev.dados.perfil) ? ev.dados.perfil : PERFIL_PADRAO,
        });
        break;
      }
      case "prova-":
        provas.delete(ev.dados.prova);
        break;
      case "rotina":
        rotina = normalizarRotina(ev.dados.minutos) ?? rotina;
        break;
      case "simulado":
        simulados.push({ ...normalizarRegistro(ev.dados), prova: ev.dados.prova ?? null });
        break;
    }
  }

  const lista = [...provas.values()].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  // 2) estudos, em ordem de data de estudo — não de criação do evento.
  //    Cada um mira a prova que ainda estava por vir naquela data, então
  //    depois do ENAMED passar as revisões passam a mirar a SES-DF sozinhas.
  const anulados = new Set();
  for (const ev of porTs) if (ev.tipo === "estudo-") anulados.add(ev.dados.evento);

  const estudos = eventos
    .filter((e) => e.tipo === "estudo" && !anulados.has(e.id))
    .sort((a, b) =>
      a.dados.data < b.dados.data ? -1 : a.dados.data > b.dados.data ? 1
      : a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);

  for (const ev of estudos) {
    const t = catalogo.get(ev.dados.tema);
    if (t) aplicarEstudo(t, ev.dados, provaAlvo(lista, ev.dados.data)?.data ?? "");
  }

  return {
    provas: lista,
    rotina: rotina ?? ROTINA_PADRAO,
    simulados: simulados.sort((a, b) => (a.d < b.d ? -1 : 1)),
    temas: [...catalogo.values()].filter((t) => !removidos.has(t.id)),
  };
}

/* ---------- migração do formato antigo ----------
   IDs determinísticos: reexecutar a migração não duplica nada, porque a fusão
   do log descarta ids repetidos. */
export function eventosDoFormatoAntigo(velho, ts = new Date().toISOString()) {
  if (!velho || !Array.isArray(velho.temas)) return [];

  const novos = [];
  const presentes = new Set();

  for (const t of velho.temas) {
    if (!t || typeof t.nome !== "string") continue;

    // Temas da semente tinham id "t<índice>"; os criados à mão, "t<timestamp>".
    const m = /^t(\d+)$/.exec(t.id ?? "");
    const i = m ? Number(m[1]) : -1;
    const daSemente = i >= 0 && i < SEMENTE.length && SEMENTE[i][1] === t.nome;
    const id = daSemente ? idTema(SEMENTE[i][0], SEMENTE[i][1]) : idTema(t.area ?? "", t.nome);
    if (!ID_VALIDO.test(id)) continue;
    presentes.add(id);

    if (!daSemente) {
      const peso = [1, 2, 3].includes(t.peso) ? t.peso : 2;
      novos.push({
        id: `mig:tema:${id}`, tipo: "tema+", ts,
        dados: {
          tema: id, nome: t.nome, area: t.area || AREAS[0],
          pesos: { enamed: peso, sesdf: peso },
        },
      });
    }

    (Array.isArray(t.historico) ? t.historico : []).forEach((h, k) => {
      if (!h || typeof h.d !== "string" || !Number.isFinite(h.a)) return;
      novos.push({
        id: `mig:estudo:${id}:${k}`, tipo: "estudo",
        ts: `${h.d}T12:00:00.000Z`,
        dados: { tema: id, data: h.d, acertos: Math.max(0, Math.min(100, Math.round(h.a))) },
      });
    });
  }

  // Temas da semente que o usuário havia apagado.
  for (const [area, nome] of SEMENTE) {
    const id = idTema(area, nome);
    if (!presentes.has(id)) novos.push({ id: `mig:rm:${id}`, tipo: "tema-", ts, dados: { tema: id } });
  }

  const p = velho.prova;
  if (p && (p.data || (p.nome && p.nome !== "a prova"))) {
    novos.push({
      id: "mig:prova", tipo: "prova", ts,
      dados: { prova: "principal", nome: p.nome || "", data: p.data || "", perfil: PERFIL_PADRAO },
    });
  }

  return novos;
}
