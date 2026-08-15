#!/bin/sh
# Carimba a versão do deploy no service worker.
#
# A razão de existir deste script: o nome do cache do SW era uma constante
# escrita à mão ("ritmo-v1"), então ninguém lembrava de trocá-la e o app
# instalado nunca recebia atualização. Aqui a versão vem do commit, sozinha.
set -eu

VERSAO="${CF_PAGES_COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
VERSAO=$(printf '%s' "$VERSAO" | cut -c1-8)

sed -i.bak "s/__VERSAO__/$VERSAO/g" sw.js && rm -f sw.js.bak

echo "sw.js carimbado com a versão $VERSAO"
