// Conexão com o WhatsApp. Dois modos:
//  - "qr" (padrão): conecta o SEU WhatsApp lendo um QR Code, como o WhatsApp Web (biblioteca Baileys, não oficial).
//  - "cloud": API oficial da Meta, se WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID estiverem definidos.
import { mkdirSync, rmSync } from "node:fs";
import QRCode from "qrcode";
import pino from "pino";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  isLidUser,
  jidNormalizedUser,
} from "baileys";

const GRAPH = "https://graph.facebook.com/v21.0";
const AUTH_DIR = process.env.WA_AUTH_DIR || "./data/wa-auth";
export const MODE = process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID ? "cloud" : "qr";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Modo QR Code
let sock = null;
let qrState = { status: "desconectado", qr: null, me: null, error: null };
let onInboundCb = () => {};
let onStatusCb = () => {};
let starting = false;

function setState(patch) {
  qrState = { ...qrState, ...patch };
  onStatusCb(qrState);
}

export async function startQr({ onInbound, onStatus } = {}) {
  if (MODE !== "qr" || starting) return;
  if (onInbound) onInboundCb = onInbound;
  if (onStatus) onStatusCb = onStatus;
  starting = true;
  try {
    mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.ubuntu("CRM de Leads"),
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (u.qr) setState({ status: "aguardando_qr", qr: await QRCode.toDataURL(u.qr, { margin: 1, width: 280 }) });
      if (u.connection === "open") {
        setState({ status: "conectado", qr: null, error: null, me: sock.user?.id?.split(":")[0] || null });
      }
      if (u.connection === "close") {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        sock = null;
        if (code === DisconnectReason.loggedOut) {
          rmSync(AUTH_DIR, { recursive: true, force: true });
          setState({ status: "desconectado", qr: null, me: null, error: "Sessão encerrada no celular. Gere um novo QR Code." });
        } else {
          setState({ status: "reconectando", qr: null });
          setTimeout(() => startQr(), code === DisconnectReason.restartRequired ? 500 : 5000);
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const jid = m.key.remoteJid || "";
        if (m.key.fromMe || jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter")) continue;
        const text =
          m.message?.conversation ||
          m.message?.extendedTextMessage?.text ||
          m.message?.buttonsResponseMessage?.selectedDisplayText ||
          m.message?.listResponseMessage?.title ||
          (m.message?.audioMessage ? "[áudio recebido — a IA só lê texto]" : null) ||
          (m.message?.imageMessage ? m.message.imageMessage.caption || "[imagem recebida]" : null);
        if (!text) continue;
        // Em contas novas o WhatsApp manda um ID interno (@lid); o número real vem em remoteJidAlt.
        const pnJid = isLidUser(jid) ? m.key.remoteJidAlt : jid;
        onInboundCb({
          jid: jidNormalizedUser(jid),
          altJid: m.key.remoteJidAlt ? jidNormalizedUser(m.key.remoteJidAlt) : null,
          phone: pnJid ? pnJid.split("@")[0] : null,
          name: m.pushName || null,
          text,
          id: m.key.id,
        });
      }
    });
  } finally {
    starting = false;
  }
}

export async function logoutQr() {
  try {
    await sock?.logout();
  } catch {}
  sock = null;
  rmSync(AUTH_DIR, { recursive: true, force: true });
  setState({ status: "desconectado", qr: null, me: null, error: null });
}

// ---------------------------------------------------------------- Interface comum

export function whatsappStatus() {
  if (MODE === "cloud") return { mode: "cloud", status: "conectado", qr: null, me: process.env.WHATSAPP_PHONE_NUMBER_ID };
  return { mode: "qr", ...qrState };
}

export function whatsappConfigured() {
  return MODE === "cloud" || qrState.status === "conectado";
}

/** Confere se o número tem WhatsApp e devolve o endereço certo (resolve a questão do 9º dígito). */
export async function checkNumber(phone) {
  if (MODE === "cloud") return { exists: true, jid: phone };
  if (!sock || qrState.status !== "conectado") throw new Error("WhatsApp desconectado");
  const [r] = (await sock.onWhatsApp(phone)) || [];
  return { exists: !!r?.exists, jid: r?.jid || null };
}

/** true se o WhatsApp travou temporariamente o envio para contatos novos. */
export async function reachoutLocked() {
  if (MODE !== "qr" || !sock) return false;
  try {
    const s = await sock.fetchAccountReachoutTimelock();
    return s?.isActive ? s.timeEnforcementEnds || true : false;
  } catch {
    return false;
  }
}

/** Envia texto. `to` pode ser telefone ou JID. Mostra "digitando…" antes, como uma pessoa. */
export async function sendText(to, body) {
  if (MODE === "cloud") {
    const id = await cloudPost({ to, type: "text", text: { preview_url: true, body } });
    return { simulated: false, id };
  }
  if (!sock || qrState.status !== "conectado") return { simulated: true, id: null };
  const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate("composing", jid);
    await sleep(Math.min(8000, 1500 + body.length * 40));
    await sock.sendPresenceUpdate("paused", jid);
  } catch {}
  const sent = await sock.sendMessage(jid, { text: body });
  return { simulated: false, id: sent?.key?.id || null };
}

// ---------------------------------------------------------------- Modo API oficial (Cloud)

async function cloudPost(payload) {
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `WhatsApp HTTP ${res.status}`);
  return json?.messages?.[0]?.id || null;
}

/** Template aprovado (só no modo oficial) para o primeiro contato. Variável {{1}} = primeiro nome. */
export async function sendTemplate(to, firstName) {
  const id = await cloudPost({
    to,
    type: "template",
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR" },
      components: [{ type: "body", parameters: [{ type: "text", text: firstName || "tudo bem" }] }],
    },
  });
  return { simulated: false, id };
}

/** Extrai mensagens de texto do webhook da API oficial. */
export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages || []) {
        let text = null;
        if (m.type === "text") text = m.text?.body;
        else if (m.type === "button") text = m.button?.text;
        else if (m.type === "interactive") text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title;
        else text = `[${m.type} recebido — a IA só lê texto]`;
        if (text) out.push({ from: m.from, name: names[m.from] || null, text, id: m.id });
      }
    }
  }
  return out;
}
