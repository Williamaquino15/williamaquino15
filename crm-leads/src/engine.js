import { EventEmitter } from "node:events";
import * as db from "./db.js";
import { decideNextMessage, aiConfigured, describeAiError } from "./ai.js";
import { sendText, sendTemplate, whatsappConfigured } from "./whatsapp.js";

// Avisa o painel (via SSE) sempre que algo muda.
export const bus = new EventEmitter();
const changed = (leadId) => bus.emit("change", { leadId });

const REPLY_DELAY_MS = Number(process.env.REPLY_DELAY_SECONDS ?? 8) * 1000;
const pendingReplies = new Map(); // leadId -> timeout
const busy = new Set(); // leads com IA trabalhando agora

function systemNote(leadId, body) {
  db.addMessage(leadId, { direction: "out", author: "system", body, status: "note" });
  changed(leadId);
}

/** Envia uma mensagem (da IA ou de um humano) e registra no histórico. */
export async function sendOutbound(lead, body, author) {
  try {
    const r = await sendText(lead.phone, body);
    const msg = db.addMessage(lead.id, {
      direction: "out", author, body, wa_id: r.id, status: r.simulated ? "simulado" : "enviado",
    });
    return msg;
  } catch (err) {
    const msg = db.addMessage(lead.id, { direction: "out", author, body, status: `erro: ${err.message}` });
    return msg;
  } finally {
    changed(lead.id);
  }
}

function applyDecision(lead, d) {
  const patch = {
    stage: lead.stage === "ganho" ? "ganho" : d.stage,
    score: d.score,
    summary: d.summary,
  };
  for (const k of ["name", "company", "niche", "budget"]) {
    if (d[k] && !lead[k]) patch[k] = d[k];
  }
  if (d.handoff) {
    patch.ai_enabled = 0;
    patch.needs_attention = 1;
    patch.attention_reason = d.handoff_reason || "A IA pediu para um humano assumir.";
  }
  return db.updateLead(lead.id, patch);
}

/** Roda a IA para um lead e envia o que ela decidir. */
export async function runAi(leadId, kind) {
  if (busy.has(leadId)) return;
  const lead = db.getLead(leadId);
  if (!lead || !lead.ai_enabled) return;
  if (!aiConfigured()) {
    systemNote(leadId, "IA não configurada: defina ANTHROPIC_API_KEY no arquivo .env.");
    return;
  }
  busy.add(leadId);
  bus.emit("typing", { leadId, typing: true });
  try {
    const d = await decideNextMessage(lead, kind);
    const updated = applyDecision(lead, d);
    if (d.reply.trim()) await sendOutbound(updated, d.reply.trim(), "ai");
    if (kind === "followup") db.updateLead(leadId, { followups_sent: lead.followups_sent + 1 });
    if (d.handoff) systemNote(leadId, `🔔 Handoff para humano: ${updated.attention_reason}`);
    changed(leadId);
  } catch (err) {
    console.error(`[IA] lead ${leadId}:`, err);
    systemNote(leadId, `Erro da IA: ${describeAiError(err)}`);
  } finally {
    busy.delete(leadId);
    bus.emit("typing", { leadId, typing: false });
  }
}

/** Novo lead captado: dispara o primeiro contato. */
export async function firstContact(lead) {
  if (!lead.ai_enabled) return;
  // Pela regra do WhatsApp, a 1ª mensagem para quem nunca te escreveu precisa ser um template aprovado.
  if (whatsappConfigured() && process.env.WHATSAPP_TEMPLATE_NAME) {
    const firstName = (lead.name || "").split(" ")[0];
    try {
      const r = await sendTemplate(lead.phone, firstName);
      db.addMessage(lead.id, {
        direction: "out", author: "ai", wa_id: r.id, status: "enviado",
        body: `[template "${process.env.WHATSAPP_TEMPLATE_NAME}" enviado para ${firstName || "o lead"}]`,
      });
      db.updateLead(lead.id, { stage: "contatado" });
    } catch (err) {
      systemNote(lead.id, `Falha ao enviar template: ${err.message}`);
    }
    changed(lead.id);
    return;
  }
  await runAi(lead.id, "first");
}

/** Mensagem recebida do lead: registra e agenda a resposta da IA (espera alguns segundos para juntar mensagens picadas). */
export function handleInbound({ phone, name, text, waId, source = "whatsapp" }) {
  if (waId && db.messageExists(waId)) return null; // a Meta às vezes reenvia o mesmo evento
  let { lead, created } = db.createLead({ phone, name, source });
  db.addMessage(lead.id, { direction: "in", author: "lead", body: text, wa_id: waId });
  const patch = { followups_sent: 0 };
  if (["novo", "contatado"].includes(lead.stage)) patch.stage = "em_conversa";
  if (!lead.ai_enabled) {
    patch.needs_attention = 1;
    patch.attention_reason = lead.attention_reason || "Nova mensagem com IA pausada.";
  }
  lead = db.updateLead(lead.id, patch);
  changed(lead.id);

  if (lead.ai_enabled) {
    clearTimeout(pendingReplies.get(lead.id));
    pendingReplies.set(
      lead.id,
      setTimeout(() => {
        pendingReplies.delete(lead.id);
        runAi(lead.id, "reply");
      }, REPLY_DELAY_MS),
    );
  }
  return { lead, created };
}

/** Verifica periodicamente quem precisa de follow-up. */
export function startFollowupLoop() {
  const tick = async () => {
    const s = db.getSettings();
    const leads = db.leadsNeedingFollowup(Number(s.followup_hours), Number(s.max_followups));
    for (const lead of leads) await runAi(lead.id, "followup");
  };
  setInterval(() => tick().catch((e) => console.error("[follow-up]", e)), 10 * 60 * 1000);
  setTimeout(() => tick().catch((e) => console.error("[follow-up]", e)), 15 * 1000);
}
