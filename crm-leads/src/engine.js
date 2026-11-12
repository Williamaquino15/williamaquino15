import { EventEmitter } from "node:events";
import * as db from "./db.js";
import { decideNextMessage, aiConfigured, describeAiError } from "./ai.js";
import { MODE, sendText, sendTemplate, whatsappConfigured, checkNumber, reachoutLocked } from "./whatsapp.js";
import { enrichLead } from "./enrich.js";

// Avisa o painel (via SSE) sempre que algo muda.
export const bus = new EventEmitter();
const changed = (leadId) => bus.emit("change", { leadId });

const REPLY_DELAY_MS = Number(process.env.REPLY_DELAY_SECONDS ?? 8) * 1000;
const pendingReplies = new Map(); // leadId -> timeout
const busy = new Set(); // leads com IA trabalhando agora

export function systemNote(leadId, body) {
  db.addMessage(leadId, { direction: "out", author: "system", body, status: "note" });
  changed(leadId);
}

/** Envia uma mensagem (da IA ou de um humano) e registra no histórico. Devolve a mensagem salva. */
export async function sendOutbound(lead, body, author) {
  try {
    const r = await sendText(lead.wa_jid || lead.phone, body);
    return db.addMessage(lead.id, {
      direction: "out", author, body, wa_id: r.id, status: r.simulated ? "simulado" : "enviado",
    });
  } catch (err) {
    return db.addMessage(lead.id, { direction: "out", author, body, status: `erro: ${err.message}` });
  } finally {
    changed(lead.id);
  }
}

function applyDecision(lead, d) {
  const patch = { stage: lead.stage === "ganho" ? "ganho" : d.stage, score: d.score, summary: d.summary };
  for (const k of ["name", "company", "niche", "budget"]) if (d[k] && !lead[k]) patch[k] = d[k];
  if (d.handoff) {
    patch.ai_enabled = 0;
    patch.needs_attention = 1;
    patch.attention_reason = d.handoff_reason || "A IA pediu para um humano assumir.";
  }
  return db.updateLead(lead.id, patch);
}

/** Roda a IA para um lead e envia o que ela decidir. Devolve true se uma mensagem saiu sem erro. */
export async function runAi(leadId, kind) {
  if (busy.has(leadId)) return false;
  const lead = db.getLead(leadId);
  if (!lead || !lead.ai_enabled) return false;
  if (!aiConfigured()) {
    systemNote(leadId, "IA não configurada: coloque sua chave em OPENAI_API_KEY no arquivo .env e reinicie o CRM.");
    return false;
  }
  busy.add(leadId);
  bus.emit("typing", { leadId, typing: true });
  let ok = false;
  try {
    const d = await decideNextMessage(lead, kind);
    const updated = applyDecision(lead, d);
    if (d.reply.trim()) {
      const msg = await sendOutbound(updated, d.reply.trim(), "ai");
      ok = !String(msg.status).startsWith("erro");
    }
    if (kind === "followup") db.updateLead(leadId, { followups_sent: lead.followups_sent + 1 });
    // Aviso só no painel — nada é enviado ao lead.
    if (d.handoff) systemNote(leadId, `🔔 Passado para você (o lead não foi avisado): ${updated.attention_reason}`);
    changed(leadId);
  } catch (err) {
    console.error(`[IA] lead ${leadId}:`, err);
    systemNote(leadId, `Erro da IA: ${describeAiError(err)}`);
  } finally {
    busy.delete(leadId);
    bus.emit("typing", { leadId, typing: false });
  }
  return ok;
}

/** Lead que chegou por formulário/cadastro: dispara o primeiro contato. */
export async function firstContact(lead) {
  if (!lead.ai_enabled) return;
  // Na API oficial, a 1ª mensagem para quem nunca te escreveu precisa ser um template aprovado.
  if (MODE === "cloud" && process.env.WHATSAPP_TEMPLATE_NAME) {
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
  await runAi(lead.id, db.isProspect(lead) ? "prospect" : "first");
}

/** Mensagem recebida: registra e agenda a resposta da IA (espera alguns segundos para juntar mensagens picadas). */
export function handleInbound({ phone, jid, altJid, name, text, waId, source = "whatsapp" }) {
  if (waId && db.messageExists(waId)) return null; // eventos repetidos
  let lead = (jid && db.getLeadByJid(jid)) || (altJid && db.getLeadByJid(altJid)) || (phone && db.getLeadByPhone(phone));
  let created = false;
  if (!lead) {
    ({ lead, created } = db.createLead({ phone: phone || (jid || "").split("@")[0], name, source }));
  }
  db.addMessage(lead.id, { direction: "in", author: "lead", body: text, wa_id: waId });
  const patch = { followups_sent: 0 };
  if (jid && !lead.wa_jid) patch.wa_jid = jid;
  if (["novo", "contatado"].includes(lead.stage)) patch.stage = "em_conversa";
  if (!lead.ai_enabled) {
    patch.needs_attention = 1;
    patch.attention_reason = lead.attention_reason || "Nova mensagem com IA pausada.";
  }
  lead = db.updateLead(lead.id, patch);
  changed(lead.id);

  if (lead.ai_enabled && lead.stage !== "perdido") {
    clearTimeout(pendingReplies.get(lead.id));
    pendingReplies.set(lead.id, setTimeout(() => {
      pendingReplies.delete(lead.id);
      runAi(lead.id, "reply");
    }, REPLY_DELAY_MS));
  }
  return { lead, created };
}

// ------------------------------------------------------------------ Robô de prospecção
// Regras de segurança para não queimar o número: limite diário, intervalos aleatórios,
// só em dias úteis e horário comercial (horário de Recife), pausa automática se algo der errado.

export const campaign = { nextSendAt: 0, lastEvent: "Robô parado.", errors: 0, running: false };

function recifeNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.TZ_LOCAL || "America/Recife", weekday: "short", hour: "numeric", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get("weekday"), hour: Number(get("hour")) };
}

export function inSendWindow(s = db.getSettings()) {
  const { weekday, hour } = recifeNow();
  return !["Sat", "Sun"].includes(weekday) && hour >= Number(s.send_start_hour) && hour < Number(s.send_end_hour);
}

function event(text) {
  campaign.lastEvent = `${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Recife", hour: "2-digit", minute: "2-digit" })} · ${text}`;
  bus.emit("campaign", campaignStatus());
}

function pauseCampaign(reason) {
  db.saveSettings({ campaign_active: "0" });
  event(`Robô pausado: ${reason}`);
}

export function campaignStatus() {
  const s = db.getSettings();
  return {
    active: s.campaign_active === "1",
    sentToday: db.prospectsContactedToday(),
    limit: Number(s.daily_limit),
    queue: db.prospectQueueSize(),
    inWindow: inSendWindow(s),
    nextSendAt: campaign.nextSendAt,
    lastEvent: campaign.lastEvent,
  };
}

const randMinutes = (min, max) => (Number(min) + Math.random() * (Number(max) - Number(min))) * 60_000;

async function prospectNext(s) {
  let lead = db.nextProspect();
  if (!lead) return event("Fila vazia. Busque mais empresas em Prospecção.");

  if (!lead.enriched_at) {
    const info = await enrichLead(lead);
    systemNote(lead.id, `Pesquisa automática: ${info}`);
    lead = db.getLead(lead.id);
  }

  // Descobre qual número tem WhatsApp. Tenta primeiro o do CNPJ (costuma ser do dono/sócio,
  // evitando a recepção) e depois o número público da clínica no Google.
  let target = null;
  let usedPhone = null;
  for (const phone of [lead.alt_phone, lead.phone].filter(Boolean)) {
    const r = await checkNumber(phone);
    if (r.exists) { target = r.jid; usedPhone = phone; break; }
  }
  if (!target) {
    db.updateLead(lead.id, { stage: "perdido", summary: "Nenhum dos números encontrados tem WhatsApp.", prospected_at: null });
    systemNote(lead.id, "Sem WhatsApp nos números encontrados. Movido para Perdido.");
    campaign.nextSendAt = Date.now() + 20_000;
    return event(`${lead.name}: sem WhatsApp, pulando.`);
  }

  db.updateLead(lead.id, { wa_jid: target });
  if (usedPhone === lead.alt_phone) {
    systemNote(lead.id, `Enviando para o telefone cadastrado no CNPJ (${target.split("@")[0]}).`);
  }
  const ok = await runAi(lead.id, "prospect");
  db.updateLead(lead.id, { prospected_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
  if (ok) {
    campaign.errors = 0;
    event(`Mensagem enviada para ${lead.name}.`);
  } else {
    campaign.errors++;
    event(`Falha ao abordar ${lead.name}.`);
    if (campaign.errors >= 3) pauseCampaign("3 falhas seguidas. Confira o WhatsApp e a IA.");
  }
  campaign.nextSendAt = Date.now() + randMinutes(s.min_interval_min, s.max_interval_min);
}

export async function tick() {
  if (campaign.running) return;
  campaign.running = true;
  try {
    const s = db.getSettings();
    if (!whatsappConfigured() || !inSendWindow(s)) return;

    // Follow-ups (um por rodada, dentro do horário comercial)
    const [due] = db.leadsNeedingFollowup(Number(s.followup_hours), Number(s.max_followups));
    if (due) await runAi(due.id, "followup");

    if (s.campaign_active !== "1" || Date.now() < campaign.nextSendAt) return;
    if (db.prospectsContactedToday() >= Number(s.daily_limit)) return event("Limite diário atingido. Continua amanhã.");
    const locked = await reachoutLocked();
    if (locked) return pauseCampaign("o WhatsApp limitou temporariamente mensagens para contatos novos.");
    await prospectNext(s);
  } catch (err) {
    console.error("[robô]", err);
    event(`Erro: ${err.message}`);
  } finally {
    campaign.running = false;
  }
}

export function startLoops() {
  setInterval(tick, 60_000);
  setTimeout(tick, 10_000);
}
