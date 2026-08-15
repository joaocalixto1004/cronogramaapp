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
  intervaloAjustado, metaDiaria, filaDeHoje, PADRAO_DIARIO,
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
  assert.deepEqual(derivar(evs).prova, { nome: "ENARE", data: "2026-11-01" });
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
  assert.deepEqual(t.historico, [{ d: "2026-01-01", a: 90 }, { d: "2026-01-08", a: 85 }]);
  assert.deepEqual(d.prova, { nome: "USP", data: "2026-11-15" });
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

/* ---------- carga do dia ---------- */

const temaFalso = (id, { historico = [], proxima = null } = {}) =>
  ({ id, area: "A", nome: id, peso: 2, etapa: 0, proxima, historico });

test("sem prova, a meta é o passo padrão", () => {
  const hj = "2026-05-10";
  const temas = [
    temaFalso("a/1", { historico: [{ d: "2026-05-01", a: 90 }], proxima: "2026-05-05" }),  // atrasado
    temaFalso("a/2", { historico: [{ d: "2026-05-03", a: 90 }], proxima: hj }),            // vence hoje
    temaFalso("a/3"),                                                                       // nunca visto
  ];
  assert.equal(metaDiaria(temas, "", hj), PADRAO_DIARIO);
});

test("sem prova, um backlog maior que o passo padrão manda na meta", () => {
  const hj = "2026-05-10";
  const temas = Array.from({ length: 9 }, (_, i) =>
    temaFalso(`a/${i}`, { historico: [{ d: "2026-04-01", a: 90 }], proxima: "2026-05-01" }));
  assert.equal(metaDiaria(temas, "", hj), 9);
});

test("instalação nova sem prova ainda sugere o que estudar", () => {
  const hj = "2026-05-10";
  const temas = Array.from({ length: 75 }, (_, i) => temaFalso(`a/${i}`));
  const f = filaDeHoje(temas, "", hj);
  assert.equal(f.itens.length, PADRAO_DIARIO, "a fila não pode abrir vazia");
});

test("com prova, a meta inclui a fatia diária dos temas nunca vistos", () => {
  const hj = "2026-05-10";
  const temas = Array.from({ length: 20 }, (_, i) => temaFalso(`a/${i}`));
  // 20 temas para 10 dias = 2 por dia.
  assert.equal(metaDiaria(temas, somaDias(hj, 10), hj), 2);
  // O mesmo backlog em 5 dias exige o dobro por dia.
  assert.equal(metaDiaria(temas, somaDias(hj, 5), hj), 4);
});

test("a fila encolhe conforme o dia é cumprido", () => {
  const hj = "2026-05-10";
  const temas = Array.from({ length: 20 }, (_, i) => temaFalso(`a/${i}`));
  const antes = filaDeHoje(temas, somaDias(hj, 10), hj);
  assert.equal(antes.meta, 2);
  assert.equal(antes.itens.length, 2);
  assert.equal(antes.feitos, 0);

  temas[0].historico.push({ d: hj, a: 90 });
  const depois = filaDeHoje(temas, somaDias(hj, 10), hj);
  assert.equal(depois.feitos, 1);
  assert.equal(depois.itens.length, 1, "sobra um para fechar a meta do dia");

  temas[1].historico.push({ d: hj, a: 90 });
  assert.equal(filaDeHoje(temas, somaDias(hj, 10), hj).itens.length, 0, "meta cumprida, fila vazia");
});

test("a fila não esconde o tamanho do buraco", () => {
  const hj = "2026-05-10";
  // Doze revisões atrasadas: a fila fixa de cinco mostrava só cinco.
  const temas = Array.from({ length: 12 }, (_, i) =>
    temaFalso(`a/${i}`, { historico: [{ d: "2026-04-01", a: 90 }], proxima: "2026-05-01" }));
  const f = filaDeHoje(temas, "", hj);
  assert.equal(f.meta, 12);
  assert.equal(f.itens.length, 12);
});

test("temas atrasados vêm antes dos nunca vistos", () => {
  const hj = "2026-05-10";
  const temas = [
    temaFalso("a/novo"),
    temaFalso("a/atrasado", { historico: [{ d: "2026-04-01", a: 50 }], proxima: "2026-04-20" }),
  ];
  const f = filaDeHoje(temas, "", hj);
  assert.equal(f.itens[0].id, "a/atrasado");
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
  assert.deepEqual(t.historico[0], { d: "2026-01-01", a: 90 });
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
