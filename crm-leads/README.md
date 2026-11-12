# CRM de Leads com IA para agência de tráfego

CRM simples para captar leads e deixar uma IA (Claude, da Anthropic) **puxar conversa, responder e qualificar** cada lead pelo WhatsApp, até agendar a reunião. Quando precisa de você, ela avisa e pausa.

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
cp .env.example .env   # preencha ANTHROPIC_API_KEY e ADMIN_PASSWORD
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

## Conectar o WhatsApp (API oficial da Meta)

1. Crie um app em developers.facebook.com, adicione o produto **WhatsApp** e um número.
2. Preencha no `.env`: `WHATSAPP_TOKEN` (token permanente de usuário do sistema), `WHATSAPP_PHONE_NUMBER_ID` e um `WHATSAPP_VERIFY_TOKEN` qualquer.
3. Em *Webhooks*, use a URL `https://SEU-DOMINIO/webhook/whatsapp` com o mesmo verify token e assine o campo `messages`.
4. **Importante:** o WhatsApp só deixa mandar texto livre para quem te escreveu nas últimas 24h. Para o **primeiro contato** com um lead captado, crie e aprove um **template** (ex.: "Oi {{1}}, aqui é a Ana da Agência X. Vi seu cadastro, posso te fazer 2 perguntas rápidas?") e coloque o nome em `WHATSAPP_TEMPLATE_NAME`. Quando o lead responder, a IA assume a conversa.

O servidor precisa estar num endereço público com HTTPS (Railway, Render, VPS…). Para testar local, use um túnel como `ngrok http 3000`.

## Sobre a IA

- Usa a API da Anthropic (`@anthropic-ai/sdk`) com saída estruturada: a cada rodada a IA devolve a mensagem **e** os dados do CRM num JSON validado.
- Modelo padrão `claude-opus-5-5` com esforço `low` (rápido e barato para chat). Ajuste com `AI_MODEL` e `AI_EFFORT` no `.env`.
- O prompt é montado a partir das suas configurações (botão **Configurar IA**) — edite lá, sem mexer em código. O campo *Observações* de cada lead também é lido pela IA.
- A IA nunca move um lead para "Cliente": isso é com você.

## Estrutura

```
src/server.js    rotas HTTP, webhook, captação, painel
src/engine.js    orquestra: primeiro contato, respostas, follow-ups, handoff
src/ai.js        prompt e chamada ao Claude
src/whatsapp.js  envio/recebimento pela WhatsApp Cloud API
src/db.js        SQLite (leads, mensagens, configurações)
public/          painel (HTML/CSS/JS puro)
```

## Próximos passos sugeridos

- Integração direta com Meta Lead Ads (webhook `leadgen`) e Google Calendar para agendar sozinho.
- Múltiplos usuários/vendedores e distribuição de leads.
- Relatórios de conversão por origem/campanha.
