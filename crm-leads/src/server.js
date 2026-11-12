import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as db from "./db.js";
import { existsSync } from "node:fs";
import { aiConfigured, aiLabel, writeInstagramDm, describeAiError } from "./ai.js";
import { MODE, whatsappConfigured, whatsappStatus, parseWebhook, startQr, logoutQr } from "./whatsapp.js";
import { placesConfigured, findBusinesses } from "./prospect.js";
import { enrichLead } from "./enrich.js";
import {
  bus, firstContact, handleInbound, runAi, sendOutbound, startLoops, campaignStatus, systemNote,
} from "./engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => res.status(400).json({ error: err.message }));

// ---------- Rotas públicas ----------

app.get("/health", (req, res) => res.json({ ok: true }));

// Verificação do webhook (Meta chama uma vez ao configurar)
app.get("/webhook/whatsapp", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// Mensagens recebidas do WhatsApp
app.post("/webhook/whatsapp", (req, res) => {
  res.sendStatus(200); // responde rápido para a Meta não reenviar
  for (const m of parseWebhook(req.body)) {
    handleInbound({ phone: m.from, name: m.name, text: m.text, waId: m.id });
  }
});

// Captação de leads: formulário de landing page, Zapier/Make, Meta Lead Ads via integração etc.
app.options("/api/capture", (req, res) => {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }).sendStatus(204);
});
app.post("/api/capture", wrap(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const token = req.query.token || req.body.token;
  if (process.env.CAPTURE_TOKEN && token !== process.env.CAPTURE_TOKEN) {
    return res.status(401).json({ error: "token inválido" });
  }
  const b = req.body;
  const { lead, created } = db.createLead({
    name: b.name || b.nome,
    phone: b.phone || b.telefone || b.whatsapp,
    email: b.email,
    company: b.company || b.empresa,
    niche: b.niche || b.nicho,
    budget: b.budget || b.investimento,
    source: b.source || b.origem || b.utm_source || "formulario",
    notes: b.message || b.mensagem || null,
  });
  if (created) firstContact(lead); // roda em segundo plano
  if (b.redirect) return res.redirect(303, b.redirect);
  res.json({ ok: true, id: lead.id, created });
}));

// ---------- Autenticação do painel ----------
app.use((req, res, next) => {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return next();
  const [, encoded] = (req.headers.authorization || "").split(" ");
  const [, given] = Buffer.from(encoded || "", "base64").toString().split(":");
  if (given === pass) return next();
  res.set("WWW-Authenticate", 'Basic realm="CRM"').status(401).send("Login necessário");
});

app.use(express.static(path.join(here, "..", "public")));

// ---------- API do painel ----------
app.get("/api/status", (req, res) => {
  res.json({ ai: aiConfigured(), aiLabel: aiLabel(), whatsapp: whatsappConfigured(), waMode: MODE, places: placesConfigured(), stages: db.STAGES });
});

// ----- WhatsApp por QR Code
app.get("/api/whatsapp", (req, res) => res.json(whatsappStatus()));
app.post("/api/whatsapp/connect", wrap(async (req, res) => {
  await startQr({ onInbound: inboundFromQr, onStatus: (st) => bus.emit("whatsapp", st) });
  res.json(whatsappStatus());
}));
app.post("/api/whatsapp/logout", wrap(async (req, res) => {
  await logoutQr();
  res.json(whatsappStatus());
}));

// ----- Prospecção (Google Maps) e robô
app.post("/api/prospect/search", wrap(async (req, res) => {
  const { query, city, areas, niche } = req.body;
  if (!query?.trim() || !city?.trim()) throw new Error("Informe o tipo de empresa e a cidade.");
  const list = String(areas || "").split(/[\n,]/).map((a) => a.trim()).filter(Boolean).slice(0, 40);
  const result = await findBusinesses({ query: query.trim(), city: city.trim(), areas: list, niche: niche?.trim() });
  bus.emit("change", {});
  res.json(result);
}));
app.get("/api/campaign", (req, res) => res.json(campaignStatus()));
app.put("/api/campaign", (req, res) => {
  db.saveSettings(req.body);
  const st = campaignStatus();
  bus.emit("campaign", st);
  res.json(st);
});

app.post("/api/leads/:id/enrich", wrap(async (req, res) => {
  const lead = db.getLead(req.params.id);
  if (!lead) throw new Error("lead não encontrado");
  const info = await enrichLead(lead);
  systemNote(lead.id, `Pesquisa: ${info}`);
  res.json(db.getLead(lead.id));
}));

// Direct de Instagram: a IA escreve, você envia pelo seu Instagram.
app.post("/api/leads/:id/instagram", wrap(async (req, res) => {
  const lead = db.getLead(req.params.id);
  if (!lead) throw new Error("lead não encontrado");
  try {
    const text = await writeInstagramDm(lead);
    res.json(db.updateLead(lead.id, { ig_draft: text }));
  } catch (err) {
    throw new Error(describeAiError(err));
  }
}));
app.post("/api/leads/:id/instagram/sent", wrap(async (req, res) => {
  const lead = db.getLead(req.params.id);
  if (!lead?.ig_draft) throw new Error("sem direct para registrar");
  db.addMessage(lead.id, { direction: "out", author: "human", body: `[Instagram] ${lead.ig_draft}`, status: "enviado no Instagram" });
  const updated = db.updateLead(lead.id, { ig_sent_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
  bus.emit("change", { leadId: lead.id });
  res.json(updated);
}));

app.get("/api/stats", (req, res) => res.json(db.stats()));
app.get("/api/leads", (req, res) => res.json(db.listLeads()));

app.post("/api/leads", wrap(async (req, res) => {
  const { lead, created } = db.createLead({ ...req.body, source: req.body.source || "manual" });
  if (created && req.body.start_ai) firstContact(lead);
  bus.emit("change", { leadId: lead.id });
  res.json({ lead, created });
}));

app.get("/api/leads/:id", (req, res) => {
  const lead = db.getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: "lead não encontrado" });
  res.json({ lead, messages: db.getMessages(lead.id) });
});

app.patch("/api/leads/:id", wrap(async (req, res) => {
  const patch = { ...req.body };
  if (patch.ai_enabled) Object.assign(patch, { needs_attention: 0, attention_reason: null });
  const lead = db.updateLead(req.params.id, patch);
  bus.emit("change", { leadId: lead.id });
  res.json(lead);
}));

app.delete("/api/leads/:id", (req, res) => {
  db.deleteLead(req.params.id);
  bus.emit("change", { leadId: Number(req.params.id) });
  res.json({ ok: true });
});

// Humano envia mensagem manual
app.post("/api/leads/:id/send", wrap(async (req, res) => {
  const lead = db.getLead(req.params.id);
  if (!lead || !req.body.body?.trim()) throw new Error("lead ou mensagem inválida");
  db.updateLead(lead.id, { needs_attention: 0 });
  res.json(await sendOutbound(lead, req.body.body.trim(), "human"));
}));

// Pede para a IA agir agora (primeira mensagem, resposta ou follow-up)
app.post("/api/leads/:id/ai", wrap(async (req, res) => {
  const lead = db.getLead(req.params.id);
  if (!lead) throw new Error("lead não encontrado");
  // Considera só a conversa do WhatsApp (ignora notas do sistema e directs do Instagram).
  const msgs = db.getMessages(lead.id).filter((m) => m.author !== "system" && !m.body.startsWith("[Instagram]"));
  const last = msgs.at(-1);
  const kind = !msgs.length ? (db.isProspect(lead) ? "prospect" : "first") : last.direction === "in" ? "reply" : "followup";
  if (!lead.ai_enabled) db.updateLead(lead.id, { ai_enabled: 1, needs_attention: 0 });
  runAi(lead.id, kind);
  res.json({ ok: true, kind });
}));

// Simulador: finge que o lead mandou uma mensagem (para testar sem WhatsApp)
app.post("/api/leads/:id/simulate", wrap(async (req, res) => {
  const lead = db.getLead(req.params.id);
  if (!lead || !req.body.text?.trim()) throw new Error("lead ou texto inválido");
  handleInbound({ phone: lead.phone, text: req.body.text.trim() });
  res.json({ ok: true });
}));

app.get("/api/settings", (req, res) => res.json(db.getSettings()));
app.put("/api/settings", (req, res) => res.json(db.saveSettings(req.body)));

// Atualizações em tempo real para o painel
app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (type) => (data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const onChange = send("change");
  const onTyping = send("typing");
  const onCampaign = send("campaign");
  const onWa = send("whatsapp");
  bus.on("change", onChange);
  bus.on("typing", onTyping);
  bus.on("campaign", onCampaign);
  bus.on("whatsapp", onWa);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("change", onChange);
    bus.off("typing", onTyping);
    bus.off("campaign", onCampaign);
    bus.off("whatsapp", onWa);
  });
});

function inboundFromQr(m) {
  handleInbound({ phone: m.phone, jid: m.jid, altJid: m.altJid, name: m.name, text: m.text, waId: m.id });
}

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`CRM rodando em http://localhost:${PORT}`);
  console.log(`IA: ${aiConfigured() ? aiLabel() : "NÃO configurada (OPENAI_API_KEY)"} | WhatsApp: ${MODE === "cloud" ? "API oficial" : "QR Code"} | Google Maps: ${placesConfigured() ? "ok" : "sem chave"}`);
  // Se já conectou por QR antes, reconecta sozinho.
  if (MODE === "qr" && existsSync(`${process.env.WA_AUTH_DIR || "./data/wa-auth"}/creds.json`)) {
    startQr({ onInbound: inboundFromQr, onStatus: (st) => bus.emit("whatsapp", st) }).catch((e) => console.error("[whatsapp]", e));
  }
  startLoops();
});
