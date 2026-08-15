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

  // Todos os 74 da semente estavam ausentes, logo viram tombstone.
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
