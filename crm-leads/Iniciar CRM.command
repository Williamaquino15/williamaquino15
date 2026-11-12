#!/bin/bash
# Clique duas vezes neste arquivo para ligar o CRM no Mac.
cd "$(dirname "$0")" || exit 1
clear
echo "=============================="
echo "   CRM de Leads — iniciando"
echo "=============================="
echo

# 1) Node.js instalado?
if ! command -v node >/dev/null 2>&1; then
  echo "❌ O Node.js não está instalado."
  echo "   Baixe a versão LTS em https://nodejs.org, instale e clique neste arquivo de novo."
  open "https://nodejs.org"
  read -r -p "Aperte Enter para fechar."
  exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 13 ]; }; then
  echo "❌ Seu Node.js é antigo ($(node -v)). Instale a versão LTS em https://nodejs.org e tente de novo."
  open "https://nodejs.org"
  read -r -p "Aperte Enter para fechar."
  exit 1
fi

# 2) Instala as dependências na primeira vez
if [ ! -d node_modules ]; then
  echo "📦 Instalando (só na primeira vez, leva 1 a 2 minutos)..."
  npm install --no-fund --no-audit || { read -r -p "Deu erro na instalação. Aperte Enter para fechar."; exit 1; }
fi

# 3) Cria o arquivo de configuração na primeira vez
if [ ! -f .env ]; then
  cp .env.example .env
  echo
  echo "📝 Abri o arquivo de configuração (.env) no TextEdit."
  echo "   Cole sua chave da Anthropic depois de ANTHROPIC_API_KEY= e, se tiver,"
  echo "   a do Google depois de GOOGLE_PLACES_API_KEY=. Salve (Cmd+S) e feche o TextEdit."
  open -e .env
  read -r -p "Quando terminar, aperte Enter aqui para ligar o CRM."
fi

PORT=$(grep -E '^PORT=' .env | cut -d= -f2); PORT=${PORT:-3000}
SENHA=$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2)

echo
echo "✅ Ligando o CRM em http://localhost:$PORT"
[ -n "$SENHA" ] && echo "   Login: qualquer usuário — senha: $SENHA"
echo
echo "   Deixe ESTA JANELA ABERTA enquanto usar o CRM (o Mac não vai dormir)."
echo "   Para desligar: feche esta janela ou aperte Ctrl+C."
echo
(sleep 3 && open "http://localhost:$PORT") &
# caffeinate impede o Mac de dormir enquanto o CRM estiver ligado (o robô continua trabalhando)
caffeinate -i npm start
