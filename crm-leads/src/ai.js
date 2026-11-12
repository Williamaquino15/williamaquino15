import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getSettings, getMessages } from "./db.js";

const MODEL = process.env.AI_MODEL || "claude-opus-5-5";
// "low" deixa as respostas rápidas e baratas — ideal para chat. Suba para "medium" se quiser mais capricho.
const EFFORT = process.env.AI_EFFORT || "low";

let client = null;
export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

// O que a IA devolve a cada rodada: a mensagem para o lead + atualização do CRM.
export const AiDecision = z.object({
  reply: z
    .string()
    .describe("Mensagem para enviar ao lead no WhatsApp. String vazia se não for o caso de responder."),
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
    .describe("true se um humano precisa assumir a conversa agora (ver regras)."),
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

# Regras
- Escreva como um humano no WhatsApp: 1 a 3 frases curtas por mensagem, sem listas, sem markdown.
- Faça no máximo UMA pergunta por mensagem.
- Use o nome do lead quando souber.
- Responda dúvidas com honestidade; se não souber algo específico (preço exato, contrato, casos), diga que o especialista explica na reunião.
- Se o lead pedir para não receber mensagens, agradeça, encerre educadamente, marque stage "perdido" e não insista.
- Marque handoff=true quando: o lead pedir para falar com um humano, estiver irritado, fizer reclamação, falar de contrato/pagamento já existente, ou quando a reunião for confirmada com dia e horário.
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

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // se o modelo recusar algo por segurança, o servidor tenta outro modelo automaticamente
    output_config: { effort: EFFORT, format: betaZodOutputFormat(AiDecision) },
    system: [{ type: "text", text: systemPrompt(settings), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("A IA recusou responder esta conversa.");
  }
  if (!response.parsed_output) {
    throw new Error(`Resposta da IA não pôde ser lida (stop_reason=${response.stop_reason}).`);
  }
  const d = response.parsed_output;
  d.score = Math.max(0, Math.min(100, d.score));
  return d;
}

export function describeAiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Chave da API da Anthropic inválida.";
  if (err instanceof Anthropic.RateLimitError) return "Limite de uso da API atingido; tente de novo em instantes.";
  if (err instanceof Anthropic.BadRequestError) return `Requisição inválida: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status}): ${err.message}`;
  return err?.message || String(err);
}

const IgDraft = z.object({ message: z.string().describe("Texto do direct, pronto para colar.") });

/** Escreve um direct de Instagram para o perfil da empresa (o envio é feito por você, manualmente). */
export async function writeInstagramDm(lead) {
  const settings = getSettings();
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: EFFORT, format: betaZodOutputFormat(IgDraft) },
    system: [{ type: "text", text: systemPrompt(settings), cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `# Dados do lead\n${leadCard(lead)}\n\n# Conversa no WhatsApp até agora\n${transcript(lead, getMessages(lead.id))}\n\n# Tarefa\nEscreva um direct curto (até 3 frases) para o Instagram DA EMPRESA, no mesmo tom das regras de prospecção. Se já houver conversa no WhatsApp, mencione de leve que mandou mensagem por lá também.`,
    }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("A IA não conseguiu escrever o direct.");
  return response.parsed_output.message.trim();
}
