// Servidor HTTP: autenticação, permissões e API REST.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, hashPassword, checkPassword, getSetting, setSetting } = require('./db');
const { now, today, digits, toArr, toIntArr, parseJSON, pick } = require('./util');
const reports = require('./reports');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.set('trust proxy', 1);
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------- auth
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1`).get(token) || null;
}
const publicUser = (u) => u && pick(u, ['id', 'name', 'email', 'active', 'p_admin', 'p_leads', 'p_clientes', 'p_dashboard', 'p_financeiro', 'p_aulas', 'created_at']);

function auth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Não autenticado' });
  req.user = u;
  next();
}
// Permissões por chave; administrador tem acesso total.
const need = (perm) => (req, res, next) => {
  if (req.user.p_admin || req.user[`p_${perm}`]) return next();
  res.status(403).json({ error: 'Sem permissão para esta área' });
};
const admin = need('admin');

// Encapsula handlers síncronos e devolve erros como JSON.
const h = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Erro interno' });
  }
};
const fail = (status, message) => Object.assign(new Error(message), { status });

function audit(userId, entity, entityId, action, field = null, oldV = null, newV = null) {
  db.prepare('INSERT INTO audit(user_id,entity,entity_id,action,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)')
    .run(userId, entity, entityId, action, field, oldV == null ? null : String(oldV), newV == null ? null : String(newV));
}

// UPDATE genérico com lista de colunas permitidas.
function update(table, id, data, cols) {
  const d = pick(data, cols);
  const keys = Object.keys(d);
  if (!keys.length) return;
  for (const k of keys) if (Array.isArray(d[k])) d[k] = JSON.stringify(d[k]);
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run({ ...d, id });
}
function insert(table, data, cols) {
  const d = pick(data, cols);
  for (const k of Object.keys(d)) if (Array.isArray(d[k])) d[k] = JSON.stringify(d[k]);
  const keys = Object.keys(d);
  const info = db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((k) => '@' + k).join(',')})`).run(d);
  return info.lastInsertRowid;
}

app.post('/api/login', h((req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(String(email || '').trim());
  if (!u || !checkPassword(password || '', u.pass)) throw fail(401, 'E-mail ou senha inválidos');
  if (!u.active) throw fail(403, 'Usuário desativado');
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(token, u.id);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return { user: publicUser(u) };
}));
app.post('/api/logout', h((req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  return { ok: true };
}));

app.use('/api', auth);

// ---------------------------------------------------------------- boot / perfil
app.get('/api/boot', h((req) => ({
  user: publicUser(req.user),
  lists: db.prepare('SELECT * FROM lists ORDER BY type, sort, name').all(),
  users: db.prepare('SELECT id,name,active FROM users ORDER BY name').all(),
  campaigns: db.prepare('SELECT id,nome,cor FROM campaigns ORDER BY id DESC').all(),
  templates: db.prepare('SELECT * FROM templates ORDER BY nome').all(),
  chips: db.prepare('SELECT * FROM chips ORDER BY id').all(),
  clinica: getSetting('clinica', {}),
  leadSettings: getSetting('leads', {}),
})));

app.put('/api/me', h((req) => {
  const { name, email, senha_atual, senha_nova } = req.body;
  if (name || email) {
    update('users', req.user.id, { name: name || req.user.name, email: email || req.user.email }, ['name', 'email']);
  }
  if (senha_nova) {
    if (!checkPassword(senha_atual || '', req.user.pass)) throw fail(400, 'Senha atual incorreta');
    if (String(senha_nova).length < 6) throw fail(400, 'A nova senha deve ter ao menos 6 caracteres');
    db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPassword(senha_nova), req.user.id);
  }
  return { ok: true };
}));

// ---------------------------------------------------------------- listas
app.get('/api/lists', h(() => db.prepare('SELECT * FROM lists ORDER BY type, sort, name').all()));
// Etiquetas podem ser criadas por qualquer usuário (ficha do lead); demais listas só pelo administrador.
app.post('/api/lists', (req, res, next) => (req.body?.type === 'etiqueta' ? next() : admin(req, res, next)), h((req) => {
  const { type, name } = req.body;
  if (!type || !name) throw fail(400, 'Tipo e nome são obrigatórios');
  const id = insert('lists', { ...req.body, state: req.body.state || 'ativo' }, ['type', 'name', 'state', 'grupo', 'color', 'sort']);
  return db.prepare('SELECT * FROM lists WHERE id=?').get(id);
}));
app.put('/api/lists/:id', admin, h((req) => {
  update('lists', +req.params.id, req.body, ['name', 'state', 'grupo', 'color', 'sort']);
  return db.prepare('SELECT * FROM lists WHERE id=?').get(+req.params.id);
}));
app.post('/api/lists/move', admin, h((req) => {
  const { ids, grupo, state } = req.body;
  const stmt = db.prepare(`UPDATE lists SET ${grupo !== undefined ? 'grupo=@grupo' : 'state=@state'} WHERE id=@id`);
  db.transaction(() => toIntArr(ids).forEach((id) => stmt.run({ id, grupo, state })))();
  return { ok: true };
}));
app.delete('/api/lists/:id', admin, h((req) => {
  const it = db.prepare('SELECT * FROM lists WHERE id=?').get(+req.params.id);
  if (!it) throw fail(404, 'Item não encontrado');
  if (it.state === 'padrao') throw fail(400, 'Itens padrão não podem ser excluídos; desative-os');
  db.prepare('UPDATE lists SET state=? WHERE id=?').run('desativado', it.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- leads
const LEAD_COLS = ['created_at', 'name', 'ddi', 'phone', 'phone_entrada', 'origem_id', 'temperatura', 'status_id',
  'campanha_id', 'proximo_contato', 'anotacoes', 'tags', 'indicacao', 'ultimo_contato'];

const LEAD_SELECT = `
  SELECT l.*, a.date ag_data, a.start ag_hora, a.status ag_status,
    (SELECT COUNT(*) FROM contacts c WHERE c.lead_id=l.id AND c.tipo='Chamada Telefônica') ligacoes,
    (SELECT COUNT(*) FROM leads l2 WHERE l2.phone=l.phone AND l2.phone<>'' AND l2.deleted_at IS NULL) dup
  FROM leads l
  LEFT JOIN appointments a ON a.id=(SELECT id FROM appointments WHERE lead_id=l.id AND bloqueio=0 ORDER BY date DESC, start DESC LIMIT 1)`;

function leadWhere(q) {
  const w = ['l.deleted_at IS NULL'];
  const p = {};
  if (q.q) {
    const term = String(q.q).trim().slice(0, 50);
    p.q = `%${term}%`;
    p.qd = digits(term) ? `%${digits(term)}%` : '__none__';
    p.qid = Number(term) || -1;
    w.push(`(l.name LIKE @q OR l.phone LIKE @qd OR l.id=@qid OR l.client_id=@qid)`);
  }
  if (q.name) { p.name = `%${q.name}%`; w.push('l.name LIKE @name'); }
  if (q.phone) { p.phone = `%${digits(q.phone)}%`; w.push('l.phone LIKE @phone'); }
  if (q.inc_de) { p.inc_de = q.inc_de; w.push('substr(l.created_at,1,10)>=@inc_de'); }
  if (q.inc_ate) { p.inc_ate = q.inc_ate; w.push('substr(l.created_at,1,10)<=@inc_ate'); }
  if (q.ag_de) { p.ag_de = q.ag_de; w.push('a.date>=@ag_de'); }
  if (q.ag_ate) { p.ag_ate = q.ag_ate; w.push('a.date<=@ag_ate'); }
  if (q.anotacoes) { p.an = `%${q.anotacoes}%`; w.push('l.anotacoes LIKE @an'); }
  const inList = (col, vals, key) => {
    if (!vals.length) return;
    const names = vals.map((v, i) => { p[`${key}${i}`] = v; return `@${key}${i}`; });
    w.push(`${col} IN (${names.join(',')})`);
  };
  inList('l.origem_id', toIntArr(q.origem), 'or');
  inList('l.status_id', toIntArr(q.status), 'st');
  inList('l.temperatura', toArr(q.temperatura), 'tp');
  inList('a.status', toArr(q.ag_status), 'as');
  inList('l.campanha_id', toIntArr(q.campanha), 'cp');
  const tags = toIntArr(q.etiquetas);
  if (tags.length) w.push(`EXISTS (SELECT 1 FROM json_each(l.tags) WHERE value IN (${tags.join(',')}))`);
  if (q.com_tel === '1') w.push("l.phone<>''");
  if (q.sem_tel === '1') w.push("(l.phone IS NULL OR l.phone='')");
  if (q.repetidos === '1') w.push("(SELECT COUNT(*) FROM leads l3 WHERE l3.phone=l.phone AND l3.phone<>'' AND l3.deleted_at IS NULL)>1");
  return { where: w.join(' AND '), params: p };
}
const listLeads = (q, extra = '', order = 'l.id DESC') => {
  const { where, params } = leadWhere(q);
  return db.prepare(`${LEAD_SELECT} WHERE ${where} ${extra} ORDER BY ${order}`).all(params)
    .map((r) => ({ ...r, tags: parseJSON(r.tags, []) }));
};

app.get('/api/leads', need('leads'), h((req) => listLeads(req.query)));
app.get('/api/leads/proximos', need('leads'), h((req) =>
  listLeads(req.query, "AND l.proximo_contato IS NOT NULL AND l.proximo_contato<>''", 'l.proximo_contato ASC')));
app.get('/api/leads/deleted', need('leads'), h(() =>
  db.prepare('SELECT id,name,phone,ddi,delete_reason,deleted_at FROM leads WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all()));
app.post('/api/leads/restore', need('leads'), h((req) => {
  const stmt = db.prepare('UPDATE leads SET deleted_at=NULL, delete_reason=NULL WHERE id=?');
  db.transaction(() => toIntArr(req.body.ids).forEach((id) => { stmt.run(id); audit(req.user.id, 'lead', id, 'restore'); }))();
  return { ok: true };
}));
app.get('/api/leads/check', need('leads'), h((req) => {
  const ph = digits(req.query.phone);
  const name = String(req.query.name || '').trim();
  return db.prepare(`SELECT id,name,phone,created_at,client_id FROM leads WHERE deleted_at IS NULL
    AND ((@ph<>'' AND phone=@ph) OR (@name<>'' AND name LIKE @like)) LIMIT 20`).all({ ph, name, like: `%${name}%` });
}));

function validateLead(d, id = null) {
  const cfg = getSetting('leads', {});
  if (!String(d.name || '').trim()) throw fail(400, 'Nome é obrigatório');
  if (cfg.telefone_obrigatorio && !digits(d.phone)) throw fail(400, 'Telefone é obrigatório');
  if (cfg.repetir_nome === false) {
    const ex = db.prepare('SELECT id FROM leads WHERE deleted_at IS NULL AND lower(name)=lower(?) AND id<>?').get(d.name.trim(), id || 0);
    if (ex) throw fail(400, `Já existe um lead com este nome (ID ${ex.id})`);
  }
}

function createLead(data, userId) {
  const d = { ...data };
  d.phone = digits(d.phone);
  d.created_at = d.created_at || now();
  if (!d.tags) d.tags = [];
  d.created_by = userId;
  const id = insert('leads', d, [...LEAD_COLS, 'created_by']);
  audit(userId, 'lead', id, 'create');
  return id;
}

app.post('/api/leads', need('leads'), h((req) => {
  const d = req.body;
  validateLead(d);
  // Telefone já cadastrado: o cliente pode optar por "reaquecer" o lead existente.
  const ph = digits(d.phone);
  if (ph && !d.force) {
    const ex = db.prepare('SELECT id,name FROM leads WHERE phone=? AND deleted_at IS NULL').get(ph);
    if (ex) {
      if (d.reaquecer) {
        db.prepare('INSERT INTO reheats(lead_id,origem_id) VALUES(?,?)').run(ex.id, d.origem_id || null);
        update('leads', ex.id, { updated_at: now(), updated_by: req.user.id, ...(d.origem_id ? { origem_id: d.origem_id } : {}) },
          ['updated_at', 'updated_by', 'origem_id']);
        audit(req.user.id, 'lead', ex.id, 'reheat');
        return { id: ex.id, reaquecido: true };
      }
      return { duplicate: ex };
    }
  }
  return { id: createLead(d, req.user.id) };
}));

app.post('/api/leads/import', need('leads'), h((req) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const lists = db.prepare("SELECT id,type,name FROM lists").all();
  const find = (type, name) => {
    if (!name) return null;
    const hit = lists.find((l) => l.type === type && l.name.toLowerCase() === String(name).trim().toLowerCase());
    if (hit) return hit.id;
    const id = insert('lists', { type, name: String(name).trim(), state: 'ativo' }, ['type', 'name', 'state']);
    lists.push({ id, type, name: String(name).trim() });
    return id;
  };
  let ok = 0; const errors = [];
  db.transaction(() => rows.forEach((r, i) => {
    try {
      if (!String(r.nome || r.name || '').trim()) throw new Error('sem nome');
      createLead({
        name: String(r.nome || r.name).trim(), phone: r.telefone || r.phone || '',
        origem_id: find('origem', r.origem), status_id: find('status', r.status),
        temperatura: r.temperatura || null, anotacoes: r.anotacoes || null,
        created_at: r.inclusao || r.data || undefined, proximo_contato: r.proximo_contato || null,
      }, req.user.id);
      ok++;
    } catch (e) { errors.push(`Linha ${i + 2}: ${e.message}`); }
  }))();
  return { ok, errors };
}));

app.post('/api/leads/bulk', need('leads'), h((req) => {
  const { ids, all, filter, action, data, reason } = req.body;
  const target = all ? listLeads(filter || {}).map((l) => l.id) : toIntArr(ids);
  db.transaction(() => target.forEach((id) => {
    if (action === 'delete') {
      db.prepare('UPDATE leads SET deleted_at=?, delete_reason=? WHERE id=?').run(now(), reason || 'Exclusão em massa', id);
      audit(req.user.id, 'lead', id, 'delete');
    } else if (action === 'edit') {
      const clean = Object.fromEntries(Object.entries(pick(data || {}, ['origem_id', 'temperatura', 'status_id', 'campanha_id', 'proximo_contato']))
        .filter(([, v]) => v !== '' && v != null));
      if (data && Array.isArray(data.add_tags) && data.add_tags.length) {
        const cur = parseJSON(db.prepare('SELECT tags FROM leads WHERE id=?').get(id).tags, []);
        clean.tags = [...new Set([...cur, ...data.add_tags.map(Number)])];
      }
      update('leads', id, { ...clean, updated_at: now(), updated_by: req.user.id }, [...LEAD_COLS, 'updated_at', 'updated_by']);
      audit(req.user.id, 'lead', id, 'update');
    }
  }))();
  return { count: target.length };
}));

function leadDetail(id) {
  const lead = db.prepare(`${LEAD_SELECT} WHERE l.id=?`).get(id);
  if (!lead) throw fail(404, 'Lead não encontrado');
  lead.tags = parseJSON(lead.tags, []);
  return {
    lead,
    appointments: db.prepare('SELECT * FROM appointments WHERE lead_id=? ORDER BY date DESC, start DESC').all(id),
    contacts: db.prepare('SELECT * FROM contacts WHERE lead_id=? ORDER BY date DESC, id DESC').all(id),
    messages: db.prepare('SELECT * FROM messages WHERE lead_id=? ORDER BY created_at, id').all(id),
    cadences: db.prepare('SELECT * FROM cadences WHERE lead_id=? ORDER BY id DESC').all(id),
    reheats: db.prepare('SELECT * FROM reheats WHERE lead_id=? ORDER BY id DESC').all(id),
  };
}
app.get('/api/leads/:id', need('leads'), h((req) => leadDetail(+req.params.id)));

app.put('/api/leads/:id', need('leads'), h((req) => {
  const id = +req.params.id;
  const old = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
  if (!old) throw fail(404, 'Lead não encontrado');
  const d = { ...req.body };
  if (d.phone !== undefined) d.phone = digits(d.phone);
  if (d.name !== undefined || d.phone !== undefined) validateLead({ name: d.name ?? old.name, phone: d.phone ?? old.phone }, id);
  for (const f of ['status_id', 'temperatura', 'origem_id']) {
    if (d[f] !== undefined && String(d[f] ?? '') !== String(old[f] ?? '')) audit(req.user.id, 'lead', id, 'field', f, old[f], d[f]);
  }
  update('leads', id, { ...d, updated_at: now(), updated_by: req.user.id }, [...LEAD_COLS, 'updated_at', 'updated_by']);
  audit(req.user.id, 'lead', id, 'update');
  return leadDetail(id);
}));

app.delete('/api/leads/:id', need('leads'), h((req) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) throw fail(400, 'Informe o motivo da exclusão');
  db.prepare('UPDATE leads SET deleted_at=?, delete_reason=? WHERE id=?').run(now(), reason, +req.params.id);
  audit(req.user.id, 'lead', +req.params.id, 'delete');
  return { ok: true };
}));

// Conversa (WhatsApp / ligação) registrada localmente.
app.post('/api/leads/:id/messages', need('leads'), h((req) => {
  const id = +req.params.id;
  const { content, chip, template_id, direction, kind } = req.body;
  let text = content;
  if (template_id) {
    const t = db.prepare('SELECT * FROM templates WHERE id=?').get(template_id);
    const lead = db.prepare('SELECT name FROM leads WHERE id=?').get(id);
    if (t) text = String(t.conteudo || '').replace(/\{\{nome\}\}/g, lead?.name || '');
  }
  if (!String(text || '').trim()) throw fail(400, 'Mensagem vazia');
  insert('messages', { lead_id: id, chip: chip || 1, content: text, template_id: template_id || null,
    direction: direction || 'out', kind: kind || 'text', user_id: req.user.id }, ['lead_id', 'chip', 'content', 'template_id', 'direction', 'kind', 'user_id']);
  db.prepare('UPDATE leads SET ultimo_contato=? WHERE id=?').run(now(), id);
  return leadDetail(id);
}));
app.delete('/api/leads/:id/messages', need('leads'), h((req) => {
  db.prepare('DELETE FROM messages WHERE lead_id=?').run(+req.params.id);
  return leadDetail(+req.params.id);
}));
app.post('/api/leads/:id/ia', need('leads'), h((req) => {
  const id = +req.params.id;
  const paused = !!req.body.pause;
  db.prepare('UPDATE leads SET ia_pausada_por=? WHERE id=?').run(paused ? req.user.id : null, id);
  if (paused) db.prepare('INSERT INTO ia_interactions(lead_id) VALUES(?)').run(id);
  return leadDetail(id);
}));

// Cadências (Limbo 1 / Limbo 2)
app.post('/api/leads/:id/cadences', need('leads'), h((req) => {
  const id = +req.params.id;
  const { limbo, inicio, obs } = req.body;
  if (![1, 2].includes(+limbo)) throw fail(400, 'Cadência inválida');
  insert('cadences', { lead_id: id, limbo: +limbo, inicio: inicio || now(), user_id: req.user.id, status: 'Em execução', obs },
    ['lead_id', 'limbo', 'inicio', 'user_id', 'status', 'obs']);
  return leadDetail(id);
}));
app.post('/api/leads/:id/cadences/reset', need('leads'), h((req) => {
  db.prepare("UPDATE cadences SET status='Cancelada', termino=? WHERE lead_id=? AND status IN ('Em execução','Agendada')").run(now(), +req.params.id);
  return leadDetail(+req.params.id);
}));

// ---------------------------------------------------------------- agendamentos
const APPT_COLS = ['lead_id', 'date', 'start', 'end', 'profissional_id', 'status', 'descricao', 'origem', 'envio',
  'integracao_erro', 'confirmado_ia', 'bloqueio'];

// Comparecimento transforma o lead em cliente (paciente).
function ensureClientFromLead(leadId, userId, dataComparecimento) {
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(leadId);
  if (!lead) return null;
  if (lead.client_id) {
    db.prepare('UPDATE clients SET data_comparecimento=COALESCE(data_comparecimento,?), ultima_consulta=? WHERE id=?')
      .run(dataComparecimento, dataComparecimento, lead.client_id);
    return lead.client_id;
  }
  const cid = insert('clients', {
    lead_id: lead.id, created_at: now(), name: lead.name, ddi: lead.ddi, phone: lead.phone,
    data_lead: lead.created_at, data_comparecimento: dataComparecimento, ultima_consulta: dataComparecimento,
    origem_id: lead.origem_id, responsavel_id: userId, tags: lead.tags, campanha_id: lead.campanha_id, anotacoes: lead.anotacoes,
  }, ['lead_id', 'created_at', 'name', 'ddi', 'phone', 'data_lead', 'data_comparecimento', 'ultima_consulta', 'origem_id',
    'responsavel_id', 'tags', 'campanha_id', 'anotacoes']);
  db.prepare('UPDATE leads SET client_id=? WHERE id=?').run(cid, lead.id);
  audit(userId, 'client', cid, 'create');
  return cid;
}
function onApptStatus(appt, oldStatus, userId) {
  if (appt.status === oldStatus || !appt.lead_id) return;
  if (appt.status === 'Compareceu') { audit(userId, 'appointment', appt.id, 'compareceu'); ensureClientFromLead(appt.lead_id, userId, appt.date); }
  if (appt.status === 'Faltou') audit(userId, 'appointment', appt.id, 'faltou');
}

app.get('/api/appointments', h((req) => {
  const { from, to } = req.query;
  return db.prepare(`SELECT a.*, l.name lead_name, l.phone, l.ddi, l.origem_id FROM appointments a
    LEFT JOIN leads l ON l.id=a.lead_id WHERE a.date>=? AND a.date<=? ORDER BY a.date, a.start`).all(from || '0000', to || '9999');
}));
app.post('/api/appointments', h((req) => {
  const d = req.body;
  if (!d.date) throw fail(400, 'Informe a data do agendamento');
  if (!d.start) throw fail(400, 'Informe o horário inicial');
  if (!d.end) {
    const dur = getSetting('leads', {}).duracao_agendamento || 30;
    const [hh, mm] = d.start.split(':').map(Number);
    const t = hh * 60 + mm + dur;
    d.end = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }
  const id = insert('appointments', { ...d, status: d.status || 'Agendado', created_by: req.user.id }, [...APPT_COLS, 'created_by']);
  audit(req.user.id, 'appointment', id, 'create');
  if (d.lead_id) {
    const st = db.prepare("SELECT id FROM lists WHERE type='status' AND name='Agendado'").get();
    if (st) db.prepare('UPDATE leads SET status_id=? WHERE id=?').run(st.id, d.lead_id);
  }
  const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  onApptStatus(appt, 'Agendado', req.user.id);
  return appt;
}));
app.put('/api/appointments/:id', h((req) => {
  const id = +req.params.id;
  const old = db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  if (!old) throw fail(404, 'Agendamento não encontrado');
  update('appointments', id, { ...req.body, updated_by: req.user.id, updated_at: now() }, [...APPT_COLS, 'updated_by', 'updated_at']);
  const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  onApptStatus(appt, old.status, req.user.id);
  return appt;
}));
app.delete('/api/appointments/:id', h((req) => {
  db.prepare('DELETE FROM appointments WHERE id=?').run(+req.params.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- contatos
app.post('/api/contacts', h((req) => {
  const d = req.body;
  if (!d.tipo) throw fail(400, 'Informe o tipo de contato');
  const id = insert('contacts', { ...d, date: d.date || now(), user_id: req.user.id }, ['lead_id', 'client_id', 'date', 'tipo', 'obs', 'call_center', 'user_id']);
  audit(req.user.id, 'contact', id, 'contact');
  if (d.lead_id) db.prepare('UPDATE leads SET ultimo_contato=? WHERE id=?').run(d.date || now(), d.lead_id);
  if (d.client_id) db.prepare('UPDATE clients SET ultimo_contato=?, tentativas=tentativas+1 WHERE id=?').run(d.date || now(), d.client_id);
  return { id };
}));
app.delete('/api/contacts/:id', h((req) => { db.prepare('DELETE FROM contacts WHERE id=?').run(+req.params.id); return { ok: true }; }));

// ---------------------------------------------------------------- clientes
const CLIENT_COLS = ['created_at', 'name', 'ddi', 'phone', 'profissao', 'sintomas', 'data_lead', 'data_comparecimento',
  'ultima_consulta', 'origem_id', 'responsavel_id', 'fase_id', 'situacao', 'prob_fechamento', 'proximo_contato',
  'ultimo_contato', 'tentativas', 'anotacoes', 'tags', 'campanha_id'];

const CLIENT_SELECT = `
  SELECT c.*,
    (SELECT COALESCE(SUM(valor_orcado),0) FROM budgets b WHERE b.client_id=c.id) valor_orcado,
    (SELECT COALESCE(SUM(valor_fechado),0) FROM budgets b WHERE b.client_id=c.id AND b.status='Fechado') valor_fechado,
    (SELECT MIN(data_fechamento) FROM budgets b WHERE b.client_id=c.id AND b.status='Fechado') primeiro_fechamento,
    (SELECT group_concat(DISTINCT tratamento_id) FROM budgets b WHERE b.client_id=c.id) tratamentos,
    (SELECT group_concat(DISTINCT avaliador_id) FROM budgets b WHERE b.client_id=c.id) avaliadores,
    (SELECT COUNT(*) FROM clients c2 WHERE c2.phone=c.phone AND c2.phone<>'' AND c2.deleted_at IS NULL) dup
  FROM clients c`;

function clientWhere(q) {
  const w = ['c.deleted_at IS NULL'];
  const p = {};
  if (q.q) {
    const term = String(q.q).trim().slice(0, 50);
    p.q = `%${term}%`; p.qd = digits(term) ? `%${digits(term)}%` : '__none__'; p.qid = Number(term) || -1;
    w.push('(c.name LIKE @q OR c.phone LIKE @qd OR c.id=@qid OR c.lead_id=@qid)');
  }
  if (q.name) { p.name = `%${q.name}%`; w.push('c.name LIKE @name'); }
  if (q.phone) { p.phone = `%${digits(q.phone)}%`; w.push('c.phone LIKE @phone'); }
  const range = (col, de, ate, key) => {
    if (q[de]) { p[key + 'a'] = q[de]; w.push(`substr(${col},1,10)>=@${key}a`); }
    if (q[ate]) { p[key + 'b'] = q[ate]; w.push(`substr(${col},1,10)<=@${key}b`); }
  };
  range('c.created_at', 'reg_de', 'reg_ate', 'rg');
  range('c.proximo_contato', 'prox_de', 'prox_ate', 'px');
  range('c.ultima_consulta', 'cons_de', 'cons_ate', 'uc');
  range('(SELECT MIN(data_fechamento) FROM budgets b WHERE b.client_id=c.id AND b.status=\'Fechado\')', 'fech_de', 'fech_ate', 'pf');
  const inList = (col, vals, key) => {
    if (!vals.length) return;
    w.push(`${col} IN (${vals.map((v, i) => { p[key + i] = v; return '@' + key + i; }).join(',')})`);
  };
  inList('c.fase_id', toIntArr(q.fase), 'fa');
  inList('c.situacao', toArr(q.situacao), 'si');
  inList('c.origem_id', toIntArr(q.origem), 'or');
  inList('c.responsavel_id', toIntArr(q.responsavel), 'rs');
  inList('c.updated_by', toIntArr(q.modificador), 'md');
  const trat = toIntArr(q.tratamento);
  if (trat.length) w.push(`EXISTS (SELECT 1 FROM budgets b WHERE b.client_id=c.id AND b.tratamento_id IN (${trat.join(',')}))`);
  const av = toIntArr(q.avaliador);
  if (av.length) w.push(`EXISTS (SELECT 1 FROM budgets b WHERE b.client_id=c.id AND b.avaliador_id IN (${av.join(',')}))`);
  const tags = toIntArr(q.etiquetas);
  if (tags.length) w.push(`EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value IN (${tags.join(',')}))`);
  if (q.tentativas !== undefined && q.tentativas !== '') { p.tt = +q.tentativas; w.push('c.tentativas=@tt'); }
  if (q.com_tel === '1') w.push("c.phone<>''");
  if (q.sem_tel === '1') w.push("(c.phone IS NULL OR c.phone='')");
  if (q.repetidos === '1') w.push("(SELECT COUNT(*) FROM clients c3 WHERE c3.phone=c.phone AND c3.phone<>'' AND c3.deleted_at IS NULL)>1");
  if (q.parciais === '1') w.push("EXISTS (SELECT 1 FROM budgets b JOIN budget_closings bc ON bc.budget_id=b.id WHERE b.client_id=c.id)");
  if (q.prox_nao_informado === '1') w.push("(c.proximo_contato IS NULL OR c.proximo_contato='')");
  if (q.contatos_dia === '1') { p.hj = today(); w.push('substr(c.proximo_contato,1,10)<=@hj'); }
  return { where: w.join(' AND '), params: p };
}
const listClients = (q) => {
  const { where, params } = clientWhere(q);
  return db.prepare(`${CLIENT_SELECT} WHERE ${where} ORDER BY c.id DESC`).all(params).map((r) => ({
    ...r, tags: parseJSON(r.tags, []),
    tratamentos: r.tratamentos ? r.tratamentos.split(',').map(Number) : [],
    avaliadores: r.avaliadores ? r.avaliadores.split(',').map(Number) : [],
  }));
};

app.get('/api/clients', need('clientes'), h((req) => listClients(req.query)));
app.post('/api/clients', need('clientes'), h((req) => {
  const d = req.body;
  if (!String(d.name || '').trim()) throw fail(400, 'Nome é obrigatório');
  d.phone = digits(d.phone);
  // Cliente retroativo: cria também o lead correspondente para manter o histórico do funil.
  const leadId = createLead({ name: d.name, ddi: d.ddi, phone: d.phone, origem_id: d.origem_id, created_at: d.created_at || now(), anotacoes: d.anotacoes }, req.user.id);
  const id = insert('clients', { ...d, lead_id: leadId, data_lead: d.created_at || now(), created_at: d.created_at || now(),
    ultima_consulta: d.data_comparecimento, responsavel_id: d.responsavel_id || req.user.id, tags: d.tags || [] },
  [...CLIENT_COLS, 'lead_id']);
  db.prepare('UPDATE leads SET client_id=? WHERE id=?').run(id, leadId);
  if (d.data_comparecimento) {
    insert('appointments', { lead_id: leadId, date: d.data_comparecimento.slice(0, 10), start: d.hora_comparecimento || '08:00',
      end: d.hora_comparecimento || '08:30', status: 'Compareceu', created_by: req.user.id }, [...APPT_COLS, 'created_by']);
  }
  audit(req.user.id, 'client', id, 'create');
  return { id };
}));
app.post('/api/clients/import', need('clientes'), h((req) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  let ok = 0; const errors = [];
  db.transaction(() => rows.forEach((r, i) => {
    try {
      const name = String(r.nome || r.name || '').trim();
      if (!name) throw new Error('sem nome');
      const leadId = createLead({ name, phone: r.telefone || r.phone, created_at: r.data_registro || undefined }, req.user.id);
      const id = insert('clients', { lead_id: leadId, name, phone: digits(r.telefone || r.phone), created_at: r.data_registro || now(),
        profissao: r.profissao || null, data_comparecimento: r.data_comparecimento || null, responsavel_id: req.user.id },
      ['lead_id', 'name', 'phone', 'created_at', 'profissao', 'data_comparecimento', 'responsavel_id']);
      db.prepare('UPDATE leads SET client_id=? WHERE id=?').run(id, leadId);
      ok++;
    } catch (e) { errors.push(`Linha ${i + 2}: ${e.message}`); }
  }))();
  return { ok, errors };
}));

function clientDetail(id) {
  const client = db.prepare(`${CLIENT_SELECT} WHERE c.id=?`).get(id);
  if (!client) throw fail(404, 'Cliente não encontrado');
  client.tags = parseJSON(client.tags, []);
  const budgets = db.prepare('SELECT * FROM budgets WHERE client_id=? ORDER BY id DESC').all(id);
  const closings = db.prepare('SELECT bc.* FROM budget_closings bc JOIN budgets b ON b.id=bc.budget_id WHERE b.client_id=? ORDER BY bc.data').all(id);
  return {
    client, budgets, closings,
    activities: db.prepare('SELECT * FROM activities WHERE client_id=? ORDER BY date DESC, id DESC').all(id),
    contacts: db.prepare('SELECT * FROM contacts WHERE client_id=? OR (lead_id=? AND lead_id IS NOT NULL) ORDER BY date DESC').all(id, client.lead_id),
    messages: client.lead_id ? db.prepare('SELECT * FROM messages WHERE lead_id=? ORDER BY created_at, id').all(client.lead_id) : [],
  };
}
app.get('/api/clients/:id', need('clientes'), h((req) => clientDetail(+req.params.id)));
app.put('/api/clients/:id', need('clientes'), h((req) => {
  const d = { ...req.body };
  if (d.phone !== undefined) d.phone = digits(d.phone);
  update('clients', +req.params.id, { ...d, updated_at: now(), updated_by: req.user.id }, [...CLIENT_COLS, 'updated_at', 'updated_by']);
  audit(req.user.id, 'client', +req.params.id, 'update');
  return clientDetail(+req.params.id);
}));
app.delete('/api/clients/:id', need('clientes'), h((req) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) throw fail(400, 'Informe o motivo da exclusão');
  db.prepare('UPDATE clients SET deleted_at=?, delete_reason=? WHERE id=?').run(now(), reason, +req.params.id);
  db.prepare('UPDATE leads SET client_id=NULL WHERE client_id=?').run(+req.params.id);
  audit(req.user.id, 'client', +req.params.id, 'delete');
  return { ok: true };
}));

const BUDGET_COLS = ['client_id', 'avaliador_id', 'tratamento_id', 'status', 'valor_orcado', 'valor_fechado', 'entrada',
  'forma_pagamento', 'valor_total', 'parcelas', 'data_orcamento', 'data_fechamento', 'inicio_tratamento', 'obs', 'followup_user_id'];
function syncClientSituation(clientId) {
  const st = db.prepare("SELECT SUM(status='Fechado') f, COUNT(*) n FROM budgets WHERE client_id=?").get(clientId);
  if (st.f > 0) db.prepare("UPDATE clients SET situacao='Fechado' WHERE id=? AND situacao IN ('Em negociação','Perdido')").run(clientId);
}
app.post('/api/budgets', need('clientes'), h((req) => {
  const d = req.body;
  if (!d.client_id) throw fail(400, 'Cliente obrigatório');
  if (d.status === 'Fechado' && !d.data_fechamento) d.data_fechamento = today();
  const id = insert('budgets', { followup_user_id: req.user.id, ...d }, BUDGET_COLS);
  syncClientSituation(d.client_id);
  return clientDetail(d.client_id);
}));
app.put('/api/budgets/:id', need('clientes'), h((req) => {
  const b = db.prepare('SELECT * FROM budgets WHERE id=?').get(+req.params.id);
  if (!b) throw fail(404, 'Orçamento não encontrado');
  const d = { ...req.body };
  if (d.status === 'Fechado' && !d.data_fechamento && !b.data_fechamento) d.data_fechamento = today();
  update('budgets', b.id, d, BUDGET_COLS);
  syncClientSituation(b.client_id);
  return clientDetail(b.client_id);
}));
app.delete('/api/budgets/:id', need('clientes'), h((req) => {
  const b = db.prepare('SELECT * FROM budgets WHERE id=?').get(+req.params.id);
  if (!b) throw fail(404, 'Orçamento não encontrado');
  db.prepare('DELETE FROM budgets WHERE id=?').run(b.id);
  return clientDetail(b.client_id);
}));
// Fechamento parcial: soma ao valor fechado do orçamento.
app.post('/api/budgets/:id/closings', need('clientes'), h((req) => {
  const b = db.prepare('SELECT * FROM budgets WHERE id=?').get(+req.params.id);
  if (!b) throw fail(404, 'Orçamento não encontrado');
  const valor = Number(req.body.valor) || 0;
  if (valor <= 0) throw fail(400, 'Informe o valor do fechamento');
  insert('budget_closings', { ...req.body, budget_id: b.id, valor, data: req.body.data || today() }, ['budget_id', 'valor', 'data', 'forma_pagamento', 'obs']);
  db.prepare("UPDATE budgets SET valor_fechado=valor_fechado+?, status='Fechado', data_fechamento=COALESCE(data_fechamento,?) WHERE id=?")
    .run(valor, req.body.data || today(), b.id);
  syncClientSituation(b.client_id);
  return clientDetail(b.client_id);
}));

app.post('/api/activities', need('clientes'), h((req) => {
  const d = req.body;
  if (!d.client_id) throw fail(400, 'Cliente obrigatório');
  insert('activities', { ...d, date: d.date || now(), user_id: req.user.id }, ['client_id', 'date', 'fase_id', 'prob', 'proximo_contato', 'obs', 'user_id']);
  const up = { ultimo_contato: d.date || now(), updated_at: now(), updated_by: req.user.id };
  if (d.fase_id) up.fase_id = d.fase_id;
  if (d.prob !== undefined && d.prob !== '') up.prob_fechamento = +d.prob;
  if (d.proximo_contato !== undefined) up.proximo_contato = d.proximo_contato;
  update('clients', d.client_id, up, ['ultimo_contato', 'updated_at', 'updated_by', 'fase_id', 'prob_fechamento', 'proximo_contato']);
  db.prepare('UPDATE clients SET tentativas=tentativas+1 WHERE id=?').run(d.client_id);
  return clientDetail(d.client_id);
}));
app.post('/api/clients/:id/messages', need('clientes'), h((req) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(+req.params.id);
  if (!c) throw fail(404, 'Cliente não encontrado');
  if (!String(req.body.content || '').trim()) throw fail(400, 'Mensagem vazia');
  insert('messages', { lead_id: c.lead_id, client_id: c.id, content: req.body.content, kind: req.body.kind || 'text',
    direction: req.body.direction || 'out', chip: req.body.chip || 1, user_id: req.user.id, created_at: req.body.date || now() },
  ['lead_id', 'client_id', 'content', 'kind', 'direction', 'chip', 'user_id', 'created_at']);
  return clientDetail(c.id);
}));

// ---------------------------------------------------------------- indicação
function referralRows() {
  const pats = db.prepare('SELECT * FROM referral_patients ORDER BY id DESC').all();
  const refs = db.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM appointments a WHERE a.lead_id=r.lead_id) agendou,
      (SELECT COUNT(*) FROM appointments a WHERE a.lead_id=r.lead_id AND a.status='Compareceu') compareceu,
      (SELECT COALESCE(SUM(b.valor_orcado),0) FROM budgets b JOIN clients c ON c.id=b.client_id WHERE c.lead_id=r.lead_id) orcado,
      (SELECT COALESCE(SUM(b.valor_fechado),0) FROM budgets b JOIN clients c ON c.id=b.client_id WHERE c.lead_id=r.lead_id AND b.status='Fechado') fechado
    FROM referrals r`).all();
  return pats.map((p) => {
    const mine = refs.filter((r) => r.patient_id === p.id);
    const agendados = mine.filter((r) => r.agendou > 0).length;
    const comparecidos = mine.filter((r) => r.compareceu > 0 || r.data_comparecimento).length;
    const fechados = mine.filter((r) => r.fechado > 0).length;
    return {
      ...p, indicados_list: mine, indicados: mine.length, agendados, comparecidos, fechados,
      pontos: mine.length + agendados * 2 + comparecidos * 3 + fechados * 5,
      oportunidades: mine.reduce((s, r) => s + r.orcado, 0), fechamentos: mine.reduce((s, r) => s + r.fechado, 0),
    };
  });
}
app.get('/api/referrals', h(() => referralRows()));
app.post('/api/referrals', h((req) => {
  const d = req.body;
  if (!String(d.name || '').trim()) throw fail(400, 'Nome do paciente é obrigatório');
  const id = insert('referral_patients', { ...d, phone: digits(d.phone) }, ['name', 'phone', 'lead_id', 'client_id', 'satisfacao', 'prob_indicacao', 'ultima_indicacao', 'data_agendamento', 'obs']);
  return { id };
}));
app.put('/api/referrals/:id', h((req) => {
  const id = +req.params.id;
  update('referral_patients', id, req.body, ['name', 'phone', 'satisfacao', 'prob_indicacao', 'ultima_indicacao', 'data_agendamento', 'obs']);
  if (Array.isArray(req.body.indicados)) {
    const origemInd = db.prepare("SELECT id FROM lists WHERE type='origem' AND name='Indicação'").get();
    const pat = db.prepare('SELECT name FROM referral_patients WHERE id=?').get(id);
    db.transaction(() => {
      const keep = [];
      for (const r of req.body.indicados) {
        if (!String(r.name || '').trim()) continue;
        if (r.id) {
          update('referrals', r.id, { ...r, phone: digits(r.phone) }, ['name', 'phone', 'data_indicacao', 'data_comparecimento']);
          keep.push(r.id);
        } else {
          // Cada indicado novo entra como lead com origem "Indicação".
          const leadId = createLead({ name: r.name, phone: r.phone, origem_id: origemInd?.id, indicacao: pat?.name,
            created_at: r.data_indicacao ? `${r.data_indicacao} 00:00:00` : undefined }, req.user.id);
          keep.push(insert('referrals', { ...r, patient_id: id, phone: digits(r.phone), lead_id: leadId },
            ['patient_id', 'name', 'phone', 'data_indicacao', 'data_comparecimento', 'lead_id']));
        }
      }
      const placeholders = keep.length ? keep.join(',') : '0';
      db.prepare(`DELETE FROM referrals WHERE patient_id=? AND id NOT IN (${placeholders})`).run(id);
    })();
  }
  return { ok: true };
}));
app.delete('/api/referrals/:id', h((req) => { db.prepare('DELETE FROM referral_patients WHERE id=?').run(+req.params.id); return { ok: true }; }));

// ---------------------------------------------------------------- campanhas
function campaignAudience(f = {}) {
  const w = ['l.deleted_at IS NULL', "l.phone<>''"];
  const p = {};
  const range = (expr, a, b, k) => {
    if (f[a]) { p[k + 'a'] = f[a]; w.push(`substr(${expr},1,10)>=@${k}a`); }
    if (f[b]) { p[k + 'b'] = f[b]; w.push(`substr(${expr},1,10)<=@${k}b`); }
  };
  range('l.created_at', 'inc_de', 'inc_ate', 'in');
  range('l.ultimo_contato', 'uc_de', 'uc_ate', 'uc');
  range('(SELECT MAX(date) FROM appointments WHERE lead_id=l.id)', 'ag_de', 'ag_ate', 'ag');
  const tent = '(SELECT COUNT(*) FROM contacts WHERE lead_id=l.id)';
  if (f.tent_min !== undefined && f.tent_min !== '') { p.tmin = +f.tent_min; w.push(`${tent}>=@tmin`); }
  if (f.tent_max !== undefined && f.tent_max !== '') { p.tmax = +f.tent_max; w.push(`${tent}<=@tmax`); }
  if (f.sem_ultimo_contato === 'Não') w.push("l.ultimo_contato IS NOT NULL AND l.ultimo_contato<>''");
  if (f.anotacoes) { p.an = `%${f.anotacoes}%`; w.push('l.anotacoes LIKE @an'); }
  const o = toIntArr(f.origem); if (o.length) w.push(`l.origem_id IN (${o.join(',')})`);
  const s = toIntArr(f.status); if (s.length) w.push(`l.status_id IN (${s.join(',')})`);
  const as = toArr(f.ag_status);
  if (as.length) {
    w.push(`(SELECT status FROM appointments WHERE lead_id=l.id ORDER BY date DESC LIMIT 1) IN (${as.map((x, i) => { p['as' + i] = x; return '@as' + i; }).join(',')})`);
  }
  return db.prepare(`SELECT l.id,l.name,l.ddi,l.phone,l.origem_id,l.status_id,l.created_at FROM leads l WHERE ${w.join(' AND ')} ORDER BY l.id DESC`).all(p);
}
app.get('/api/campaigns', h(() => db.prepare(`SELECT c.*, t.nome template_nome, t.meta_id, t.categoria, t.idioma, u.name criado_por,
    (SELECT COUNT(*) FROM campaign_targets x WHERE x.campaign_id=c.id) total,
    (SELECT COUNT(*) FROM campaign_targets x WHERE x.campaign_id=c.id AND x.status='Pendente') pendentes,
    (SELECT COUNT(*) FROM campaign_targets x WHERE x.campaign_id=c.id AND x.status='Concluído') concluidos,
    (SELECT COUNT(*) FROM campaign_targets x WHERE x.campaign_id=c.id AND x.status='Falha') falhas
  FROM campaigns c LEFT JOIN templates t ON t.id=c.template_id LEFT JOIN users u ON u.id=c.created_by ORDER BY c.id DESC`).all()));
app.post('/api/campaigns/preview', h((req) => campaignAudience(req.body.filtro)));
app.post('/api/campaigns', h((req) => {
  const d = req.body;
  if (!String(d.nome || '').trim()) throw fail(400, 'Nome da campanha é obrigatório');
  if (String(d.nome).length > 200) throw fail(400, 'Nome com até 200 caracteres');
  if (String(d.descricao || '').length > 4000) throw fail(400, 'Descrição com até 4.000 caracteres');
  if (!d.template_id) throw fail(400, 'Escolha o modelo de mensagem');
  const audience = campaignAudience(d.filtro);
  if (!audience.length) throw fail(400, 'Nenhum lead corresponde ao filtro');
  let id;
  db.transaction(() => {
    id = insert('campaigns', { ...d, filtro: JSON.stringify(d.filtro || {}), created_by: req.user.id },
      ['nome', 'descricao', 'cor', 'data', 'hora', 'chip_tipo', 'template_id', 'filtro', 'created_by']);
    const st = db.prepare('INSERT INTO campaign_targets(campaign_id,lead_id) VALUES(?,?)');
    audience.forEach((l) => st.run(id, l.id));
  })();
  return { id, total: audience.length };
}));
// Executa o disparo: registra a mensagem do modelo na conversa de cada lead.
function runCampaign(id) {
  const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
  if (!c || c.status === 'Cancelada') return 0;
  const t = db.prepare('SELECT * FROM templates WHERE id=?').get(c.template_id);
  const chip = db.prepare("SELECT * FROM chips WHERE tipo=? ORDER BY id LIMIT 1").get(c.chip_tipo) || { id: 1 };
  const targets = db.prepare("SELECT ct.*, l.name, l.phone FROM campaign_targets ct JOIN leads l ON l.id=ct.lead_id WHERE ct.campaign_id=? AND ct.status='Pendente'").all(id);
  db.transaction(() => {
    for (const tg of targets) {
      if (!tg.phone) { db.prepare("UPDATE campaign_targets SET status='Falha', error='Sem telefone' WHERE id=?").run(tg.id); continue; }
      const text = String(t?.conteudo || '').replace(/\{\{nome\}\}/g, tg.name || '');
      db.prepare('INSERT INTO messages(lead_id,chip,content,kind,template_id,user_id) VALUES(?,?,?,?,?,?)').run(tg.lead_id, chip.id, text, 'template', c.template_id, c.created_by);
      db.prepare("UPDATE campaign_targets SET status='Concluído', sent_at=? WHERE id=?").run(now(), tg.id);
      db.prepare('UPDATE leads SET campanha_id=?, ultimo_contato=? WHERE id=?').run(id, now(), tg.lead_id);
    }
    db.prepare("UPDATE campaigns SET status='Concluída' WHERE id=?").run(id);
  })();
  return targets.length;
}
app.post('/api/campaigns/:id/run', h((req) => ({ sent: runCampaign(+req.params.id) })));
app.post('/api/campaigns/:id/cancel', h((req) => {
  db.prepare("UPDATE campaigns SET status='Cancelada' WHERE id=?").run(+req.params.id);
  return { ok: true };
}));
app.delete('/api/campaigns/:id', h((req) => { db.prepare('DELETE FROM campaigns WHERE id=?').run(+req.params.id); return { ok: true }; }));
// Agendador simples: dispara campanhas cuja data/hora já passou.
setInterval(() => {
  try {
    const due = db.prepare("SELECT id FROM campaigns WHERE status='Agendada' AND (data || ' ' || COALESCE(hora,'00:00')) <= ?").all(now().slice(0, 16));
    due.forEach((c) => runCampaign(c.id));
  } catch (e) { console.error('scheduler', e); }
}, 60 * 1000).unref();

app.get('/api/templates', h(() => db.prepare('SELECT * FROM templates ORDER BY nome').all()));
app.post('/api/templates', admin, h((req) => ({ id: insert('templates', req.body, ['nome', 'meta_id', 'categoria', 'idioma', 'conteudo']) })));
app.put('/api/templates/:id', admin, h((req) => { update('templates', +req.params.id, req.body, ['nome', 'meta_id', 'categoria', 'idioma', 'conteudo']); return { ok: true }; }));
app.delete('/api/templates/:id', admin, h((req) => { db.prepare('DELETE FROM templates WHERE id=?').run(+req.params.id); return { ok: true }; }));

// ---------------------------------------------------------------- painel, metas e relatórios
app.get('/api/dashboard', need('dashboard'), h((req) => {
  const data = reports.dashboard(req.query);
  if (!req.user.p_admin && !req.user.p_financeiro) data.financeiro = null;
  return data;
}));
app.get('/api/goals/:month', need('dashboard'), h((req) => {
  const r = db.prepare('SELECT data FROM goals WHERE month=?').get(req.params.month);
  return parseJSON(r?.data, {});
}));
app.put('/api/goals/:month', need('dashboard'), h((req) => {
  db.prepare('INSERT INTO goals(month,data) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET data=excluded.data').run(req.params.month, JSON.stringify(req.body || {}));
  return { ok: true };
}));
app.get('/api/reports/:name', h((req) => {
  const fn = reports.reports[req.params.name];
  if (!fn) throw fail(404, 'Relatório não encontrado');
  return fn(req.query);
}));

// ---------------------------------------------------------------- usuários
const USER_PERMS = ['p_admin', 'p_leads', 'p_clientes', 'p_dashboard', 'p_financeiro', 'p_aulas'];
app.get('/api/users', admin, h(() => db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser)));
app.post('/api/users', admin, h((req) => {
  const d = req.body;
  if (!d.name || !d.email || !d.password) throw fail(400, 'Nome, e-mail e senha são obrigatórios');
  if (d.password !== d.confirm) throw fail(400, 'As senhas não conferem');
  if (String(d.password).length < 6) throw fail(400, 'A senha deve ter ao menos 6 caracteres');
  if (db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(d.email)) throw fail(400, 'E-mail já cadastrado');
  const perms = Object.fromEntries(USER_PERMS.map((k) => [k, d[k] ? 1 : 0]));
  const id = insert('users', { name: d.name, email: d.email, pass: hashPassword(d.password), ...perms }, ['name', 'email', 'pass', ...USER_PERMS]);
  return { id };
}));
app.put('/api/users/:id', admin, h((req) => {
  const id = +req.params.id;
  const d = { ...req.body };
  for (const k of USER_PERMS) if (k in d) d[k] = d[k] ? 1 : 0;
  if (id === req.user.id && d.p_admin === 0) throw fail(400, 'Você não pode remover seu próprio acesso de administrador');
  update('users', id, d, ['name', 'email', 'active', ...USER_PERMS]);
  if (d.password) db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPassword(d.password), id);
  if (d.active === 0) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  return { ok: true };
}));
app.get('/api/linked-users', admin, h(() => db.prepare(`SELECT lu.*, u.name, u.email FROM linked_users lu JOIN users u ON u.id=lu.user_id ORDER BY lu.id DESC`).all()));
app.post('/api/linked-users', admin, h((req) => {
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(String(req.body.email || '').trim());
  if (!u) throw fail(404, 'Usuário não encontrado com este e-mail');
  insert('linked_users', { user_id: u.id, access: req.body.viewer ? 'Visualizador' : 'Completo' }, ['user_id', 'access']);
  return { ok: true };
}));
app.delete('/api/linked-users/:id', admin, h((req) => { db.prepare('DELETE FROM linked_users WHERE id=?').run(+req.params.id); return { ok: true }; }));

// ---------------------------------------------------------------- configurações, pagamento, chips
const SETTING_KEYS = ['clinica', 'leads', 'integracoes', 'ia', 'metricas'];
app.get('/api/settings/:key', h((req) => {
  if (!SETTING_KEYS.includes(req.params.key)) throw fail(404, 'Configuração inexistente');
  return getSetting(req.params.key, {});
}));
app.put('/api/settings/:key', h((req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) throw fail(404, 'Configuração inexistente');
  // Metas/métricas podem ser alteradas por quem acessa o painel; o resto é só do administrador.
  if (req.params.key === 'metricas' ? !(req.user.p_admin || req.user.p_dashboard) : !req.user.p_admin) throw fail(403, 'Sem permissão');
  setSetting(req.params.key, { ...getSetting(req.params.key, {}), ...req.body });
  return getSetting(req.params.key, {});
}));
app.get('/api/payments', admin, h(() => db.prepare('SELECT * FROM payments ORDER BY id DESC').all()));
app.post('/api/payments', admin, h((req) => {
  const planos = { Básico: 197, Profissional: 397, Premium: 697 };
  const plano = req.body.plano;
  if (!planos[plano]) throw fail(400, 'Plano inválido');
  const codigo = 'PED-' + Date.now().toString(36).toUpperCase();
  insert('payments', { codigo, plano, valor: planos[plano], status: 'Pendente' }, ['codigo', 'plano', 'valor', 'status']);
  return { ok: true };
}));
app.get('/api/chips', h(() => db.prepare('SELECT * FROM chips ORDER BY id').all()));
app.post('/api/chips/:id/:action', admin, h((req) => {
  const id = +req.params.id;
  const { action } = req.params;
  if (action === 'connect') db.prepare("UPDATE chips SET status='Conectado', numero=?, updated_at=? WHERE id=?").run(digits(req.body.numero), now(), id);
  else if (action === 'disconnect') db.prepare("UPDATE chips SET status='Desconectado', updated_at=? WHERE id=?").run(now(), id);
  else if (action === 'update') update('chips', id, { ...req.body, updated_at: now() }, ['nome', 'tipo', 'updated_at']);
  else throw fail(400, 'Ação inválida');
  return db.prepare('SELECT * FROM chips ORDER BY id').all();
}));

app.get('/api/notifications', h((req) => {
  const items = [];
  const hoje = today();
  if (req.user.p_admin || req.user.p_leads) {
    const atrasados = db.prepare("SELECT COUNT(*) c FROM leads WHERE deleted_at IS NULL AND proximo_contato<>'' AND substr(proximo_contato,1,10)<?").get(hoje).c;
    const hojeC = db.prepare("SELECT COUNT(*) c FROM leads WHERE deleted_at IS NULL AND substr(proximo_contato,1,10)=?").get(hoje).c;
    if (atrasados) items.push({ text: `${atrasados} lead(s) com próximo contato atrasado`, link: '#/leads/proximos', level: 'danger' });
    if (hojeC) items.push({ text: `${hojeC} lead(s) para contatar hoje`, link: '#/leads/proximos', level: 'info' });
  }
  if (req.user.p_admin || req.user.p_clientes) {
    const cli = db.prepare("SELECT COUNT(*) c FROM clients WHERE deleted_at IS NULL AND proximo_contato<>'' AND substr(proximo_contato,1,10)<=?").get(hoje).c;
    if (cli) items.push({ text: `${cli} cliente(s) nos contatos do dia`, link: '#/clientes?contatos_dia=1', level: 'info' });
  }
  const ag = db.prepare("SELECT COUNT(*) c FROM appointments WHERE date=? AND bloqueio=0").get(hoje).c;
  if (ag) items.push({ text: `${ag} agendamento(s) hoje`, link: '#/agenda', level: 'info' });
  return items;
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`CRM rodando em http://localhost:${PORT}`));
}
module.exports = app;
