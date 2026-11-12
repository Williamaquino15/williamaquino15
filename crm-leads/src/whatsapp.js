// Integração com a WhatsApp Cloud API oficial (Meta).
// Sem as variáveis configuradas, o CRM roda em "modo simulador": as mensagens ficam só no painel.

const GRAPH = "https://graph.facebook.com/v21.0";

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function post(payload) {
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `WhatsApp HTTP ${res.status}`);
  return json?.messages?.[0]?.id || null;
}

/** Envia texto livre (só funciona dentro da janela de 24h após a última mensagem do lead). */
export async function sendText(to, body) {
  if (!whatsappConfigured()) return { simulated: true, id: null };
  const id = await post({ to, type: "text", text: { preview_url: true, body } });
  return { simulated: false, id };
}

/**
 * Envia um template aprovado — obrigatório para a PRIMEIRA mensagem a um lead que nunca te escreveu.
 * O template deve ter uma variável {{1}} no corpo, que recebe o primeiro nome do lead.
 */
export async function sendTemplate(to, firstName) {
  if (!whatsappConfigured()) return { simulated: true, id: null };
  const id = await post({
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

/** Extrai mensagens de texto recebidas do payload do webhook da Meta. */
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
        else if (m.type === "interactive")
          text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title;
        else text = `[${m.type} recebido — a IA só lê texto]`;
        if (text) out.push({ from: m.from, name: names[m.from] || null, text, id: m.id });
      }
    }
  }
  return out;
}
