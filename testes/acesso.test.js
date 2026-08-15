/* Decisão de barrar ou deixar passar.
 *
 * Existem dois caminhos de autenticação porque a Cloudflare tem dois
 * mecanismos, e só um deles funciona em workers.dev. O que estes testes
 * garantem é que a ausência dos dois nunca deixa passar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { barrarAcesso } from "../servidor/acesso.js";

const req = (headers = {}) => new Request("https://x/api/eventos", { headers });
const ctxCom = (identidade) => ({ access: { getIdentity: async () => identidade } });
const ctxQueFalha = () => ({ access: { getIdentity: async () => { throw new Error("indisponível"); } } });

test("MODO_DEV libera — e só existe no .dev.vars", async () => {
  assert.equal(await barrarAcesso(req(), { MODO_DEV: "1" }, undefined), null);
});

test("Access no Worker: identidade entregue pela plataforma libera", async () => {
  const r = await barrarAcesso(req(), {}, ctxCom({ email: "eu@exemplo.com" }));
  assert.equal(r, null, "não deveria barrar quem a plataforma já autenticou");
});

test("sem nenhum dos dois caminhos, fecha", async () => {
  const r = await barrarAcesso(req(), {}, undefined);
  assert.equal(r.status, 500);
  assert.match((await r.json()).erro, /sem autenticação/);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});

test("ctx.access presente mas sem identidade não libera", async () => {
  const r = await barrarAcesso(req(), {}, ctxCom(null));
  assert.equal(r.status, 500, "identidade nula é o mesmo que não autenticado");
});

test("ctx.access com e-mail vazio não libera", async () => {
  const r = await barrarAcesso(req(), {}, ctxCom({ email: "" }));
  assert.equal(r.status, 500);
});

test("ctx.access quebrado cai para o JWT em vez de liberar", async () => {
  const r = await barrarAcesso(req(), {}, ctxQueFalha());
  assert.equal(r.status, 500, "falha na plataforma não pode virar passe livre");

  // Com as variáveis definidas, o mesmo erro leva à checagem do token.
  const comEnv = await barrarAcesso(req(), { ACCESS_TEAM: "t", ACCESS_AUD: "a" }, ctxQueFalha());
  assert.equal(comEnv.status, 401, "sem token, é 401");
});

test("com ACCESS_* configurado e sem token, é 401", async () => {
  const r = await barrarAcesso(req(), { ACCESS_TEAM: "t", ACCESS_AUD: "a" }, undefined);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).erro, "não autenticado");
});

test("token malformado não passa", async () => {
  const env = { ACCESS_TEAM: "t", ACCESS_AUD: "a" };
  for (const token of ["lixo", "a.b", "a.b.c", "....", ""]) {
    const r = await barrarAcesso(req({ "Cf-Access-Jwt-Assertion": token }), env, undefined);
    assert.equal(r.status, 401, `token ${JSON.stringify(token)} deveria ser recusado`);
  }
});

test("MODO_DEV com qualquer outro valor não libera", async () => {
  for (const v of ["0", "true", "sim", ""]) {
    const r = await barrarAcesso(req(), { MODO_DEV: v }, undefined);
    assert.equal(r.status, 500, `MODO_DEV=${JSON.stringify(v)} não pode liberar`);
  }
});
