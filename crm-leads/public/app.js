const STAGE_LABEL = {
  novo: "Novo",
  contatado: "Contatado",
  em_conversa: "Em conversa",
  qualificado: "Qualificado",
  reuniao: "Reunião",
  ganho: "Cliente ✅",
  perdido: "Perdido",
};
const AUTHOR_LABEL = { lead: "Lead", ai: "IA", human: "Você", system: "Sistema" };

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let state = { leads: [], stages: Object.keys(STAGE_LABEL), current: null };

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function fmtTime(sqlDate) {
  if (!sqlDate) return "";
  const d = new Date(sqlDate.replace(" ", "T") + "Z");
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ---------- Status e números ----------
async function loadStatus() {
  const s = await api("/api/status");
  state.stages = s.stages;
  $("#status").innerHTML =
    `<span class="pill ${s.ai ? "ok" : "off"}">IA ${s.ai ? "ativa" : "sem chave"}</span>` +
    `<span class="pill ${s.whatsapp ? "ok" : "off"}">WhatsApp ${s.whatsapp ? "conectado" : "desconectado"}</span>` +
    `<span class="pill ${s.places ? "ok" : "off"}">Google Maps ${s.places ? "ok" : "sem chave"}</span>`;
}

async function loadStats() {
  const s = await api("/api/stats");
  const by = Object.fromEntries(s.byStage.map((r) => [r.stage, r.n]));
  $("#stats").innerHTML = `
    <span><b>${s.total}</b> leads</span>
    <span><b>${s.today}</b> hoje</span>
    <span><b>${by.reuniao || 0}</b> reuniões</span>
    <span><b>${by.ganho || 0}</b> clientes</span>
    <span><b>${s.attention}</b> precisam de você</span>`;
}

// ---------- Kanban ----------
async function loadLeads() {
  state.leads = await api("/api/leads");
  renderBoard();
  loadStats();
}

function renderBoard() {
  const q = $("#search").value.trim().toLowerCase();
  const leads = state.leads.filter(
    (l) => !q || [l.name, l.phone, l.niche, l.company, l.source].some((v) => (v || "").toLowerCase().includes(q)),
  );
  $("#board").innerHTML = state.stages
    .map((stage) => {
      const items = leads.filter((l) => l.stage === stage);
      return `<section class="column" data-stage="${stage}">
        <h3><span>${STAGE_LABEL[stage]}</span><span>${items.length}</span></h3>
        ${items.map(cardHtml).join("")}
      </section>`;
    })
    .join("");
}

function cardHtml(l) {
  const tags = [];
  if (l.needs_attention) tags.push(`<span class="tag alert">⚠ precisa de você</span>`);
  if (!l.ai_enabled) tags.push(`<span class="tag">IA pausada</span>`);
  if (l.niche) tags.push(`<span class="tag">${esc(l.niche)}</span>`);
  if (l.source) tags.push(`<span class="tag">${esc(l.source)}</span>`);
  return `<article class="card" draggable="true" data-id="${l.id}">
    <div class="top"><span class="name">${esc(l.name || l.phone)}</span><span class="badge-score">${l.score || 0}</span></div>
    <div class="last">${esc(l.last_message || "sem mensagens")}</div>
    <div class="tags">${tags.join("")}</div>
  </article>`;
}

$("#board").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) openLead(Number(card.dataset.id));
});

// Arrastar e soltar entre etapas
$("#board").addEventListener("dragstart", (e) => {
  const card = e.target.closest(".card");
  if (card) e.dataTransfer.setData("text/plain", card.dataset.id);
});
$("#board").addEventListener("dragover", (e) => {
  const col = e.target.closest(".column");
  if (!col) return;
  e.preventDefault();
  document.querySelectorAll(".column.drop").forEach((c) => c !== col && c.classList.remove("drop"));
  col.classList.add("drop");
});
$("#board").addEventListener("drop", async (e) => {
  const col = e.target.closest(".column");
  document.querySelectorAll(".column.drop").forEach((c) => c.classList.remove("drop"));
  const id = e.dataTransfer.getData("text/plain");
  if (col && id) {
    await api(`/api/leads/${id}`, { method: "PATCH", body: { stage: col.dataset.stage } });
    loadLeads();
  }
});
$("#search").addEventListener("input", renderBoard);

// ---------- Painel do lead ----------
async function openLead(id) {
  state.current = id;
  $("#drawer").classList.remove("hidden");
  await refreshLead();
}

async function refreshLead() {
  if (!state.current) return;
  let data;
  try {
    data = await api(`/api/leads/${state.current}`);
  } catch {
    closeLead();
    return;
  }
  const { lead, messages } = data;
  $("#dName").textContent = lead.name || "Lead sem nome";
  $("#dPhone").textContent = `+${lead.phone} · criado ${fmtTime(lead.created_at)}`;
  $("#dStage").innerHTML = state.stages
    .map((s) => `<option value="${s}" ${s === lead.stage ? "selected" : ""}>${STAGE_LABEL[s]}</option>`)
    .join("");
  $("#dAi").checked = !!lead.ai_enabled;
  $("#dScore").textContent = lead.score || 0;
  $("#dScoreBar").style.width = `${lead.score || 0}%`;
  $("#dSummary").textContent = lead.summary || "A IA vai resumir o lead conforme a conversa avança.";
  const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;
  const facts = [
    lead.owners && `Sócios: <b>${esc(lead.owners)}</b>`,
    lead.alt_phone && `Tel. do CNPJ: <b>+${esc(lead.alt_phone)}</b>`,
    lead.cnpj && `CNPJ: <b>${esc(lead.cnpj)}</b>`,
    lead.rating && `Google: <b>${lead.rating}★</b> (${lead.reviews || 0})`,
    lead.address && `${esc(lead.address)}`,
    lead.website && link(lead.website, "Site"),
    lead.maps_url && link(lead.maps_url, "Google Maps"),
    lead.instagram && link(`https://instagram.com/${lead.instagram}`, "@" + lead.instagram),
    lead.ig_sent_at && `Direct enviado em ${fmtTime(lead.ig_sent_at)}`,
  ].filter(Boolean);
  $("#dFacts").innerHTML = facts.map((f) => `<span>${f}</span>`).join("");
  $("#dIg").classList.toggle("hidden", !lead.ig_draft);
  if (lead.ig_draft && document.activeElement !== $("#dIgText")) $("#dIgText").value = lead.ig_draft;
  $("#dIgOpen").href = lead.instagram ? `https://instagram.com/${lead.instagram}` : `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(lead.name || "")}`;
  $("#dIgOpen").textContent = lead.instagram ? `Abrir @${lead.instagram} ↗` : "Procurar no Instagram ↗";

  const att = $("#dAttention");
  att.classList.toggle("hidden", !lead.needs_attention);
  att.textContent = lead.needs_attention ? `⚠ ${lead.attention_reason || "Este lead precisa de atenção."}` : "";

  const form = $("#dForm");
  if (!form.contains(document.activeElement)) {
    for (const el of form.elements) if (el.name) el.value = lead[el.name] ?? "";
  }

  const chat = $("#dChat");
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
  chat.innerHTML = messages.length
    ? messages
        .map((m) => {
          const cls = m.author === "lead" ? "in" : m.author;
          const status = m.status && m.status !== "ok" && m.status !== "note" ? ` · ${esc(m.status)}` : "";
          return `<div class="msg ${cls}">${esc(m.body)}<span class="meta">${AUTHOR_LABEL[m.author]} · ${fmtTime(m.created_at)}${status}</span></div>`;
        })
        .join("")
    : `<div class="msg system">Nenhuma mensagem ainda. Clique em “IA agir agora” para a IA puxar conversa.</div>`;
  if (atBottom || !chat.dataset.loaded || chat.dataset.loaded !== String(lead.id)) chat.scrollTop = chat.scrollHeight;
  chat.dataset.loaded = String(lead.id);
}

function closeLead() {
  state.current = null;
  $("#drawer").classList.add("hidden");
}
$("#dClose").addEventListener("click", closeLead);
document.addEventListener("keydown", (e) => e.key === "Escape" && !document.querySelector("dialog[open]") && closeLead());

const patchCurrent = async (body) => {
  await api(`/api/leads/${state.current}`, { method: "PATCH", body });
  refreshLead();
  loadLeads();
};
$("#dStage").addEventListener("change", (e) => patchCurrent({ stage: e.target.value }));
$("#dAi").addEventListener("change", (e) => patchCurrent({ ai_enabled: e.target.checked }));

$("#dForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  document.activeElement.blur();
  await patchCurrent(body);
});
$("#dDelete").addEventListener("click", async () => {
  if (!confirm("Excluir este lead e toda a conversa?")) return;
  await api(`/api/leads/${state.current}`, { method: "DELETE" });
  closeLead();
  loadLeads();
});

$("#dSend").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = $("#dMsg").value.trim();
  if (!body) return;
  // Quando um humano entra na conversa, a IA pausa para não atropelar.
  if ($("#dAi").checked) await api(`/api/leads/${state.current}`, { method: "PATCH", body: { ai_enabled: false } });
  await api(`/api/leads/${state.current}/send`, { method: "POST", body: { body } });
  $("#dMsg").value = "";
  refreshLead();
});
$("#dMsg").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#dSend").requestSubmit();
  }
});
$("#dAiNow").addEventListener("click", async () => {
  try {
    await api(`/api/leads/${state.current}/ai`, { method: "POST" });
  } catch (err) {
    alert(err.message);
  }
});
$("#dSim").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#dSimText").value.trim();
  if (!text) return;
  await api(`/api/leads/${state.current}/simulate`, { method: "POST", body: { text } });
  $("#dSimText").value = "";
  refreshLead();
});

// ---------- Pesquisa e Instagram ----------
async function busyButton(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { await fn(); } catch (err) { alert(err.message); } finally { btn.disabled = false; btn.textContent = old; }
}
$("#dEnrich").addEventListener("click", (e) =>
  busyButton(e.target, "Pesquisando…", async () => { await api(`/api/leads/${state.current}/enrich`, { method: "POST" }); refreshLead(); }));
$("#dIgDraft").addEventListener("click", (e) =>
  busyButton(e.target, "Escrevendo…", async () => { await api(`/api/leads/${state.current}/instagram`, { method: "POST" }); refreshLead(); }));
$("#dIgCopy").addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText($("#dIgText").value); e.target.textContent = "Copiado ✓"; }
  catch { $("#dIgText").select(); }
  setTimeout(() => (e.target.textContent = "Copiar"), 1500);
});
$("#dIgSent").addEventListener("click", async () => {
  await api(`/api/leads/${state.current}`, { method: "PATCH", body: { ig_draft: $("#dIgText").value } });
  await api(`/api/leads/${state.current}/instagram/sent`, { method: "POST" });
  refreshLead();
});

// ---------- WhatsApp (QR Code) ----------
function renderWa(st) {
  const label = { conectado: `Conectado${st.me ? ` (+${st.me})` : ""} ✅`, aguardando_qr: "Escaneie o QR Code com o celular",
    reconectando: "Reconectando…", desconectado: "Desconectado" }[st.status] || st.status;
  $("#waStatus").textContent = st.mode === "cloud" ? "Usando a API oficial do WhatsApp (configurada no servidor)." : label + (st.error ? ` — ${st.error}` : "");
  $("#waQr").classList.toggle("hidden", !st.qr);
  $("#waHelp").classList.toggle("hidden", !st.qr);
  if (st.qr) $("#waQr").src = st.qr;
  $("#waConnect").classList.toggle("hidden", st.mode === "cloud" || st.status === "conectado" || !!st.qr);
  $("#waLogout").classList.toggle("hidden", st.mode === "cloud" || st.status !== "conectado");
  if (st.status === "conectado") loadStatus();
}
$("#btnWa").addEventListener("click", async () => { renderWa(await api("/api/whatsapp")); $("#waDialog").showModal(); });
$("#waConnect").addEventListener("click", (e) => busyButton(e.target, "Gerando…", async () => renderWa(await api("/api/whatsapp/connect", { method: "POST" }))));
$("#waLogout").addEventListener("click", async () => {
  if (!confirm("Desconectar este WhatsApp do CRM?")) return;
  renderWa(await api("/api/whatsapp/logout", { method: "POST" }));
  loadStatus();
});
$("#waClose").addEventListener("click", () => $("#waDialog").close());

// ---------- Prospecção e robô ----------
function renderCampaign(c) {
  const next = c.nextSendAt > Date.now() ? ` · próximo envio ~${new Date(c.nextSendAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
  $("#prStatus").innerHTML = `Hoje: <b>${c.sentToday}/${c.limit}</b> abordagens · Na fila: <b>${c.queue}</b> empresas · ${c.inWindow ? "dentro do horário" : "fora do horário de envio"}${next}<br>${esc(c.lastEvent)}`;
  $("#prCampaign").elements.campaign_active.checked = c.active;
}
$("#btnProspect").addEventListener("click", async () => {
  const [s, c] = await Promise.all([api("/api/settings"), api("/api/campaign")]);
  for (const el of $("#prCampaign").elements) if (el.name && el.type !== "checkbox") el.value = s[el.name] ?? "";
  renderCampaign(c);
  $("#prDialog").showModal();
});
$("#prClose").addEventListener("click", () => $("#prDialog").close());
$("#prSearch").addEventListener("submit", (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  $("#prResult").textContent = "Buscando… pode levar alguns minutos com muitos bairros.";
  busyButton($("#prSearchBtn"), "Buscando…", async () => {
    try {
      const r = await api("/api/prospect/search", { method: "POST", body });
      $("#prResult").textContent = `${r.found} encontradas · ${r.added} novas no CRM · ${r.duplicates} já existiam · ${r.withoutPhone} sem telefone`;
      renderCampaign(await api("/api/campaign"));
      loadLeads();
    } catch (err) {
      $("#prResult").textContent = err.message;
    }
  });
});
$("#prCampaign").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  body.campaign_active = e.target.elements.campaign_active.checked ? "1" : "0";
  renderCampaign(await api("/api/campaign", { method: "PUT", body }));
});

// ---------- Novo lead ----------
$("#btnNew").addEventListener("click", () => {
  $("#newForm").reset();
  $("#newDialog").showModal();
});
$("#newDialog").addEventListener("close", async () => {
  if ($("#newDialog").returnValue !== "ok") return;
  const fd = new FormData($("#newForm"));
  const body = Object.fromEntries(fd);
  body.start_ai = fd.has("start_ai");
  try {
    const { lead, created } = await api("/api/leads", { method: "POST", body });
    if (!created) alert("Já existe um lead com esse telefone — abrindo ele.");
    await loadLeads();
    openLead(lead.id);
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Configurações ----------
$("#btnSettings").addEventListener("click", async () => {
  const s = await api("/api/settings");
  for (const el of $("#setForm").elements) if (el.name) el.value = s[el.name] ?? "";
  $("#setDialog").showModal();
});
$("#setDialog").addEventListener("close", async () => {
  if ($("#setDialog").returnValue !== "ok") return;
  await api("/api/settings", { method: "PUT", body: Object.fromEntries(new FormData($("#setForm"))) });
});

// ---------- Tempo real ----------
let reloadTimer;
const events = new EventSource("/api/events");
events.addEventListener("change", (e) => {
  const { leadId } = JSON.parse(e.data);
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadLeads, 200);
  if (leadId === state.current) refreshLead();
});
events.addEventListener("whatsapp", (e) => { if ($("#waDialog").open) renderWa({ mode: "qr", ...JSON.parse(e.data) }); loadStatus(); });
events.addEventListener("campaign", (e) => { if ($("#prDialog").open) renderCampaign(JSON.parse(e.data)); });
events.addEventListener("typing", (e) => {
  const { leadId, typing } = JSON.parse(e.data);
  if (leadId === state.current) $("#dTyping").classList.toggle("hidden", !typing);
});

loadStatus();
loadLeads();
