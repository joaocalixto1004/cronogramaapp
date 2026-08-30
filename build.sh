#!/bin/sh
# Monta publico/ com o que — e só o que — deve ir para a internet.
#
# Duas razões de existir:
#
# 1. A raiz do repositório não é publicável. Servindo a raiz, schema.sql,
#    wrangler.toml, package.json e testes/ ficariam acessíveis.
# 2. O nome do cache do service worker era uma constante escrita à mão
#    ("ritmo-v1"), ninguém lembrava de trocá-la, e o app instalado nunca
#    recebia atualização. Aqui a versão vem do commit, sozinha.
set -eu

VERSAO="${WORKERS_CI_COMMIT_SHA:-${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo dev)}}"
VERSAO=$(printf '%s' "$VERSAO" | cut -c1-8)

rm -rf publico
mkdir -p publico

cp index.html ia.html estilo.css app.js sync.js ia-chat.js logica.js manifest.webmanifest icone.svg _headers publico/
cp -R fontes publico/fontes

# Único arquivo que não é copiado literalmente: o SW recebe o carimbo.
sed "s/__VERSAO__/$VERSAO/g" sw.js > publico/sw.js

if grep -q "__VERSAO__" publico/sw.js; then
  echo "erro: a versão não foi carimbada no sw.js" >&2
  exit 1
fi

echo "publico/ montado na versão $VERSAO ($(find publico -type f | wc -l) arquivos)"
