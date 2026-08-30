/* Entrada do Worker.
 *
 * Os arquivos estáticos são servidos pela própria plataforma antes de o
 * código rodar (é o comportamento padrão de [assets] no wrangler.toml), então
 * na prática este handler só é chamado para /api/* e para caminhos que não
 * existem. A guarda do Access fica aqui, uma vez, para toda a API.
 */
import { barrarAcesso } from "./servidor/acesso.js";
import { lerEventos, gravarEventos } from "./servidor/eventos.js";
import { conversarIA } from "./servidor/ia.js";

const json = (corpo, status = 200) =>
  Response.json(corpo, { status, headers: { "Cache-Control": "no-store" } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // Rede de segurança: se a plataforma encaminhar um caminho de arquivo
      // para cá, devolve o arquivo em vez de um 404 nosso.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("não encontrado", { status: 404 });
    }

    const barrado = await barrarAcesso(request, env, ctx);
    if (barrado) return barrado;

    if (url.pathname === "/api/eventos") {
      if (request.method === "GET") return lerEventos(request, env);
      if (request.method === "POST") return gravarEventos(request, env);
      return json({ erro: "método não suportado" }, 405);
    }

    if (url.pathname === "/api/ia") {
      if (request.method === "POST") return conversarIA(request, env);
      return json({ erro: "método não suportado" }, 405);
    }

    return json({ erro: "rota desconhecida" }, 404);
  },
};
