// Sincronização com sistemas externos (Clinicorp): grava pacientes, agendamentos e orçamentos sem duplicar.
const { db, getSetting } = require('../db');
const { now, digits } = require('../util');

const listId = (type, name) => {
  if (!name) return null;
  const n = String(name).trim();
  const hit = db.prepare('SELECT id FROM lists WHERE type=? AND lower(name)=lower(?)').get(type, n);
  if (hit) return hit.id;
  return db.prepare("INSERT INTO lists(type,name,state) VALUES(?,?,'ativo')").run(type, n).lastInsertRowid;
};
// Telefone sem DDI do Brasil (55), para casar "+55 11 9..." com "11 9...".
const phoneBR = (v) => { const d = digits(v); return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d; };
const dateOnly = (s) => (s ? String(s).slice(0, 10) : null);
const money = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d,.-]/g, '');
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
};
const STATUS_AG = { agendado: 'Agendado', confirmado: 'Confirmado', atendido: 'Compareceu', compareceu: 'Compareceu', finalizado: 'Compareceu',
  faltou: 'Faltou', falta: 'Faltou', desmarcado: 'Desmarcado', cancelado: 'Desmarcado', remarcado: 'Remarcado' };
const STATUS_ORC = { aprovado: 'Fechado', fechado: 'Fechado', reprovado: 'Reprovado', recusado: 'Reprovado', cancelado: 'Reprovado',
  aberto: 'Em Aberto', 'em aberto': 'Em Aberto', pendente: 'Em Aberto', acompanhamento: 'Em Acompanhamento' };
const mapStatus = (map, v, def) => map[String(v || '').trim().toLowerCase()] || (v ? String(v) : def);

// Paciente do Clinicorp → cliente (quem tem orçamento ou compareceu) ou lead (só agendou).
// Chave: código do Clinicorp (ext_id). Reserva: telefone. Códigos "tel:" são provisórios e trocados pelo código real.
const isTmp = (e) => !e || /^(tel|nome):/.test(e);
function findByPatient(table, ext, phone) {
  let row = db.prepare(`SELECT * FROM ${table} WHERE ext_id=? AND deleted_at IS NULL`).get(ext);
  if (!row && phone) {
    row = db.prepare(`SELECT * FROM ${table} WHERE phone=? AND deleted_at IS NULL ORDER BY id`).all(phone).find((r) => isTmp(r.ext_id) || isTmp(ext)) || null;
  }
  return row;
}
function upsertPatient(p, userId, stats) {
  const ext = String(p.id);
  const phone = phoneBR(p.telefone);
  const origem = listId('origem', p.origem);
  const keepExt = (cur) => (isTmp(ext) && cur && !isTmp(cur) ? cur : ext);
  let lead = findByPatient('leads', ext, phone);
  let client = findByPatient('clients', ext, phone) || (lead && lead.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(lead.client_id) : null);
  let created = false;
  if (!lead && client && client.lead_id) lead = db.prepare('SELECT * FROM leads WHERE id=?').get(client.lead_id);
  if (!lead) {
    const id = db.prepare(`INSERT INTO leads(created_at,name,phone,origem_id,ext_id,created_by,tags) VALUES(?,?,?,?,?,?,'[]')`)
      .run(p.cadastro ? `${dateOnly(p.cadastro)} 00:00:00` : now(), p.nome, phone, origem, ext, userId).lastInsertRowid;
    lead = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
    created = true;
  } else {
    db.prepare(`UPDATE leads SET ext_id=?, name=COALESCE(?,name), phone=COALESCE(NULLIF(?,''),phone) WHERE id=?`).run(keepExt(lead.ext_id), p.nome || null, phone, lead.id);
  }
  if (p.tipo !== 'lead' || client) {
    if (client) {
      db.prepare(`UPDATE clients SET ext_id=@ext, name=COALESCE(@name,name), phone=COALESCE(NULLIF(@phone,''),phone), profissao=COALESCE(@profissao,profissao),
        origem_id=COALESCE(@origem,origem_id), data_comparecimento=COALESCE(data_comparecimento,@dc), ultima_consulta=COALESCE(@uc,ultima_consulta), updated_at=@at WHERE id=@id`)
        .run({ ext: keepExt(client.ext_id), name: p.nome || null, phone, profissao: p.profissao || null, origem, dc: dateOnly(p.primeira_consulta), uc: dateOnly(p.ultima_consulta), at: now(), id: client.id });
    } else {
      const cid = db.prepare(`INSERT INTO clients(lead_id,created_at,name,phone,profissao,origem_id,data_lead,data_comparecimento,ultima_consulta,responsavel_id,ext_id,tags)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'[]')`).run(lead.id, now(), p.nome, phone, p.profissao || null, origem || lead.origem_id, lead.created_at,
        dateOnly(p.primeira_consulta), dateOnly(p.ultima_consulta), userId, ext).lastInsertRowid;
      db.prepare('UPDATE leads SET client_id=? WHERE id=?').run(cid, lead.id);
      created = true;
    }
  }
  if (created) stats.novos++; else stats.atualizados++;
}
// Lead e cliente de um paciente já gravado.
function patientRefs(ext) {
  const e = String(ext);
  const client = db.prepare('SELECT id, lead_id FROM clients WHERE ext_id=? AND deleted_at IS NULL').get(e);
  if (client) return client;
  const lead = db.prepare('SELECT id, client_id FROM leads WHERE ext_id=? AND deleted_at IS NULL').get(e);
  return lead ? { id: lead.client_id, lead_id: lead.id } : null;
}

function upsertAppointment(a, userId, stats) {
  const ext = String(a.id);
  const client = patientRefs(a.paciente_id);
  if (!client) throw new Error(`agendamento ${ext}: paciente ${a.paciente_id} não encontrado`);
  const data = { lead_id: client.lead_id, date: dateOnly(a.data), start: a.inicio || '00:00', end: a.fim || a.inicio || '00:00',
    profissional_id: listId('profissional', a.profissional), status: mapStatus(STATUS_AG, a.status, 'Agendado'), descricao: a.descricao || null };
  const ex = db.prepare('SELECT id FROM appointments WHERE ext_id=?').get(ext);
  if (ex) {
    db.prepare(`UPDATE appointments SET date=@date,start=@start,end=@end,profissional_id=COALESCE(@profissional_id,profissional_id),status=@status,
      descricao=COALESCE(@descricao,descricao),updated_at=@at WHERE id=@id`).run({ ...data, at: now(), id: ex.id });
    stats.atualizados++;
  } else {
    db.prepare(`INSERT INTO appointments(lead_id,date,start,end,profissional_id,status,descricao,origem,ext_id,created_by)
      VALUES(@lead_id,@date,@start,@end,@profissional_id,@status,@descricao,'integracao',@ext,@uid)`).run({ ...data, ext, uid: userId });
    stats.novos++;
  }
  if (data.status === 'Compareceu' && client.id) {
    db.prepare('UPDATE clients SET ultima_consulta=MAX(COALESCE(ultima_consulta,\'\'),?), data_comparecimento=COALESCE(data_comparecimento,?) WHERE id=?')
      .run(data.date, data.date, client.id);
  }
}

function upsertBudget(b, stats) {
  const ext = String(b.id);
  const client = patientRefs(b.paciente_id);
  if (!client || !client.id) throw new Error(`orçamento ${ext}: paciente ${b.paciente_id} não encontrado`);
  const status = mapStatus(STATUS_ORC, b.status, 'Em Aberto');
  const data = {
    client_id: client.id, avaliador_id: listId('avaliador', b.avaliador), tratamento_id: listId('tratamento', b.tratamento), status,
    valor_orcado: money(b.valor_orcado), valor_fechado: status === 'Fechado' ? money(b.valor_fechado ?? b.valor_orcado) : money(b.valor_fechado),
    forma_pagamento: b.forma_pagamento || null, parcelas: Number(b.parcelas) || 1,
    data_orcamento: dateOnly(b.data), data_fechamento: dateOnly(b.data_aprovacao) || (status === 'Fechado' ? dateOnly(b.data) : null),
  };
  const ex = db.prepare('SELECT id FROM budgets WHERE ext_id=?').get(ext);
  if (ex) {
    db.prepare(`UPDATE budgets SET avaliador_id=COALESCE(@avaliador_id,avaliador_id), tratamento_id=COALESCE(@tratamento_id,tratamento_id), status=@status,
      valor_orcado=@valor_orcado, valor_fechado=@valor_fechado, forma_pagamento=COALESCE(@forma_pagamento,forma_pagamento), parcelas=@parcelas,
      data_orcamento=COALESCE(@data_orcamento,data_orcamento), data_fechamento=COALESCE(@data_fechamento,data_fechamento) WHERE id=@id`).run({ ...data, id: ex.id });
    stats.atualizados++;
  } else {
    db.prepare(`INSERT INTO budgets(client_id,avaliador_id,tratamento_id,status,valor_orcado,valor_fechado,forma_pagamento,parcelas,data_orcamento,data_fechamento,ext_id)
      VALUES(@client_id,@avaliador_id,@tratamento_id,@status,@valor_orcado,@valor_fechado,@forma_pagamento,@parcelas,@data_orcamento,@data_fechamento,@ext)`).run({ ...data, ext });
    stats.novos++;
  }
  if (status === 'Fechado') db.prepare("UPDATE clients SET situacao='Fechado' WHERE id=? AND situacao IN ('Em negociação','Perdido')").run(client.id);
}

// Lote no formato comum: { pacientes: [], agendamentos: [], orcamentos: [] }. Cada item precisa de "id" (código no Clinicorp).
function applyBatch(batch, userId) {
  const stats = { novos: 0, atualizados: 0, erros: 0, log: [] };
  const step = (items, fn) => (items || []).forEach((it) => {
    try {
      if (!it || it.id === undefined || it.id === null || it.id === '') throw new Error('item sem código (id)');
      db.transaction(() => fn(it))();
    } catch (e) { stats.erros++; if (stats.log.length < 200) stats.log.push(e.message); }
  });
  step(batch.pacientes, (p) => { if (!String(p.nome || '').trim()) throw new Error(`paciente ${p.id}: sem nome`); upsertPatient(p, userId, stats); });
  step(batch.agendamentos, (a) => upsertAppointment(a, userId, stats));
  step(batch.orcamentos, (b) => upsertBudget(b, stats));
  return stats;
}

const adapters = { clinicorp: () => require('./clinicorp') };
let running = false;

// Executa uma sincronização completa e registra o resultado.
async function runSync(origem = 'clinicorp', userId = null) {
  if (running) throw Object.assign(new Error('Já existe uma sincronização em andamento'), { status: 409 });
  running = true;
  const runId = db.prepare("INSERT INTO sync_runs(origem,started_at,status) VALUES(?,?,'Em andamento')").run(origem, now()).lastInsertRowid;
  try {
    const owner = userId || db.prepare('SELECT id FROM users WHERE p_admin=1 ORDER BY id LIMIT 1').get()?.id;
    const lastOk = db.prepare("SELECT started_at FROM sync_runs WHERE origem=? AND status LIKE 'Concluída%' ORDER BY id DESC LIMIT 1").get(origem);
    const batch = await adapters[origem]().fetchAll({ since: lastOk?.started_at });
    const st = applyBatch(batch, owner);
    db.prepare('UPDATE sync_runs SET finished_at=?, status=?, novos=?, atualizados=?, erros=?, log=? WHERE id=?')
      .run(now(), st.erros ? 'Concluída com erros' : 'Concluída', st.novos, st.atualizados, st.erros, st.log.join('\n'), runId);
    return { id: runId, ...st };
  } catch (e) {
    db.prepare("UPDATE sync_runs SET finished_at=?, status='Falhou', log=? WHERE id=?").run(now(), e.message, runId);
    throw e;
  } finally { running = false; }
}

// Verifica a cada minuto se chegou a hora da próxima sincronização automática.
function startScheduler() {
  const t = setInterval(() => {
    const cfg = getSetting('sync', {});
    if (!cfg.ativo || running) return;
    const last = db.prepare("SELECT started_at FROM sync_runs WHERE origem='clinicorp' ORDER BY id DESC LIMIT 1").get();
    const minutes = Math.max(15, Number(cfg.intervalo_min) || 60);
    if (last && (Date.now() - new Date(last.started_at.replace(' ', 'T')).getTime()) / 60000 < minutes) return;
    runSync('clinicorp').catch((e) => console.error('sincronização:', e.message));
  }, 60 * 1000);
  if (t.unref) t.unref();
}

module.exports = { applyBatch, runSync, startScheduler, isRunning: () => running };
