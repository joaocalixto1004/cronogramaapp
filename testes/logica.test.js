/* Testes do núcleo. Rodar com:  node --test testes/
 *
 * O que importa verificar aqui é o que não dá para ver olhando a tela:
 * que o replay do log produz sempre o mesmo estado, independentemente da
 * ordem em que os eventos chegaram de cada aparelho.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEMENTE, INTERVALOS,
  slug, idTema, ID_VALIDO, somaDias, diasEntre,
  derivar, eventosDoFormatoAntigo,
  intervaloAjustado, planoDoDia, provaAlvo, fase, pesoDe, prioridade, normalizarRegistro,
  ROTINA_PADRAO, BLOCO_PADRAO,
} from "../logica.js";

const ALVO = idTema("Clínica Médica", "Tuberculose");
const acha = (d, id) => d.temas.find((t) => t.id === id);

let n = 0;
const estudo = (tema, data, acertos, ts) => ({
  id: `e${++n}`, tipo: "estudo", ts: ts ?? `${data}T10:00:00.000Z`,
  dados: { tema, data, acertos },
});

/* ---------- identidade ---------- */

test("slug remove acentos e pontuação", () => {
  assert.equal(slug("Insuficiência cardíaca"), "insuficiencia-cardiaca");
  assert.equal(slug("Trauma — ABCDE e ATLS"), "trauma-abcde-e-atls");
  assert.equal(slug("SUS — princípios e Leis 8.080/8.142"), "sus-principios-e-leis-8-080-8-142");
});

test("todo tema da semente gera um id válido e único", () => {
  const ids = SEMENTE.map(([a, nm]) => idTema(a, nm));
  for (const id of ids) assert.ok(ID_VALIDO.test(id), `id inválido: ${id}`);
  assert.equal(new Set(ids).size, ids.length, "há ids duplicados na semente");
});

test("o id não depende da posição na semente", () => {
  // A regressão que motivou a mudança: com id por índice, inserir um tema
  // no meio deslocava todos os seguintes e o histórico ia para o tema errado.
  const antes = idTema(...SEMENTE[40].slice(0, 2));
  const remexida = [["Nova Área", "Tema Extra", 2], ...SEMENTE];
  const depois = idTema(...remexida[41].slice(0, 2));
  assert.equal(antes, depois);
});

/* ---------- revisão espaçada ---------- */

test("≥80% avança a escada de intervalos e satura no topo", () => {
  const evs = [];
  let data = "2026-01-01";
  for (let i = 0; i < 6; i++) { evs.push(estudo(ALVO, data, 90)); data = somaDias(data, 120); }
  const t = acha(derivar(evs), ALVO);
  assert.equal(t.etapa, INTERVALOS.length - 1);
  assert.equal(diasEntre(data === null ? "" : evs.at(-1).dados.data, t.proxima), 90);
});

test("<60% reinicia o ciclo para revisão no dia seguinte", () => {
  const evs = [estudo(ALVO, "2026-01-01", 90), estudo(ALVO, "2026-01-10", 40)];
  const t = acha(derivar(evs), ALVO);
  assert.equal(t.etapa, 0);
  assert.equal(t.proxima, "2026-01-11");
});

test("60–79% consolida: mantém o intervalo atual", () => {
  const evs = [estudo(ALVO, "2026-01-01", 90), estudo(ALVO, "2026-01-05", 70)];
  const t = acha(derivar(evs), ALVO);
  assert.equal(t.etapa, 1);                       // subiu uma vez, não subiu de novo
  assert.equal(t.proxima, somaDias("2026-01-05", 7));
});

/* ---------- convergência entre aparelhos ---------- */

test("a ordem de chegada dos eventos não muda o estado final", () => {
  const evs = [
    estudo(ALVO, "2026-01-01", 85),
    estudo(ALVO, "2026-01-08", 55),
    estudo(ALVO, "2026-01-09", 95),
  ];
  const direto = acha(derivar(evs), ALVO);
  const invertido = acha(derivar([...evs].reverse()), ALVO);
  const embaralhado = acha(derivar([evs[1], evs[2], evs[0]]), ALVO);

  assert.deepEqual(invertido, direto);
  assert.deepEqual(embaralhado, direto);
});

test("um estudo registrado hoje com data retroativa entra na posição certa", () => {
  // Celular offline registra ontem; notebook já tinha registrado hoje.
  const deHoje = estudo(ALVO, "2026-03-10", 95, "2026-03-10T09:00:00.000Z");
  const atrasado = estudo(ALVO, "2026-03-05", 30, "2026-03-10T23:00:00.000Z");
  const t = acha(derivar([deHoje, atrasado]), ALVO);

  assert.deepEqual(t.historico.map((h) => h.d), ["2026-03-05", "2026-03-10"]);
  assert.equal(t.etapa, 1, "o 30% deve zerar antes do 95% subir um degrau");
});

/* ---------- catálogo ---------- */

test("tema criado hoje aceita estudo datado de ontem", () => {
  const id = idTema("Clínica Médica", "Doença de Chagas");
  const evs = [
    { id: "a", tipo: "tema+", ts: "2026-05-02T10:00:00.000Z",
      dados: { tema: id, nome: "Doença de Chagas", area: "Clínica Médica", peso: 2 } },
    estudo(id, "2026-05-01", 75),
  ];
  const t = acha(derivar(evs), id);
  assert.ok(t, "o tema deveria existir");
  assert.equal(t.historico.length, 1);
});

test("tema- esconde o tema e tema+ posterior o traz de volta", () => {
  const removido = [{ id: "r", tipo: "tema-", ts: "2026-01-01T00:00:00.000Z", dados: { tema: ALVO } }];
  assert.equal(acha(derivar(removido), ALVO), undefined);

  const revivido = [...removido, {
    id: "v", tipo: "tema+", ts: "2026-02-01T00:00:00.000Z",
    dados: { tema: ALVO, nome: "Tuberculose", area: "Clínica Médica", peso: 3 },
  }];
  assert.ok(acha(derivar(revivido), ALVO));
});

test("prova é decidida pelo evento mais recente", () => {
  const evs = [
    { id: "p2", tipo: "prova", ts: "2026-02-01T00:00:00.000Z", dados: { nome: "ENARE", data: "2026-11-01" } },
    { id: "p1", tipo: "prova", ts: "2026-01-01T00:00:00.000Z", dados: { nome: "USP", data: "2026-12-01" } },
  ];
  const ps = derivar(evs).provas;
  assert.equal(ps.length, 1, "sem id, os dois eventos falam da mesma prova");
  assert.equal(ps[0].nome, "ENARE");
  assert.equal(ps[0].data, "2026-11-01");
  assert.equal(ps[0].prova, "principal", "evento antigo sem id vira a prova principal");
});

test("estudo em tema desconhecido é ignorado, não quebra", () => {
  const d = derivar([estudo("area-que/nao-existe", "2026-01-01", 90)]);
  assert.equal(d.temas.length, SEMENTE.length);
});

/* ---------- migração do formato antigo ---------- */

test("migração preserva o histórico e cola no tema certo", () => {
  const velho = {
    prova: { nome: "USP", data: "2026-11-15" },
    temas: SEMENTE.map((t, i) => ({
      id: "t" + i, area: t[0], nome: t[1], peso: t[2],
      etapa: 0, proxima: null, historico: [],
    })),
  };
  const i = SEMENTE.findIndex(([, nm]) => nm === "Tuberculose");
  velho.temas[i].historico = [{ d: "2026-01-01", a: 90 }, { d: "2026-01-08", a: 85 }];

  const d = derivar(eventosDoFormatoAntigo(velho));
  const t = acha(d, ALVO);

  assert.equal(t.nome, "Tuberculose");
  assert.deepEqual(t.historico.map((h) => [h.d, h.a]), [["2026-01-01", 90], ["2026-01-08", 85]]);
  assert.equal(d.provas[0].nome, "USP");
  assert.equal(d.provas[0].data, "2026-11-15");
  assert.equal(d.temas.length, SEMENTE.length);
});

test("migração é idempotente: os ids são determinísticos", () => {
  const velho = {
    prova: { nome: "a prova", data: "" },
    temas: [{ id: "t15", area: "Clínica Médica", nome: "Tuberculose", peso: 3, historico: [{ d: "2026-01-01", a: 90 }] }],
  };
  const a = eventosDoFormatoAntigo(velho, "2026-01-01T00:00:00.000Z");
  const b = eventosDoFormatoAntigo(velho, "2026-06-01T00:00:00.000Z");
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id));
});

test("migração converte tema criado à mão e marca os apagados", () => {
  const velho = {
    prova: { nome: "a prova", data: "" },
    temas: [
      { id: "t1700000000000", area: "Cirurgia", nome: "Tema Meu", peso: 1, historico: [] },
    ],
  };
  const evs = eventosDoFormatoAntigo(velho);
  const criado = evs.find((e) => e.tipo === "tema+");
  assert.equal(criado.dados.tema, idTema("Cirurgia", "Tema Meu"));

  // Nenhum tema da semente estava presente, logo todos viram tombstone.
  assert.equal(evs.filter((e) => e.tipo === "tema-").length, SEMENTE.length);

  const d = derivar(evs);
  assert.equal(d.temas.length, 1);
  assert.equal(d.temas[0].nome, "Tema Meu");
});

test("migração tolera lixo sem lançar", () => {
  assert.deepEqual(eventosDoFormatoAntigo(null), []);
  assert.deepEqual(eventosDoFormatoAntigo({}), []);
  const evs = eventosDoFormatoAntigo({
    temas: [null, { nome: 123 }, { id: "t0", nome: "Síndromes coronarianas agudas", area: "Clínica Médica", historico: "nao-e-array" }],
  });
  assert.ok(Array.isArray(evs));
});

/* ---------- a prova aperta o ritmo ---------- */

test("sem prova marcada os intervalos são os da escada", () => {
  INTERVALOS.forEach((v, e) => assert.equal(intervaloAjustado(e, "2026-01-01", ""), v));
});

test("intervalo nunca passa da metade do tempo que falta", () => {
  // Faltando 40 dias, o degrau de 90 marcaria a revisão para depois da prova.
  assert.equal(intervaloAjustado(3, "2026-01-01", somaDias("2026-01-01", 40)), 20);
  assert.equal(intervaloAjustado(2, "2026-01-01", somaDias("2026-01-01", 40)), 20);
  assert.equal(intervaloAjustado(1, "2026-01-01", somaDias("2026-01-01", 40)), 7);
});

test("com prova distante nada é encurtado", () => {
  assert.equal(intervaloAjustado(3, "2026-01-01", somaDias("2026-01-01", 365)), 90);
});

test("na véspera ainda sobra uma revisão", () => {
  assert.equal(intervaloAjustado(3, "2026-01-01", somaDias("2026-01-01", 1)), 1);
  assert.equal(intervaloAjustado(3, "2026-01-01", somaDias("2026-01-01", 2)), 1);
});

test("depois da prova volta ao ritmo normal", () => {
  assert.equal(intervaloAjustado(3, "2026-06-01", "2026-01-01"), 90);
});

test("nenhuma revisão é agendada para depois da prova", () => {
  const prova = "2026-03-01";
  const evs = [
    { id: "p", tipo: "prova", ts: "2026-01-01T00:00:00.000Z", dados: { nome: "X", data: prova } },
    estudo(ALVO, "2026-01-20", 95),
  ];
  const t = acha(derivar(evs), ALVO);
  assert.ok(t.proxima <= prova, `revisão em ${t.proxima} cairia depois da prova (${prova})`);
});

test("mudar a data da prova reprograma a revisão", () => {
  const base = estudo(ALVO, "2026-01-20", 95);
  const longe = derivar([base, { id: "p", tipo: "prova", ts: "2026-01-01T00:00:00.000Z", dados: { nome: "X", data: "2027-01-01" } }]);
  // 8 dias até a prova: metade disso (4) é menor que o degrau de 7.
  const perto = derivar([base, { id: "p", tipo: "prova", ts: "2026-01-01T00:00:00.000Z", dados: { nome: "X", data: "2026-01-28" } }]);
  assert.equal(acha(longe, ALVO).proxima, "2026-01-27");
  assert.equal(acha(perto, ALVO).proxima, "2026-01-24");
});

/* ---------- desfazer ---------- */

test("estudo anulado some do histórico e devolve a etapa anterior", () => {
  const bom = estudo(ALVO, "2026-01-01", 90);
  const errado = estudo(ALVO, "2026-01-05", 20);   // registrado no tema errado
  const comErro = acha(derivar([bom, errado]), ALVO);
  assert.equal(comErro.etapa, 0, "o 20% zerou o ciclo");
  assert.equal(comErro.historico.length, 2);

  const anulado = { id: "an", tipo: "estudo-", ts: "2026-01-05T12:00:00.000Z", dados: { evento: errado.id } };
  const t = acha(derivar([bom, errado, anulado]), ALVO);
  assert.equal(t.historico.length, 1, "o registro errado sai do histórico");
  assert.deepEqual([t.historico[0].d, t.historico[0].a], ["2026-01-01", 90]);
  assert.equal(t.etapa, 1, "a etapa volta a ser a que era antes do erro");
});

test("anular vale independentemente da ordem de chegada", () => {
  const e = estudo(ALVO, "2026-02-01", 30);
  const anular = { id: "an", tipo: "estudo-", ts: "2026-02-01T12:00:00.000Z", dados: { evento: e.id } };
  assert.equal(acha(derivar([anular, e]), ALVO).historico.length, 0);
  assert.equal(acha(derivar([e, anular]), ALVO).historico.length, 0);
});

test("anular um evento que não existe é inofensivo", () => {
  const e = estudo(ALVO, "2026-02-01", 90);
  const anular = { id: "an", tipo: "estudo-", ts: "2026-02-02T00:00:00.000Z", dados: { evento: "nunca-existiu" } };
  assert.equal(acha(derivar([e, anular]), ALVO).historico.length, 1);
});

test("remover e desfazer devolve o tema com o histórico intacto", () => {
  const evs = [
    estudo(ALVO, "2026-01-01", 90),
    { id: "rm", tipo: "tema-", ts: "2026-02-01T00:00:00.000Z", dados: { tema: ALVO } },
  ];
  assert.equal(acha(derivar(evs), ALVO), undefined);

  const desfeito = [...evs, {
    id: "undo", tipo: "tema+", ts: "2026-02-01T00:00:05.000Z",
    dados: { tema: ALVO, nome: "Tuberculose", area: "Clínica Médica", peso: 3 },
  }];
  const t = acha(derivar(desfeito), ALVO);
  assert.ok(t, "o tema volta");
  assert.equal(t.historico.length, 1, "e o histórico volta com ele");
});

/* ---------- retrocompatibilidade ---------- */

const ENAMED = { prova: "enamed", nome: "ENAMED", data: "2028-09-13", perfil: "enamed" };
const SESDF = { prova: "sesdf", nome: "SES-DF", data: "2029-01-11", perfil: "sesdf" };
const evProva = (p, ts) => ({ id: "p:" + p.prova, tipo: "prova", ts, dados: p });

test("evento de estudo no formato antigo continua valendo", () => {
  const t = acha(derivar([estudo(ALVO, "2026-01-01", 90)]), ALVO);
  assert.equal(t.historico[0].a, 90);
  assert.equal(t.historico[0].q, null, "sem volume, o campo fica nulo em vez de mentir");
});

test("percentual sai da contagem quando ela existe", () => {
  const h = normalizarRegistro({ data: "2026-01-01", questoes: 40, certas: 30, minutos: 50 });
  assert.equal(h.a, 75);
  assert.equal(h.q, 40);
  assert.equal(h.m, 50);
});

test("contagem e percentual antigo produzem o mesmo desempenho", () => {
  const contagem = normalizarRegistro({ data: "2026-01-01", questoes: 10, certas: 7 });
  const antigo = normalizarRegistro({ data: "2026-01-01", acertos: 70 });
  assert.equal(contagem.a, antigo.a);
});

test("tema+ com peso único vale para os dois perfis", () => {
  const id = idTema("Cirurgia", "Tema Meu");
  const d = derivar([{
    id: "a", tipo: "tema+", ts: "2026-01-01T00:00:00.000Z",
    dados: { tema: id, nome: "Tema Meu", area: "Cirurgia", peso: 3 },
  }]);
  const t = acha(d, id);
  assert.equal(pesoDe(t, "enamed"), 3);
  assert.equal(pesoDe(t, "sesdf"), 3);
});

test("as sete áreas do ENAMED existem no catálogo", () => {
  const areas = new Set(SEMENTE.map(([a]) => a));
  for (const a of ["Medicina de Família e Comunidade", "Saúde Mental"]) {
    assert.ok(areas.has(a), `falta a área ${a}`);
  }
  assert.equal(areas.size, 7);
});

test("todo tema da semente tem os dois pesos entre 1 e 3", () => {
  for (const [area, nome, e, s] of SEMENTE) {
    assert.ok([1, 2, 3].includes(e), `peso ENAMED inválido em ${nome}`);
    assert.ok([1, 2, 3].includes(s), `peso SES-DF inválido em ${nome}`);
    assert.ok(ID_VALIDO.test(idTema(area, nome)), `id inválido: ${nome}`);
  }
  assert.equal(new Set(SEMENTE.map(([a, n]) => idTema(a, n))).size, SEMENTE.length);
});

/* ---------- provas múltiplas ---------- */

test("a prova alvo é a próxima ainda não realizada", () => {
  const provas = [ENAMED, SESDF];
  assert.equal(provaAlvo(provas, "2027-01-01").prova, "enamed");
  assert.equal(provaAlvo(provas, "2028-09-13").prova, "enamed", "no dia ainda vale");
  assert.equal(provaAlvo(provas, "2028-09-14").prova, "sesdf", "passou o ENAMED, vira SES-DF");
  assert.equal(provaAlvo(provas, "2029-02-01"), null);
});

test("prova sem data não vira alvo", () => {
  assert.equal(provaAlvo([{ prova: "x", nome: "X", data: "" }], "2027-01-01"), null);
});

test("prova- remove só a prova indicada", () => {
  const d = derivar([
    evProva(ENAMED, "2026-01-01T00:00:00.000Z"),
    evProva(SESDF, "2026-01-01T00:00:01.000Z"),
    { id: "r", tipo: "prova-", ts: "2026-02-01T00:00:00.000Z", dados: { prova: "sesdf" } },
  ]);
  assert.deepEqual(d.provas.map((p) => p.prova), ["enamed"]);
});

test("o peso usado muda com o perfil da prova alvo", () => {
  // MFC pesa 3 no ENAMED e 1 na SES-DF; o inverso vale para hemorragia digestiva.
  const mfc = idTema("Medicina de Família e Comunidade", "Método clínico centrado na pessoa");
  const d = derivar([]);
  const t = d.temas.find((x) => x.id === mfc);
  assert.ok(prioridade(t, "2027-01-01", ENAMED) > prioridade(t, "2027-01-01", SESDF));
});

test("depois do ENAMED as revisões passam a mirar a SES-DF", () => {
  // Estudo 40 dias antes da SES-DF: o intervalo tem de encurtar por causa dela.
  const evs = [
    evProva(ENAMED, "2026-01-01T00:00:00.000Z"),
    evProva(SESDF, "2026-01-01T00:00:01.000Z"),
    estudo(ALVO, "2028-12-02", 95),
  ];
  const t = acha(derivar(evs), ALVO);
  assert.ok(t.proxima <= SESDF.data, `revisão em ${t.proxima} cairia depois da SES-DF`);
});

/* ---------- fases ---------- */

test("cada janela produz a fase certa", () => {
  assert.equal(fase(400), "cobertura");
  assert.equal(fase(366), "cobertura");
  assert.equal(fase(365), "consolidacao");
  assert.equal(fase(181), "consolidacao");
  assert.equal(fase(180), "aprofundamento");
  assert.equal(fase(61), "aprofundamento");
  assert.equal(fase(60), "reta-final");
  assert.equal(fase(0), "reta-final");
  assert.equal(fase(null), "livre");
});

/* ---------- plano do dia ---------- */

const temaFalso = (id, area, extra = {}) => ({
  id, area, nome: id, pesos: { enamed: 2, sesdf: 2 },
  etapa: 0, proxima: null, historico: [], ...extra,
});
// 2026-05-11 é uma segunda-feira.
const SEG = "2026-05-11";

test("o plano preenche os minutos do dia sem estourar", () => {
  const temas = Array.from({ length: 20 }, (_, i) => temaFalso(`a/${i}`, "Área " + (i % 4)));
  const p = planoDoDia(temas, [0, 120, 0, 0, 0, 0, 0], [], SEG);
  const soma = p.blocos.reduce((s, b) => s + b.minutos, 0);
  assert.equal(p.minutosDisponiveis, 120);
  assert.ok(soma <= 120, `plano somou ${soma} min para 120 disponíveis`);
  assert.equal(soma, 120, "com 45 min de bloco padrão, 120 fecha em 45+45+30");
});

test("dia sem horas devolve plano vazio sem quebrar", () => {
  const temas = [temaFalso("a/1", "X")];
  const p = planoDoDia(temas, [0, 0, 0, 0, 0, 0, 0], [], SEG);
  assert.equal(p.minutosDisponiveis, 0);
  assert.deepEqual(p.blocos, []);
});

test("não repete área em sequência enquanto houver alternativa", () => {
  const temas = [
    ...Array.from({ length: 5 }, (_, i) => temaFalso(`cm/${i}`, "Clínica Médica")),
    temaFalso("cir/1", "Cirurgia"),
    temaFalso("ped/1", "Pediatria"),
  ];
  const p = planoDoDia(temas, [0, 240, 0, 0, 0, 0, 0], [], SEG);
  assert.ok(p.blocos.length >= 4, "precisa de blocos suficientes para testar o rodízio");
  for (let i = 1; i < p.blocos.length; i++) {
    const [ant, at] = [p.blocos[i - 1].tema.area, p.blocos[i].tema.area];
    if (ant === at) {
      // só é aceitável se não sobrava nenhuma outra área não usada
      const usadas = new Set(p.blocos.slice(0, i).map((b) => b.tema.id));
      const outras = temas.filter((t) => !usadas.has(t.id) && t.area !== ant);
      assert.equal(outras.length, 0, `repetiu ${at} havendo ${outras.length} alternativas`);
    }
  }
});

test("o bloco usa a duração que o tema costuma consumir", () => {
  const lento = temaFalso("a/lento", "X", {
    historico: [{ d: "2026-01-01", a: 80, q: 20, c: 16, m: 90 },
                { d: "2026-02-01", a: 80, q: 20, c: 16, m: 90 }],
    proxima: "2026-01-02",
  });
  const p = planoDoDia([lento], [0, 180, 0, 0, 0, 0, 0], [], SEG);
  assert.equal(p.blocos[0].minutos, 90, "mediana do histórico, não o padrão");
  assert.equal(planoDoDia([temaFalso("a/novo", "X")], [0, 180, 0, 0, 0, 0, 0], [], SEG).blocos[0].minutos, BLOCO_PADRAO);
});

test("o que já foi estudado hoje desconta dos minutos e sai da fila", () => {
  const feito = temaFalso("a/feito", "X", { historico: [{ d: SEG, a: 90, q: 10, c: 9, m: 60 }] });
  const p = planoDoDia([feito, temaFalso("a/outro", "Y")], [0, 120, 0, 0, 0, 0, 0], [], SEG);
  assert.equal(p.minutosFeitos, 60);
  assert.equal(p.questoesHoje, 10);
  assert.ok(!p.blocos.some((b) => b.tema.id === "a/feito"), "não repete no mesmo dia");
  // Só resta um tema elegível, logo um bloco de 45 — os 15 restantes não viram bloco.
  assert.equal(p.blocos.reduce((s, b) => s + b.minutos, 0), BLOCO_PADRAO);
  assert.equal(p.sobra, 120 - 60 - BLOCO_PADRAO);
});

test("na reta final tema nunca visto sai do plano", () => {
  const visto = temaFalso("a/visto", "X", { historico: [{ d: "2028-08-01", a: 70, q: 10, c: 7, m: 45 }], proxima: "2028-08-10" });
  const novo = temaFalso("a/novo", "Y");
  const perto = { prova: "p", nome: "P", data: somaDias(SEG, 30), perfil: "enamed" };

  const reta = planoDoDia([visto, novo], [0, 240, 0, 0, 0, 0, 0], [perto], SEG);
  assert.equal(reta.fase, "reta-final");
  assert.ok(!reta.blocos.some((b) => b.tema.id === "a/novo"), "assunto novo não entra na véspera");

  const longe = { prova: "p", nome: "P", data: somaDias(SEG, 500), perfil: "enamed" };
  const cobertura = planoDoDia([visto, novo], [0, 240, 0, 0, 0, 0, 0], [longe], SEG);
  assert.equal(cobertura.fase, "cobertura");
  assert.ok(cobertura.blocos.some((b) => b.tema.id === "a/novo"), "na cobertura ele é prioridade");
});

test("cada bloco explica por que está ali", () => {
  const atrasado = temaFalso("a/atrasado", "X", { historico: [{ d: "2026-04-01", a: 50 }], proxima: "2026-05-01" });
  const p = planoDoDia([atrasado, temaFalso("a/novo", "Y")], [0, 120, 0, 0, 0, 0, 0], [], SEG);
  assert.match(p.blocos[0].motivo, /revisão atrasada/);
  assert.ok(p.blocos.every((b) => typeof b.motivo === "string" && b.motivo.length));
});

test("rotina inválida cai no padrão em vez de quebrar", () => {
  for (const r of [null, undefined, [1, 2], "nao-e-array", [1,2,3,4,5,6,"x"]]) {
    const p = planoDoDia([temaFalso("a/1", "X")], r, [], SEG);
    assert.equal(p.minutosDisponiveis, ROTINA_PADRAO[1], `rotina ${JSON.stringify(r)} deveria cair no padrão`);
  }
});

test("a rotina do log vale e é limitada a 16h por dia", () => {
  const d = derivar([{ id: "r", tipo: "rotina", ts: "2026-01-01T00:00:00.000Z", dados: { minutos: [0, 90, 90, 90, 90, 90, 9999] } }]);
  assert.equal(d.rotina[1], 90);
  assert.equal(d.rotina[6], 16 * 60, "valor absurdo é aparado, não aceito");
});

/* ---------- corrigir uma prova ---------- */

test("regravar a mesma prova corrige a data em vez de duplicar", () => {
  const d = derivar([
    { id: "p1", tipo: "prova", ts: "2026-08-01T10:00:00.000Z",
      dados: { prova: "enamed", nome: "ENAMED", data: "2028-09-20", perfil: "enamed" } },
    { id: "p2", tipo: "prova", ts: "2026-08-02T10:00:00.000Z",
      dados: { prova: "enamed", nome: "ENAMED", data: "2028-09-13", perfil: "enamed" } },
  ]);
  assert.equal(d.provas.length, 1, "é a mesma prova, não duas");
  assert.equal(d.provas[0].data, "2028-09-13", "vale a correção mais recente");
});

test("corrigir a data reprograma as revisões já registradas", () => {
  const base = estudo(ALVO, "2028-08-01", 95);
  const comData = (data) => acha(derivar([
    { id: "p", tipo: "prova", ts: "2026-08-01T10:00:00.000Z",
      dados: { prova: "x", nome: "X", data, perfil: "enamed" } },
    base,
  ]), ALVO);

  // A 10 dias da prova o intervalo encurta; a 2 anos, não.
  assert.ok(comData("2028-08-11").proxima < comData("2030-08-11").proxima);
});

test("renomear cria o id novo e o antigo precisa sair junto", () => {
  const eventos = [
    { id: "p1", tipo: "prova", ts: "2026-08-01T10:00:00.000Z",
      dados: { prova: "enare", nome: "ENARE", data: "2028-09-13", perfil: "enamed" } },
    { id: "p2", tipo: "prova", ts: "2026-08-02T10:00:00.000Z",
      dados: { prova: "enamed", nome: "ENAMED", data: "2028-09-13", perfil: "enamed" } },
  ];
  assert.equal(derivar(eventos).provas.length, 2, "sem remover, sobra a órfã com o nome velho");

  const comRemocao = [...eventos, {
    id: "p3", tipo: "prova-", ts: "2026-08-02T10:00:01.000Z", dados: { prova: "enare" },
  }];
  const d = derivar(comRemocao);
  assert.equal(d.provas.length, 1);
  assert.equal(d.provas[0].nome, "ENAMED");
});

test("a ordem entre remover a antiga e gravar a nova não importa", () => {
  const gravar = { id: "p2", tipo: "prova", ts: "2026-08-02T10:00:00.000Z",
    dados: { prova: "enamed", nome: "ENAMED", data: "2028-09-13", perfil: "enamed" } };
  const remover = { id: "p3", tipo: "prova-", ts: "2026-08-02T10:00:01.000Z", dados: { prova: "enare" } };
  const antiga = { id: "p1", tipo: "prova", ts: "2026-08-01T10:00:00.000Z",
    dados: { prova: "enare", nome: "ENARE", data: "2028-09-13", perfil: "enamed" } };

  const a = derivar([antiga, gravar, remover]).provas.map((p) => p.prova);
  const b = derivar([antiga, remover, gravar]).provas.map((p) => p.prova);
  assert.deepEqual(a, ["enamed"]);
  assert.deepEqual(b, ["enamed"]);
});
