// Enriquecimento de prospects com dados públicos da própria empresa:
//  1) abre o site da clínica e procura CNPJ e o Instagram da clínica;
//  2) consulta o CNPJ na base pública da Receita (via BrasilAPI) e traz sócios e telefone cadastrado da empresa.
import { updateLead, normalizePhone } from "./db.js";

const UA = "Mozilla/5.0 (compatible; CRM-Leads/1.0)";

function validCnpj(raw) {
  const c = String(raw).replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((acc, wi, i) => acc + Number(c[i]) * wi, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

const IG_IGNORE = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "share", "direct"]);

async function fetchText(url, ms = 12000) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).slice(0, 2_000_000);
}

/** Procura CNPJ e @ do Instagram no HTML do site da empresa. */
export async function scanWebsite(url) {
  const out = { cnpj: null, instagram: null };
  if (!url) return out;
  const html = await fetchText(url);
  for (const m of html.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)) {
    if (validCnpj(m[0])) { out.cnpj = m[0].replace(/\D/g, ""); break; }
  }
  for (const m of html.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/gi)) {
    const handle = m[1].replace(/\.$/, "");
    if (!IG_IGNORE.has(handle.toLowerCase())) { out.instagram = handle; break; }
  }
  return out;
}

/** Consulta dados públicos do CNPJ (razão social, sócios, telefone e e-mail cadastrados). */
export async function lookupCnpj(cnpj) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Consulta CNPJ HTTP ${res.status}`);
  const d = await res.json();
  const phones = [d.ddd_telefone_1, d.ddd_telefone_2].map((p) => String(p || "").replace(/\D/g, "")).filter((p) => p.length >= 10);
  return {
    razao_social: d.razao_social || null,
    situacao: d.descricao_situacao_cadastral || null,
    socios: (d.qsa || []).map((s) => s.nome_socio).filter(Boolean),
    phones: phones.map(normalizePhone),
    email: d.email ? String(d.email).toLowerCase() : null,
  };
}

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Enriquece um lead e salva. Nunca lança erro: devolve um resumo do que achou. */
export async function enrichLead(lead) {
  const found = [];
  const patch = {};
  let site = { cnpj: lead.cnpj || null, instagram: lead.instagram || null };
  try {
    if (lead.website) site = { ...site, ...Object.fromEntries(Object.entries(await scanWebsite(lead.website)).filter(([, v]) => v)) };
  } catch (e) {
    found.push(`site indisponível (${e.message})`);
  }
  if (site.instagram && !lead.instagram) { patch.instagram = site.instagram; found.push(`Instagram @${site.instagram}`); }
  if (site.cnpj && !lead.cnpj) { patch.cnpj = site.cnpj; found.push(`CNPJ ${site.cnpj}`); }

  if (site.cnpj) {
    try {
      const c = await lookupCnpj(site.cnpj);
      if (c.socios.length) { patch.owners = c.socios.map(titleCase).join(", "); found.push(`sócios: ${patch.owners}`); }
      const alt = c.phones.find((p) => p !== lead.phone);
      if (alt) { patch.alt_phone = alt; found.push(`telefone do CNPJ ${alt}`); }
      if (c.email && !lead.email) patch.email = c.email;
      if (c.situacao && c.situacao !== "ATIVA") found.push(`situação no CNPJ: ${c.situacao}`);
    } catch (e) {
      found.push(`consulta do CNPJ falhou (${e.message})`);
    }
  }
  patch.enriched_at = new Date().toISOString().slice(0, 19).replace("T", " ");
  updateLead(lead.id, patch);
  return found.length ? found.join(" · ") : "nada encontrado no site";
}
