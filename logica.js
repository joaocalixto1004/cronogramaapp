/* Núcleo do cronograma: catálogo, datas, revisão espaçada e derivação.
 *
 * Só funções puras — nada aqui toca DOM, rede ou localStorage. É o que
 * permite testar a regra de revisão e a migração fora do navegador.
 */

export const INTERVALOS = [1, 7, 30, 90]; // revisão espaçada, em dias
export const AREAS = ["Clínica Médica", "Cirurgia", "Ginecologia e Obstetrícia", "Pediatria", "Medicina Preventiva"];

/* Temas iniciais: peso 3 = alta incidência nas provas de acesso direto.
   São catálogo do cliente, não dado do usuário — o servidor só guarda os
   desvios (temas criados, temas removidos) e o histórico de estudo. */
export const SEMENTE = [
["Clínica Médica","Síndromes coronarianas agudas",3],
["Clínica Médica","Insuficiência cardíaca",3],
["Clínica Médica","Hipertensão arterial sistêmica",3],
["Clínica Médica","Arritmias e fibrilação atrial",2],
["Clínica Médica","Asma e DPOC",3],
["Clínica Médica","Pneumonias e derrame pleural",3],
["Clínica Médica","Tromboembolismo pulmonar",2],
["Clínica Médica","Distúrbios hidroeletrolíticos",3],
["Clínica Médica","Distúrbios ácido-base",2],
["Clínica Médica","Injúria renal aguda e DRC",3],
["Clínica Médica","Diabetes mellitus e complicações agudas",3],
["Clínica Médica","Tireoidopatias",2],
["Clínica Médica","Hepatites virais e cirrose",3],
["Clínica Médica","Hemorragia digestiva",2],
["Clínica Médica","HIV e infecções oportunistas",3],
["Clínica Médica","Tuberculose",3],
["Clínica Médica","Sepse e choque",3],
["Clínica Médica","Anemias",2],
["Clínica Médica","Leucemias e linfomas",2],
["Clínica Médica","Lúpus, artrite reumatoide e vasculites",2],
["Clínica Médica","AVC e emergências neurológicas",3],
["Clínica Médica","Cefaleias e epilepsia",1],
["Cirurgia","Trauma — ABCDE e ATLS",3],
["Cirurgia","Trauma abdominal e torácico",3],
["Cirurgia","Choque e reposição volêmica",3],
["Cirurgia","Abdome agudo inflamatório",3],
["Cirurgia","Apendicite aguda",3],
["Cirurgia","Colecistite e coledocolitíase",3],
["Cirurgia","Obstrução intestinal",2],
["Cirurgia","Pancreatite aguda",2],
["Cirurgia","Hérnias da parede abdominal",2],
["Cirurgia","Queimaduras",2],
["Cirurgia","Pré e pós-operatório",2],
["Cirurgia","Câncer gástrico e colorretal",2],
["Cirurgia","Doença arterial e venosa periférica",2],
["Cirurgia","Urologia — litíase e HPB",1],
["Ginecologia e Obstetrícia","Pré-natal de baixo risco",3],
["Ginecologia e Obstetrícia","Síndromes hipertensivas da gestação",3],
["Ginecologia e Obstetrícia","Hemorragias da primeira metade",3],
["Ginecologia e Obstetrícia","Hemorragias da segunda metade",3],
["Ginecologia e Obstetrícia","Trabalho de parto e partograma",3],
["Ginecologia e Obstetrícia","Diabetes na gestação",2],
["Ginecologia e Obstetrícia","Infecções congênitas",2],
["Ginecologia e Obstetrícia","SUA e PALM-COEIN",3],
["Ginecologia e Obstetrícia","Síndrome dos ovários policísticos",3],
["Ginecologia e Obstetrícia","Endometriose",2],
["Ginecologia e Obstetrícia","Climatério e terapia hormonal",2],
["Ginecologia e Obstetrícia","Rastreio e lesões do colo — HPV/NIC",3],
["Ginecologia e Obstetrícia","Câncer e nódulos de mama",3],
["Ginecologia e Obstetrícia","Infecções genitais e DIP",2],
["Ginecologia e Obstetrícia","Contracepção",2],
["Pediatria","Reanimação neonatal",3],
["Pediatria","Icterícia neonatal",3],
["Pediatria","Sepse neonatal e infecções perinatais",2],
["Pediatria","Aleitamento materno",3],
["Pediatria","Crescimento e desenvolvimento",3],
["Pediatria","Calendário vacinal",3],
["Pediatria","Diarreia e desidratação",3],
["Pediatria","Pneumonia e bronquiolite",3],
["Pediatria","Asma na infância",2],
["Pediatria","IVAS e otite média aguda",2],
["Pediatria","Doenças exantemáticas",2],
["Pediatria","Desnutrição e carências",2],
["Pediatria","ITU e refluxo vesicoureteral",1],
["Pediatria","Violência e maus-tratos",2],
["Medicina Preventiva","SUS — princípios e Leis 8.080/8.142",3],
["Medicina Preventiva","Atenção primária e ESF",3],
["Medicina Preventiva","Tipos de estudo epidemiológico",3],
["Medicina Preventiva","Medidas de associação e impacto",3],
["Medicina Preventiva","Testes diagnósticos — S, E, VPP, VPN",3],
["Medicina Preventiva","Indicadores de saúde",2],
["Medicina Preventiva","Vigilância e notificação compulsória",2],
["Medicina Preventiva","Bioestatística aplicada",2],
["Medicina Preventiva","Ética médica e bioética",2],
["Medicina Preventiva","Saúde do trabalhador",1],
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

/* ---------- leitura de um tema ---------- */
export const ultimo = (t) => (t.historico.length ? t.historico[t.historico.length - 1] : null);
export const desempenho = (t) => (ultimo(t) ? ultimo(t).a : null);
export const atraso = (t, hj = hoje()) => (t.proxima ? diasEntre(t.proxima, hj) : null);

/** Prioridade: incidência × lacuna de desempenho × urgência da revisão */
export function prioridade(t, hj = hoje()) {
  const p = t.peso * 10;
  const d = desempenho(t);
  const lacuna = d === null ? 22 : (100 - d) / 4;
  const at = atraso(t, hj);
  const urg = at === null ? 6 : at >= 0 ? 14 + Math.min(at, 20) : Math.max(0, 6 + at);
  return p + lacuna + urg;
}

/* ---------- revisão espaçada ---------- */
export function aplicarEstudo(t, data, acertos) {
  t.historico.push({ d: data, a: acertos });
  if (acertos >= 80) t.etapa = Math.min(t.etapa + 1, INTERVALOS.length - 1);
  else if (acertos < 60) t.etapa = 0;   // abaixo de 60% reinicia o ciclo
  // entre 60 e 79 consolida: mantém a etapa atual
  t.proxima = somaDias(data, INTERVALOS[t.etapa]);
}

/* ---------- derivação ----------
   Replay completo a cada mudança. Eventos de outro aparelho podem chegar com
   ts mais antigo que os locais, e só o replay em ordem cronológica produz a
   etapa correta da revisão espaçada. ~1.500 eventos por ano de uso: barato. */
export function derivar(eventos) {
  const catalogo = new Map();
  for (const [area, nome, peso] of SEMENTE) {
    const id = idTema(area, nome);
    catalogo.set(id, { id, area, nome, peso, etapa: 0, proxima: null, historico: [] });
  }

  const porTs = [...eventos].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const removidos = new Set();

  // 1) catálogo primeiro, independente de data de estudo: um tema criado hoje
  //    pode receber um estudo datado de ontem.
  for (const ev of porTs) {
    if (ev.tipo === "tema+") {
      const { tema, nome, area, peso } = ev.dados;
      const existente = catalogo.get(tema);
      if (existente) Object.assign(existente, { nome, area, peso });
      else catalogo.set(tema, { id: tema, area, nome, peso, etapa: 0, proxima: null, historico: [] });
      removidos.delete(tema);
    } else if (ev.tipo === "tema-") {
      removidos.add(ev.dados.tema);
    }
  }

  // 2) prova: vence o evento mais recente.
  let prova = { nome: "a prova", data: "" };
  for (const ev of porTs) {
    if (ev.tipo === "prova") prova = { nome: ev.dados.nome || "a prova", data: ev.dados.data || "" };
  }

  // 3) estudos, em ordem de data de estudo — não de criação do evento.
  const estudos = eventos
    .filter((e) => e.tipo === "estudo")
    .sort((a, b) =>
      a.dados.data < b.dados.data ? -1 : a.dados.data > b.dados.data ? 1
      : a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
  for (const ev of estudos) {
    const t = catalogo.get(ev.dados.tema);
    if (t) aplicarEstudo(t, ev.dados.data, ev.dados.acertos);
  }

  return { prova, temas: [...catalogo.values()].filter((t) => !removidos.has(t.id)) };
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
      novos.push({
        id: `mig:tema:${id}`, tipo: "tema+", ts,
        dados: {
          tema: id, nome: t.nome, area: t.area || AREAS[0],
          peso: [1, 2, 3].includes(t.peso) ? t.peso : 2,
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
    novos.push({ id: "mig:prova", tipo: "prova", ts, dados: { nome: p.nome || "", data: p.data || "" } });
  }

  return novos;
}
