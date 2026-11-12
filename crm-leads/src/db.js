import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/crm.db";
mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT,
  phone           TEXT NOT NULL UNIQUE,
  email           TEXT,
  company         TEXT,
  niche           TEXT,
  budget          TEXT,
  source          TEXT DEFAULT 'manual',
  stage           TEXT NOT NULL DEFAULT 'novo',
  score           INTEGER DEFAULT 0,
  summary         TEXT,
  notes           TEXT,
  ai_enabled      INTEGER NOT NULL DEFAULT 1,
  needs_attention INTEGER NOT NULL DEFAULT 0,
  attention_reason TEXT,
  followups_sent  INTEGER NOT NULL DEFAULT 0,
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('in','out')),
  author     TEXT NOT NULL CHECK (author IN ('lead','ai','human','system')),
  body       TEXT NOT NULL,
  status     TEXT DEFAULT 'ok',
  wa_id      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id, id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Migrações simples: adiciona colunas novas em bancos já existentes.
const leadCols = db.prepare("PRAGMA table_info(leads)").all().map((c) => c.name);
for (const [col, type] of [
  ["wa_jid", "TEXT"], ["address", "TEXT"], ["website", "TEXT"], ["rating", "REAL"],
  ["reviews", "INTEGER"], ["maps_url", "TEXT"], ["place_id", "TEXT"], ["prospected_at", "TEXT"],
  ["cnpj", "TEXT"], ["instagram", "TEXT"], ["owners", "TEXT"], ["alt_phone", "TEXT"], ["enriched_at", "TEXT"],
  ["ig_draft", "TEXT"], ["ig_sent_at", "TEXT"],
]) {
  if (!leadCols.includes(col)) db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${type}`);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_place ON leads(place_id) WHERE place_id IS NOT NULL");

export const STAGES = [
  "novo",
  "contatado",
  "em_conversa",
  "qualificado",
  "reuniao",
  "ganho",
  "perdido",
];

const DEFAULT_SETTINGS = {
  agency_name: "Minha Agência de Tráfego",
  agent_name: "Ana",
  offer:
    "Gestão de tráfego pago (Meta Ads e Google Ads) para negócios locais e e-commerces: criação de campanhas, otimização diária, relatórios semanais e acompanhamento de vendas.",
  ideal_client:
    "Empresas que já vendem, investem ou podem investir a partir de R$ 1.500/mês em anúncios e querem mais clientes/vendas pela internet.",
  qualification:
    "1) Qual é o negócio/nicho? 2) Já investe em anúncios? Quanto por mês? 3) Qual o principal objetivo (mais clientes, vendas online, leads)? 4) Quem decide a contratação?",
  goal: "Agendar uma reunião de diagnóstico gratuita de 30 minutos com o especialista.",
  meeting_link: "",
  tone: "Simpático, direto e profissional. Mensagens curtas, como no WhatsApp. No máximo 1 emoji por mensagem.",
  extra_rules:
    "Nunca prometa resultados garantidos. Não passe preço fechado: diga que depende do diagnóstico.",
  sales_script: "",
  followup_hours: "24",
  max_followups: "2",
  // Prospecção ativa
  prospect_angle:
    "Ajudamos clínicas odontológicas a encher a agenda de avaliações (implante, lentes, ortodontia) com anúncios no Instagram e no Google.",
  campaign_active: "0",
  daily_limit: "25",
  send_start_hour: "9",
  send_end_hour: "18",
  min_interval_min: "4",
  max_interval_min: "12",
};

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function saveSettings(obj) {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (obj[key] !== undefined) stmt.run(key, String(obj[key]));
  }
  return getSettings();
}

export function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  // Número brasileiro sem DDI (10 ou 11 dígitos) -> adiciona 55
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
}

export function getLead(id) {
  return db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
}

export function getLeadByPhone(phone) {
  return db.prepare("SELECT * FROM leads WHERE phone = ?").get(normalizePhone(phone));
}

export function getLeadByJid(jid) {
  return db.prepare("SELECT * FROM leads WHERE wa_jid = ?").get(jid);
}

export const isProspect = (lead) => lead?.source === "prospeccao";

/** Próximo prospect da fila (clínica encontrada que ainda não recebeu mensagem). */
export function nextProspect() {
  return db
    .prepare("SELECT * FROM leads WHERE source = 'prospeccao' AND stage = 'novo' AND ai_enabled = 1 ORDER BY id LIMIT 1")
    .get();
}

export function prospectsContactedToday() {
  return db
    .prepare("SELECT COUNT(*) AS n FROM leads WHERE prospected_at IS NOT NULL AND date(prospected_at) = date('now')")
    .get().n;
}

export function prospectQueueSize() {
  return db.prepare("SELECT COUNT(*) AS n FROM leads WHERE source = 'prospeccao' AND stage = 'novo'").get().n;
}

export function listLeads() {
  return db
    .prepare(
      `SELECT l.*,
        (SELECT body FROM messages m WHERE m.lead_id = l.id ORDER BY id DESC LIMIT 1) AS last_message
       FROM leads l ORDER BY l.updated_at DESC`,
    )
    .all();
}

const LEAD_FIELDS = [
  "wa_jid", "address", "website", "rating", "reviews", "maps_url", "place_id", "prospected_at",
  "cnpj", "instagram", "owners", "alt_phone", "enriched_at", "ig_draft", "ig_sent_at",
  "name", "email", "company", "niche", "budget", "source", "stage", "score",
  "summary", "notes", "ai_enabled", "needs_attention", "attention_reason",
  "followups_sent", "last_inbound_at", "last_outbound_at",
];

export function createLead(data) {
  const phone = normalizePhone(data.phone);
  if (phone.length < 10) throw new Error("Telefone inválido");
  const existing = getLeadByPhone(phone);
  if (existing) return { lead: existing, created: false };
  if (data.place_id) {
    const byPlace = db.prepare("SELECT * FROM leads WHERE place_id = ?").get(data.place_id);
    if (byPlace) return { lead: byPlace, created: false };
  }
  const info = db
    .prepare(
      `INSERT INTO leads (name, phone, email, company, niche, budget, source, notes,
         address, website, rating, reviews, maps_url, place_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.name || null, phone, data.email || null, data.company || null,
      data.niche || null, data.budget || null, data.source || "manual", data.notes || null,
      data.address || null, data.website || null, data.rating ?? null, data.reviews ?? null,
      data.maps_url || null, data.place_id || null,
    );
  return { lead: getLead(info.lastInsertRowid), created: true };
}

export function updateLead(id, patch) {
  const keys = Object.keys(patch).filter((k) => LEAD_FIELDS.includes(k));
  if (patch.stage && !STAGES.includes(patch.stage)) throw new Error("Etapa inválida");
  if (keys.length) {
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => {
      const v = patch[k];
      if (typeof v === "boolean") return v ? 1 : 0;
      return v === undefined ? null : v;
    });
    db.prepare(`UPDATE leads SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  }
  return getLead(id);
}

export function deleteLead(id) {
  db.prepare("DELETE FROM leads WHERE id = ?").run(id);
}

export function addMessage(leadId, { direction, author, body, status = "ok", wa_id = null }) {
  const info = db
    .prepare("INSERT INTO messages (lead_id, direction, author, body, status, wa_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(leadId, direction, author, body, status, wa_id);
  // Notas internas do sistema não contam como mensagem enviada (não afetam o follow-up).
  if (author === "system") return db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
  const col = direction === "in" ? "last_inbound_at" : "last_outbound_at";
  db.prepare(`UPDATE leads SET ${col} = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(leadId);
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
}

export function getMessages(leadId) {
  return db.prepare("SELECT * FROM messages WHERE lead_id = ? ORDER BY id").all(leadId);
}

export function messageExists(waId) {
  return !!db.prepare("SELECT 1 FROM messages WHERE wa_id = ?").get(waId);
}

export function leadsNeedingFollowup(hours, maxFollowups) {
  return db
    .prepare(
      `SELECT * FROM leads
       WHERE ai_enabled = 1
         AND stage IN ('contatado', 'em_conversa', 'qualificado')
         AND followups_sent < ?
         AND last_outbound_at IS NOT NULL
         AND (last_inbound_at IS NULL OR last_inbound_at < last_outbound_at)
         AND last_outbound_at < datetime('now', ?)`,
    )
    .all(maxFollowups, `-${Number(hours)} hours`);
}

export function stats() {
  const byStage = db.prepare("SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage").all();
  const total = db.prepare("SELECT COUNT(*) AS n FROM leads").get().n;
  const today = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE date(created_at) = date('now')").get().n;
  const attention = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE needs_attention = 1").get().n;
  return { total, today, attention, byStage };
}
