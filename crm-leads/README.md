# CRM de Leads com IA para agência de tráfego

CRM para captar e **prospectar** leads e deixar uma IA (OpenAI) **puxar conversa, responder e qualificar** cada lead pelo WhatsApp, até agendar a reunião. Quando precisa de você, ela avisa e pausa.

## Prospecção automática (novo)

1. **Conecte o seu WhatsApp** pelo botão **WhatsApp** → **Gerar QR Code** → no celular: *Dispositivos conectados → Conectar dispositivo*.
2. Em **Prospecção**, escolha o tipo de empresa (ex.: "clínica odontológica"), a cidade (ex.: "Recife") e, se quiser mais resultados, uma lista de bairros. O CRM busca no Google Maps e coloca cada empresa na coluna **Novo**.
3. Ligue o **Robô**. Em dias úteis, no horário que você definir, ele pega uma empresa por vez e:
   - abre o site da empresa e procura **CNPJ** e **Instagram**;
   - consulta o CNPJ na base pública da Receita (BrasilAPI) e traz **sócios** e **telefone cadastrado**;
   - tenta primeiro o **telefone do CNPJ** (costuma ser do dono) e depois o da clínica; quem não tem WhatsApp vai para **Perdido**;
   - a IA escreve uma primeira mensagem personalizada (nome da clínica, bairro, nome do sócio) e envia;
   - as respostas são tratadas pela IA, e os follow-ups saem sozinhos.
4. **Instagram**: no painel do lead, **Gerar direct do Instagram** cria uma mensagem para o perfil da clínica. Você clica em *Abrir*, cola, envia e marca como enviado — fica registrado na conversa.

**Travas de segurança do robô** (para não queimar seu número): limite diário de empresas novas (padrão 25), intervalo aleatório entre envios (4 a 12 min), só seg–sex em horário comercial (horário de Recife), "digitando…" antes de cada mensagem, para sozinho após 3 falhas seguidas ou se o WhatsApp limitar contatos novos, e nunca insiste depois de um "não".

> ⚠️ O WhatsApp por QR Code usa uma biblioteca não oficial (Baileys). Mandar mensagens para quem não tem seu número salvo pode levar a bloqueio. Use um número exclusivo para prospecção, comece com poucos envios por dia (10–20) e aumente aos poucos. Respeite pedidos para não receber mensagens (LGPD).

## O que ele faz

- **Captação**: endpoint `/api/capture` que recebe leads de landing page, Zapier/Make, Meta Lead Ads etc.
- **Primeiro contato automático**: assim que o lead chega, a IA manda a primeira mensagem.
- **Respostas automáticas**: o lead responde no WhatsApp e a IA responde (espera ~8s para juntar mensagens picadas).
- **Qualificação**: a cada mensagem a IA atualiza etapa do funil, score (0–100), resumo, nicho, empresa e investimento.
- **Follow-up**: se o lead some, a IA manda até 2 follow-ups (configurável).
- **Passa para humano**: quando o lead pede um atendente, se irrita ou confirma a reunião, a IA pausa e marca "⚠ precisa de você".
- **Painel Kanban**: arraste leads entre etapas, veja a conversa em tempo real, mande mensagem como humano, pause/ative a IA por lead.
- **Modo simulador**: sem WhatsApp configurado, dá para testar tudo pelo painel ("Simular mensagem do lead").

Etapas: Novo → Contatado → Em conversa → Qualificado → Reunião → Cliente / Perdido.

## Rodando

Requer **Node.js 22.13+** (usa o SQLite embutido do Node, sem banco externo).

```bash
cd crm-leads
npm install
cp .env.example .env   # preencha OPENAI_API_KEY e ADMIN_PASSWORD
npm start
```

Abra http://localhost:3000, clique em **Configurar IA** e descreva sua agência, oferta, perguntas de qualificação e link de agendamento. Depois crie um lead e use o simulador para conversar com a IA.

## Captar leads do seu site

Formulário HTML simples:

```html
<form action="https://SEU-DOMINIO/api/capture?token=SEU_CAPTURE_TOKEN" method="post">
  <input name="nome" placeholder="Seu nome" required />
  <input name="telefone" placeholder="WhatsApp com DDD" required />
  <input name="nicho" placeholder="Seu segmento" />
  <input type="hidden" name="origem" value="landing-page" />
  <input type="hidden" name="redirect" value="https://SEU-SITE/obrigado" />
  <button>Quero mais clientes</button>
</form>
```

Ou via JSON (Zapier, Make, n8n, Meta Lead Ads):

```bash
curl -X POST "https://SEU-DOMINIO/api/capture?token=SEU_CAPTURE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"João","phone":"11999999999","source":"meta-ads","niche":"odontologia"}'
```

Campos aceitos: `name|nome`, `phone|telefone|whatsapp`, `email`, `company|empresa`, `niche|nicho`, `budget|investimento`, `source|origem|utm_source`, `message|mensagem`.

## Chave do Google Maps (para a prospecção)

1. Acesse console.cloud.google.com, crie um projeto e ative o faturamento (o Google dá crédito mensal gratuito).
2. Em *APIs e serviços → Biblioteca*, ative **Places API (New)**.
3. Em *Credenciais → Criar credenciais → Chave de API*, copie a chave e coloque em `GOOGLE_PLACES_API_KEY`.

## Alternativa: API oficial do WhatsApp (Meta)

1. Crie um app em developers.facebook.com, adicione o produto **WhatsApp** e um número.
2. Preencha no `.env`: `WHATSAPP_TOKEN` (token permanente de usuário do sistema), `WHATSAPP_PHONE_NUMBER_ID` e um `WHATSAPP_VERIFY_TOKEN` qualquer.
3. Em *Webhooks*, use a URL `https://SEU-DOMINIO/webhook/whatsapp` com o mesmo verify token e assine o campo `messages`.
4. **Importante:** o WhatsApp só deixa mandar texto livre para quem te escreveu nas últimas 24h. Para o **primeiro contato** com um lead captado, crie e aprove um **template** (ex.: "Oi {{1}}, aqui é a Ana da Agência X. Vi seu cadastro, posso te fazer 2 perguntas rápidas?") e coloque o nome em `WHATSAPP_TEMPLATE_NAME`. Quando o lead responder, a IA assume a conversa.

O servidor precisa estar num endereço público com HTTPS (Railway, Render, VPS…). Para testar local, use um túnel como `ngrok http 3000`.

## Script de prospecção

Em **Configurar IA → Script de prospecção e atendimento**, cole o seu roteiro: primeira mensagem, argumentos, respostas a objeções e quando passar para você. A IA segue o script com prioridade em todas as conversas (prospecção e leads que chegam).

**Passagem para humano é silenciosa:** quando a IA decide que você deve assumir, ela para de responder e mostra "⚠ precisa de você" no painel. O lead não recebe aviso de transferência; você continua a conversa com o mesmo nome da atendente. (Se o lead perguntar sinceramente se fala com um robô, a IA não mente: diz que é a assistente virtual da agência.)

## Sobre a IA

- Usa a API da OpenAI (`openai`, Responses API) com saída estruturada: a cada rodada a IA devolve a mensagem **e** os dados do CRM num JSON validado.
- Modelo padrão `gpt-5.4-mini` com esforço `low` (rápido e barato para chat). Para mais qualidade, use `AI_MODEL=gpt-5.5` no `.env`.
- A chave é criada em platform.openai.com/api-keys e cobrada por uso (créditos em *Billing*), separada da assinatura do ChatGPT.
- Também funciona com o Claude (Anthropic): `AI_PROVIDER=anthropic` e `ANTHROPIC_API_KEY` no `.env`.
- O prompt é montado a partir das suas configurações (botão **Configurar IA**) — edite lá, sem mexer em código. O campo *Observações* de cada lead também é lido pela IA.
- A IA nunca move um lead para "Cliente": isso é com você.

## Estrutura

```
src/server.js    rotas HTTP, webhook, captação, painel
src/engine.js    orquestra: primeiro contato, respostas, follow-ups, handoff
src/ai.js        prompt e chamada à IA (OpenAI ou Claude)
src/whatsapp.js  WhatsApp por QR Code (Baileys) ou API oficial
src/prospect.js  busca de empresas no Google Maps (Places API)
src/enrich.js    site da empresa → CNPJ/Instagram → sócios e telefone (BrasilAPI)
src/db.js        SQLite (leads, mensagens, configurações)
public/          painel (HTML/CSS/JS puro)
```

## Próximos passos sugeridos

- Integração direta com Meta Lead Ads (webhook `leadgen`) e Google Calendar para agendar sozinho.
- Múltiplos usuários/vendedores e distribuição de leads.
- Relatórios de conversão por origem/campanha.
