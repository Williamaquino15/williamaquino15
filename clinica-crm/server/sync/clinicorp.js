// Integração com a API oficial do Clinicorp (https://sistema.clinicorp.com/api-docs/).
// Autenticação HTTP Basic: usuário = "Usuário API", senha = "Token API"
// (Clinicorp › Gerenciar Assinatura › Acesso Externo e Integrações).
// Variáveis do servidor: CLINICORP_USER, CLINICORP_TOKEN e, se diferente do usuário, CLINICORP_SUBSCRIBER_ID.
const { digits } = require('../util');

const BASE = () => (process.env.CLINICORP_API_URL || 'https://api.clinicorp.com/rest/v1').replace(/\/$/, '');
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };

function config() {
  const user = process.env.CLINICORP_USER;
  const token = process.env.CLINICORP_TOKEN;
  if (!user || !token) throw new Error('Integração sem credenciais: configure CLINICORP_USER e CLINICORP_TOKEN nas variáveis do servidor');
  return { user, token, subscriber: process.env.CLINICORP_SUBSCRIBER_ID || user };
}
const configured = () => !!(process.env.CLINICORP_USER && process.env.CLINICORP_TOKEN);

async function get(path, params = {}) {
  const { user, token, subscriber } = config();
  const qs = new URLSearchParams(Object.entries({ subscriber_id: subscriber, ...params }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const res = await fetch(`${BASE()}${path}?${qs}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64'), Accept: 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = (body && body.message) || String(text).slice(0, 200);
    if (res.status === 401 || res.status === 403) throw new Error(`O Clinicorp recusou o acesso (${res.status}): confira o Usuário API e o Token API. ${msg}`);
    throw new Error(`Erro do Clinicorp em ${path} (${res.status}): ${msg}`);
  }
  return body;
}
const asList = (b) => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : Array.isArray(b?.list) ? b.list : []);

// Períodos de até 31 dias (limite da API).
function chunks(from, to, size = 31) {
  const out = [];
  for (let a = from; a <= to; a = addDays(a, size)) {
    const b = addDays(a, size - 1);
    out.push([a, b < to ? b : to]);
  }
  return out;
}

// Status do agendamento do Clinicorp → status do CRM.
function apptStatusMapper(statusList) {
  const byId = new Map(asList(statusList).map((s) => [String(s.id), s]));
  return (a) => {
    if (a.Canceled === 'X' || a.Deleted === 'X') return 'Desmarcado';
    const s = byId.get(String(a.StatusId));
    const t = `${s?.Type || ''} ${s?.Description || ''}`.toLowerCase();
    if (/attend|finish|complet|present|arriv|atend|compareceu|finaliz|chegou|presen|conclu/.test(t)) return 'Compareceu';
    if (/miss|absen|no_show|falt/.test(t)) return 'Faltou';
    if (/cancel|desmarc/.test(t)) return 'Desmarcado';
    if (/resched|remarc/.test(t)) return 'Remarcado';
    if (/confirm/.test(t)) return 'Confirmado';
    return 'Agendado';
  };
}
const ESTIMATE_STATUS = { OPEN: 'Em Aberto', APPROVED: 'Fechado', REJECTED: 'Reprovado', REJECTED_OPPORTUNITY: 'Reprovado', FOLLOWUP: 'Em Acompanhamento' };

// Data local (Brasília) a partir de uma data UTC da API.
function localDate(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
const atomicDate = (n) => (n ? `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}` : null);

// Lê o Clinicorp e devolve o lote no formato comum da sincronização.
async function fetchAll({ since } = {}) {
  config();
  const today = iso(new Date());
  const from = since ? addDays(String(since).slice(0, 10), -3) : addDays(today, -365);
  const until = addDays(today, 90);

  const statusOf = apptStatusMapper(await get('/appointment/status_list').catch(() => []));
  const profs = new Map(asList(await get('/professional/list_all_professionals').catch(() => []))
    .map((p) => [String(p.id ?? p.PersonId ?? p.Dentist_PersonId), p.Name || p.name || p.FullName]));

  const pacientes = new Map();
  const addPatient = (id, nome, telefone, tipo) => {
    const cur = pacientes.get(id);
    if (!cur) pacientes.set(id, { id, nome, telefone, tipo });
    else if (tipo === 'cliente') cur.tipo = 'cliente';
  };
  const agendamentos = [];
  for (const [a, b] of chunks(from, until)) {
    for (const it of asList(await get('/appointment/list', { from: a, to: b, includeCanceled: 'X' }))) {
      if (it.ItemType && it.ItemType !== 'APPOINTMENT') continue;
      const phone = digits(it.MobilePhone);
      const pid = it.PatientId ?? it.Patient_PersonId ?? it.PersonId;
      const key = pid != null ? String(pid) : phone ? `tel:${phone}` : `nome:${String(it.PatientName || '').trim().toLowerCase()}`;
      if (!it.PatientName && pid == null) continue;
      const status = statusOf(it);
      addPatient(key, it.PatientName, it.MobilePhone, status === 'Compareceu' ? 'cliente' : 'lead');
      agendamentos.push({
        id: it.id, paciente_id: key, data: localDate(it.date) || atomicDate(it.AtomicDate), inicio: it.fromTime, fim: it.toTime,
        profissional: profs.get(String(it.Dentist_PersonId)) || null, status, descricao: it.Notes || null,
      });
    }
  }

  const orcamentos = [];
  for (const [a, b] of chunks(from, until)) {
    for (const e of asList(await get('/estimates/list', { from: a, to: b }))) {
      if (e.PatientId == null) continue;
      addPatient(String(e.PatientId), e.PatientName, e.PatientMobilePhone, 'cliente');
      const procs = (e.ProcedureList || []).filter((p) => p.Deleted !== 'X');
      const amount = Number(e.Amount) || 0;
      orcamentos.push({
        id: e.TreatmentId ?? e.id, paciente_id: String(e.PatientId), data: localDate(e.CreateDate || e.Date),
        data_aprovacao: localDate(e.ApprovedDate), status: ESTIMATE_STATUS[e.Status] || 'Em Aberto',
        avaliador: e.ProfessionalName || null, tratamento: procs[0]?.OperationDescription || null,
        valor_orcado: amount + (Number(e.DiscountAmount) || 0), valor_fechado: e.Status === 'APPROVED' ? amount : 0,
      });
    }
  }
  return { pacientes: [...pacientes.values()], agendamentos, orcamentos };
}

// Botão "Testar acesso": confirma que usuário e token funcionam.
async function testLogin() {
  const clinics = asList(await get('/business/list'));
  return { ok: true, clinicas: clinics.map((c) => c.BusinessName || c.Name).filter(Boolean) };
}

module.exports = { fetchAll, testLogin, configured };
