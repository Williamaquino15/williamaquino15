import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getSettings, getMessages } from "./db.js";

// Qual IA usar: OpenAI (padrão quando OPENAI_API_KEY existe) ou Claude/Anthropic.
export const PROVIDER =
  process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");
const MODEL = process.env.AI_MODEL || (PROVIDER === "openai" ? "gpt-5.4-mini" : "claude-opus-5-5");
// "low" deixa as respostas rápidas e baratas — ideal para chat. Suba para "medium" se quiser mais capricho.
const EFFORT = process.env.AI_EFFORT || "low";

export function aiConfigured() {
  return PROVIDER === "openai"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
export const aiLabel = () => `${PROVIDER === "openai" ? "OpenAI" : "Claude"} (${MODEL})`;

let openai = null;
let anthropic = null;

/** Chama a IA com instruções fixas + mensagem do caso, e devolve o JSON já validado pelo schema. */
async function askStructured({ system, user, schema, name }) {
  if (PROVIDER === "openai") {
    openai ??= new OpenAI();
    const response = await openai.responses.parse({
      model: MODEL,
      instructions: system, // texto fixo primeiro: a OpenAI reaproveita em cache e cobra menos
      input: user,
      reasoning: { effort: EFFORT },
      text: { format: zodTextFormat(schema, name) },
    });
    if (!response.output_parsed) {
      const refusal = response.output?.flatMap((o) => o.content || []).find((c) => c.type === "refusal");
      throw new Error(refusal ? "A IA recusou responder esta conversa." : `Resposta da IA não pôde ser lida (status=${response.status}).`);
    }
    return response.output_parsed;
  }

  anthropic ??= new Anthropic();
  const response = await anthropic.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // se o modelo recusar algo por segurança, o servidor tenta outro modelo automaticamente
    output_config: { effort: EFFORT, format: betaZodOutputFormat(schema) },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new Error("A IA recusou responder esta conversa.");
  if (!response.parsed_output) throw new Error(`Resposta da IA não pôde ser lida (stop_reason=${response.stop_reason}).`);
  return response.parsed_output;
}

// O que a IA devolve a cada rodada: a mensagem para o lead + atualização do CRM.
export const AiDecision = z.object({
  reply: z
    .string()
    .describe("Mensagem para enviar ao lead no WhatsApp. String vazia se não for o caso de responder. Quando handoff=true, normalmente vazia (ver regras de passagem para humano)."),
  stage: z
    .enum(["contatado", "em_conversa", "qualificado", "reuniao", "perdido"])
    .describe("Etapa do funil após esta mensagem."),
  score: z.number().int().describe("Nota de 0 a 100 de quão quente/qualificado o lead está."),
  summary: z.string().describe("Resumo curto (1-3 frases) de quem é o lead e o que ele precisa."),
  name: z.string().nullable().describe("Nome do lead, se descoberto."),
  company: z.string().nullable().describe("Nome da empresa, se descoberto."),
  niche: z.string().nullable().describe("Nicho/segmento do negócio, se descoberto."),
  budget: z.string().nullable().describe("Investimento mensal em anúncios citado, se descoberto."),
  handoff: z
    .boolean()
    .describe("true se um humano da equipe precisa assumir a conversa agora. É interno: o lead nunca fica sabendo."),
  handoff_reason: z.string().nullable().describe("Motivo do handoff, se houver."),
});

function systemPrompt(s) {
  return `Você é ${s.agent_name}, pré-vendedor(a) da ${s.agency_name}, conversando com leads pelo WhatsApp.

# O que a agência vende
${s.offer}

# Cliente ideal
${s.ideal_client}

# Seu objetivo
${s.goal}
${s.meeting_link ? `Link para agendamento: ${s.meeting_link}` : "Para agendar, colete o melhor dia e horário do lead e diga que o especialista vai confirmar."}

# Perguntas de qualificação (faça uma de cada vez, de forma natural)
${s.qualification}

# Tom de voz
${s.tone}

${s.sales_script?.trim() ? `# Script da agência (SIGA COM PRIORIDADE)
O dono da agência escreveu o roteiro abaixo. Siga as etapas, argumentos, respostas a objeções e o jeito de falar dele, adaptando com naturalidade a cada lead. Se o script conflitar com as regras gerais abaixo sobre estilo, perguntas ou objetivo, o script vence. As regras sobre honestidade, pedidos para parar e passagem silenciosa para humano continuam valendo.

<script>
${s.sales_script.trim()}
</script>

` : ""}# Regras
- Escreva como um humano no WhatsApp: 1 a 3 frases curtas por mensagem, sem listas, sem markdown.
- Faça no máximo UMA pergunta por mensagem.
- Use o nome do lead quando souber.
- Responda dúvidas com honestidade; se não souber algo específico (preço exato, contrato, casos), diga que o especialista explica na reunião.
- Se o lead pedir para não receber mensagens, agradeça, encerre educadamente, marque stage "perdido" e não insista.
- Se o lead perguntar sinceramente se está falando com um robô/IA, não minta: diga com naturalidade que é a assistente virtual da agência e que a equipe acompanha a conversa. Fora isso, não fale sobre ser IA.

# Passagem para humano (silenciosa)
- Marque handoff=true quando achar que a equipe deve assumir: o lead pede para falar com alguém específico, está irritado, faz reclamação, fala de contrato/pagamento já existente, a reunião foi confirmada com dia e horário, ou o script da agência mandar passar.
- A passagem é INTERNA. Nunca diga ao lead que vai transferir, chamar alguém, passar para um colega ou um especialista "assumir". Ele não deve perceber a troca: a equipe continua a conversa com o mesmo nome (${s.agent_name}).
- Quando marcar handoff=true, deixe "reply" vazio. Exceção: se a última mensagem do lead pedir uma resposta imediata simples (ex.: ele confirmou a reunião), responda curto e natural ("Combinado! Até quinta 😊"), sem mencionar transferência.
- Se o lead claramente não tem perfil (ex.: não tem negócio, só quer emprego), seja gentil, encerre e marque "perdido".
- Se for uma mensagem de follow-up, retome o assunto de forma leve e diferente das mensagens anteriores, sem ser insistente.
${s.extra_rules ? `- ${s.extra_rules}` : ""}

# Prospecção ativa (leads com origem "prospeccao")
Esses leads NÃO pediram contato: são empresas que encontramos no Google Maps. Você está fazendo uma abordagem fria a uma empresa (B2B).
Ângulo da abordagem: ${s.prospect_angle}
- Na primeira mensagem: cumprimente, diga quem você é e de qual agência, cite o nome da empresa (e o bairro, se souber) para mostrar que não é disparo em massa, e faça UMA pergunta leve e fácil de responder (ex.: se quem cuida do marketing/agenda é o próprio dono). Nada de link, preço ou texto longo. Máximo 3 frases curtas.
- Diga de forma natural que, se não fizer sentido, é só avisar que você não manda mais mensagens.
- Quem responde pode ser a recepcionista/secretária: seja cordial e peça o WhatsApp direto ou o melhor horário para falar com o(a) responsável/dono(a). Se te passarem outro número, registre no resumo e marque handoff=true para a equipe abordar esse número.
- A mensagem pode ter ido para o telefone cadastrado da empresa, que às vezes é do próprio dono: não presuma quem está do outro lado; pergunte com naturalidade.
- Se pedirem para parar, se disserem que não têm interesse ou que já têm agência: agradeça, encerre e marque "perdido". Nunca insista depois de um "não".
- Se souber o nome do(a) sócio(a), peça para falar com ele(a) pelo nome (use "Dr./Dra." + primeiro nome quando for clínica de saúde). Não diga de onde tirou o nome.
- Avaliação e número de avaliações no Google podem ser usados com tato como gancho ("vi que vocês têm ótimas avaliações"), nunca para criticar.

# Etapas
contatado = já enviamos mensagem mas o lead ainda não respondeu de verdade; em_conversa = lead respondendo; qualificado = tem perfil e interesse; reuniao = reunião aceita/agendada; perdido = sem perfil ou sem interesse.`;
}

function transcript(lead, messages) {
  const label = { lead: "LEAD", ai: "VOCÊ", human: "EQUIPE (humano)", system: "SISTEMA" };
  const lines = messages.map((m) => `[${m.created_at}] ${label[m.author]}: ${m.body}`);
  return lines.length ? lines.join("\n") : "(nenhuma mensagem ainda)";
}

function leadCard(lead) {
  return [
    `Nome: ${lead.name || "?"}`,
    `Telefone: ${lead.phone}`,
    `E-mail: ${lead.email || "?"}`,
    `Empresa: ${lead.company || "?"}`,
    `Nicho: ${lead.niche || "?"}`,
    `Investimento: ${lead.budget || "?"}`,
    `Origem: ${lead.source || "?"}${lead.source === "prospeccao" ? " (abordagem fria, encontrada no Google Maps)" : ""}`,
    `Endereço: ${lead.address || "?"}`,
    `Site: ${lead.website || "?"}`,
    `Sócios (dados públicos do CNPJ): ${lead.owners || "?"}`,
    `Instagram da empresa: ${lead.instagram ? "@" + lead.instagram : "?"}`,
    `Avaliação no Google: ${lead.rating ? `${lead.rating} (${lead.reviews || 0} avaliações)` : "?"}`,
    `Etapa atual: ${lead.stage}`,
    `Observações da equipe: ${lead.notes || "-"}`,
  ].join("\n");
}

const TASKS = {
  first: "Este lead acabou de chegar no CRM. Escreva a PRIMEIRA mensagem: apresente-se, cite de onde ele veio (origem) se fizer sentido e faça uma pergunta aberta para iniciar a conversa.",
  reply: "O lead mandou mensagem. Responda a(s) última(s) mensagem(ns) dele e avance a qualificação rumo ao objetivo.",
  prospect: "Esta empresa foi encontrada no Google Maps e nunca falou conosco. Escreva a PRIMEIRA mensagem de prospecção seguindo as regras de prospecção ativa.",
  followup: "O lead não respondeu à nossa última mensagem. Escreva um follow-up curto e leve.",
};

/**
 * Pede para a IA decidir a próxima mensagem para o lead.
 * @param {object} lead
 * @param {"first"|"prospect"|"reply"|"followup"} kind
 */
export async function decideNextMessage(lead, kind) {
  const settings = getSettings();
  const messages = getMessages(lead.id);

  const userContent = `# Dados do lead
${leadCard(lead)}

# Conversa até agora (horário UTC)
${transcript(lead, messages)}

# Tarefa
${TASKS[kind]}`;

  const d = await askStructured({ system: systemPrompt(settings), user: userContent, schema: AiDecision, name: "decisao_crm" });
  d.score = Math.max(0, Math.min(100, d.score));
  return d;
}

export function describeAiError(err) {
  const who = PROVIDER === "openai" ? "OpenAI" : "Anthropic";
  for (const SDK of [OpenAI, Anthropic]) {
    if (err instanceof SDK.AuthenticationError) return `Chave da API da ${who} inválida.`;
    if (err instanceof SDK.RateLimitError) return `Limite de uso ou créditos da ${who} esgotados; confira o saldo e tente de novo.`;
    if (err instanceof SDK.NotFoundError) return `Modelo "${MODEL}" não encontrado na sua conta da ${who}. Ajuste AI_MODEL no .env.`;
    if (err instanceof SDK.BadRequestError) return `Requisição inválida: ${err.message}`;
    if (err instanceof SDK.APIError) return `Erro da API (${err.status}): ${err.message}`;
  }
  return err?.message || String(err);
}

const IgDraft = z.object({ message: z.string().describe("Texto do direct, pronto para colar.") });

/** Escreve um direct de Instagram para o perfil da empresa (o envio é feito por você, manualmente). */
export async function writeInstagramDm(lead) {
  const settings = getSettings();
  const r = await askStructured({
    system: systemPrompt(settings),
    user: `# Dados do lead\n${leadCard(lead)}\n\n# Conversa no WhatsApp até agora\n${transcript(lead, getMessages(lead.id))}\n\n# Tarefa\nEscreva um direct curto (até 3 frases) para o Instagram DA EMPRESA, no mesmo tom das regras de prospecção. Se já houver conversa no WhatsApp, mencione de leve que mandou mensagem por lá também.`,
    schema: IgDraft,
    name: "direct_instagram",
  });
  return r.message.trim();
}
