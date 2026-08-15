/* Log de eventos: leitura por cursor, escrita idempotente.
 *
 * O cliente é offline-first, então ele reenvia o que não teve confirmação.
 * O INSERT OR IGNORE sobre a coluna `id` (UNIQUE) é o que torna isso seguro:
 * regravar um evento já conhecido não faz nada.
 */

const LOTE_MAX = 500;   // eventos por POST
const PAGINA = 2000;    // eventos por GET

const json = (corpo, status = 200) =>
  Response.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
const erro = (status, msg) => json({ erro: msg }, status);

/* ---------- validação ---------- */
// A entrada vem do navegador e vira uma linha no banco: nada aqui pode ser
// confiado. Um evento que não bate com o schema é rejeitado, não corrigido.

const texto = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const dataISO = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const idTema = (v) => texto(v, 160) && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(v);
const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

const SCHEMAS = {
  estudo: (d) => idTema(d.tema) && dataISO(d.data) && inteiro(d.acertos, 0, 100),
  "estudo-": (d) => texto(d.evento, 100),
  "tema+": (d) => idTema(d.tema) && texto(d.nome, 120) && texto(d.area, 80) && inteiro(d.peso, 1, 3),
  "tema-": (d) => idTema(d.tema),
  prova: (d) => typeof d.nome === "string" && d.nome.length <= 80 && (d.data === "" || dataISO(d.data)),
};

function limpar(ev) {
  if (!ev || typeof ev !== "object") return null;
  if (!texto(ev.id, 100)) return null;
  if (!texto(ev.ts, 40) || isNaN(Date.parse(ev.ts))) return null;

  const schema = SCHEMAS[ev.tipo];
  if (!schema) return null;
  if (!ev.dados || typeof ev.dados !== "object" || Array.isArray(ev.dados)) return null;
  if (!schema(ev.dados)) return null;

  // Reserializa a partir do schema: campos extras enviados pelo cliente não
  // são gravados, então o banco só contém o que este arquivo reconhece.
  const dados =
    ev.tipo === "estudo"    ? { tema: ev.dados.tema, data: ev.dados.data, acertos: ev.dados.acertos }
    : ev.tipo === "estudo-" ? { evento: ev.dados.evento }
    : ev.tipo === "tema+"   ? { tema: ev.dados.tema, nome: ev.dados.nome, area: ev.dados.area, peso: ev.dados.peso }
    : ev.tipo === "tema-"   ? { tema: ev.dados.tema }
    :                         { nome: ev.dados.nome, data: ev.dados.data };

  return { id: ev.id, tipo: ev.tipo, ts: ev.ts, dados };
}

/* ---------- leitura ---------- */
export async function lerEventos(request, env) {
  const bruto = new URL(request.url).searchParams.get("desde") ?? "0";
  const desde = Number(bruto);
  if (!Number.isInteger(desde) || desde < 0) return erro(400, "cursor inválido");

  const { results } = await env.DB.prepare(
    "SELECT seq, id, tipo, payload, ts FROM eventos WHERE seq > ? ORDER BY seq LIMIT ?",
  )
    .bind(desde, PAGINA)
    .all();

  const eventos = results.map((r) => ({
    seq: r.seq,
    id: r.id,
    tipo: r.tipo,
    ts: r.ts,
    dados: JSON.parse(r.payload),
  }));

  return json({
    eventos,
    seq: eventos.length ? eventos[eventos.length - 1].seq : desde,
    fim: eventos.length < PAGINA,
  });
}

/* ---------- escrita ---------- */
export async function gravarEventos(request, env) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erro(400, "JSON inválido");
  }

  const lista = Array.isArray(corpo?.eventos) ? corpo.eventos : null;
  if (!lista) return erro(400, "esperado {eventos:[...]}");
  if (lista.length > LOTE_MAX) return erro(413, `no máximo ${LOTE_MAX} eventos por vez`);

  const limpos = [];
  for (const ev of lista) {
    const v = limpar(ev);
    if (!v) return erro(422, `evento inválido: ${typeof ev?.id === "string" ? ev.id.slice(0, 60) : "sem id"}`);
    limpos.push(v);
  }

  if (limpos.length) {
    const inserir = env.DB.prepare(
      "INSERT OR IGNORE INTO eventos (id, tipo, payload, ts) VALUES (?, ?, ?, ?)",
    );
    await env.DB.batch(
      limpos.map((e) => inserir.bind(e.id, e.tipo, JSON.stringify(e.dados), e.ts)),
    );
  }

  const { seq } = await env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM eventos").first();
  return json({ ok: true, seq, recebidos: limpos.length });
}
