// Painel de indicadores e relatórios. Os dados são carregados e agregados em JS.
const { db, getSetting } = require('./db');
const { today, toIntArr, parseJSON, daysBetween, pad } = require('./util');

const d10 = (s) => (s ? String(s).slice(0, 10) : '');
const inRange = (s, from, to) => { const x = d10(s); return x && x >= from && x <= to; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);

function period(q) {
  const t = today();
  return { from: q.from || `${t.slice(0, 7)}-01`, to: q.to || t };
}
function listName(id) {
  if (!id) return '(sem)';
  const r = db.prepare('SELECT name FROM lists WHERE id=?').get(id);
  return r ? r.name : '(removido)';
}
function userName(id) {
  if (!id) return '(sem usuário)';
  const r = db.prepare('SELECT name FROM users WHERE id=?').get(id);
  return r ? r.name : '(removido)';
}

// Carrega o "universo" de dados com os filtros comuns de relatório.
function load(q) {
  const { from, to } = period(q);
  const origens = toIntArr(q.origens);
  const grupos = String(q.grupos || '').split(',').filter(Boolean);
  const tags = toIntArr(q.etiquetas);
  const avaliadores = toIntArr(q.avaliadores);
  const tratamentos = toIntArr(q.tratamentos);
  const lists = db.prepare('SELECT id,grupo FROM lists').all();
  const grupoOf = (id) => lists.find((l) => l.id === id)?.grupo;

  let leads = db.prepare('SELECT * FROM leads WHERE deleted_at IS NULL').all().map((l) => ({ ...l, tags: parseJSON(l.tags, []) }));
  if (origens.length) leads = leads.filter((l) => origens.includes(l.origem_id));
  if (grupos.length) leads = leads.filter((l) => grupos.includes(grupoOf(l.origem_id)));
  if (tags.length) leads = leads.filter((l) => l.tags.some((t) => tags.includes(t)));
  if (q.disparos_leads === '1') {
    const ids = new Set(db.prepare('SELECT DISTINCT lead_id FROM campaign_targets').all().map((r) => r.lead_id));
    leads = leads.filter((l) => ids.has(l.id));
  }
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const appts = db.prepare('SELECT * FROM appointments WHERE bloqueio=0').all().filter((a) => leadById.has(a.lead_id));
  let budgets = db.prepare(`SELECT b.*, c.lead_id, c.responsavel_id, c.origem_id, c.name client_name FROM budgets b
    JOIN clients c ON c.id=b.client_id WHERE c.deleted_at IS NULL`).all();
  const leadFiltered = origens.length || grupos.length || tags.length || q.disparos_leads === '1';
  if (leadFiltered) budgets = budgets.filter((b) => leadById.has(b.lead_id));
  if (q.disparos_pacientes === '1') {
    const ids = new Set(db.prepare('SELECT DISTINCT lead_id FROM campaign_targets').all().map((r) => r.lead_id));
    budgets = budgets.filter((b) => ids.has(b.lead_id));
  }
  if (avaliadores.length) budgets = budgets.filter((b) => avaliadores.includes(b.avaliador_id));
  if (tratamentos.length) budgets = budgets.filter((b) => tratamentos.includes(b.tratamento_id));
  return { from, to, leads, leadById, appts, budgets };
}

// Métricas do funil para um subconjunto (grupo) de dados.
function funnel({ from, to, leads, appts, budgets }) {
  const created = leads.filter((l) => inRange(l.created_at, from, to));
  const agendamentos = appts.filter((a) => inRange(a.created_at, from, to));
  const agendados = new Set(agendamentos.map((a) => a.lead_id)).size;
  const compareceu = new Set(appts.filter((a) => a.status === 'Compareceu' && inRange(a.date, from, to)).map((a) => a.lead_id)).size;
  const fechados = budgets.filter((b) => b.status === 'Fechado' && inRange(b.data_fechamento, from, to));
  const orcados = budgets.filter((b) => inRange(b.data_orcamento || b.created_at, from, to));
  const valorFechado = sum(fechados, (b) => b.valor_fechado);
  const valorOrcadoFech = sum(fechados, (b) => b.valor_orcado);
  return {
    leads: created.length, agendamentos: agendamentos.length, pct_agend: pct(agendados, created.length), agendados,
    compareceu, pct_comp: pct(compareceu, agendados), fechados: fechados.length, pct_fecha: pct(fechados.length, compareceu),
    valor_orcado: sum(orcados, (b) => b.valor_orcado), valor_fechado: valorFechado,
    valor_desconto: Math.max(0, valorOrcadoFech - valorFechado), pct_conversao: pct(fechados.length, created.length),
    ticket_medio: fechados.length ? valorFechado / fechados.length : 0,
  };
}

function groupFunnel(base, keyLead, keyBudget, labelFn) {
  const keys = new Set([...base.leads.map(keyLead), ...base.budgets.map(keyBudget)]);
  return [...keys].map((k) => {
    const leads = base.leads.filter((l) => keyLead(l) === k);
    const ids = new Set(leads.map((l) => l.id));
    return {
      nome: labelFn(k),
      ...funnel({ ...base, leads, appts: base.appts.filter((a) => ids.has(a.lead_id)), budgets: base.budgets.filter((b) => keyBudget(b) === k) }),
    };
  }).filter((r) => r.leads || r.agendamentos || r.compareceu || r.fechados || r.valor_orcado).sort((a, b) => b.leads - a.leads);
}

function eachDay(from, to) {
  const out = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end && out.length < 400) {
    out.push({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, dow: d.getDay() });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function dashboard(q) {
  const base = load(q);
  const { from, to } = base;
  if (q.seg === 'criados') {
    base.leads = base.leads.filter((l) => inRange(l.created_at, from, to));
    const ids = new Set(base.leads.map((l) => l.id));
    base.appts = base.appts.filter((a) => ids.has(a.lead_id));
    base.budgets = base.budgets.filter((b) => ids.has(b.lead_id));
  }
  const f = funnel(base);
  const funil = [
    { key: 'leads', label: 'Leads Criados', qtd: f.leads, conv: 100 },
    { key: 'agendados', label: 'Agendados', qtd: f.agendados, conv: pct(f.agendados, f.leads) },
    { key: 'compareceu', label: 'Comparecimentos', qtd: f.compareceu, conv: pct(f.compareceu, f.agendados) },
    { key: 'fechados', label: 'Fechamentos', qtd: f.fechados, conv: pct(f.fechados, f.compareceu) },
  ];

  // Série diária considerando os dias da semana configurados em "Configurar métricas".
  const diasCfg = getSetting('metricas', { dias: [1, 2, 3, 4, 5] }).dias || [1, 2, 3, 4, 5];
  const dias = eachDay(from, to).filter((d) => diasCfg.includes(d.dow)).map((d) => d.date);
  const daily = (fn) => Object.fromEntries(dias.map((d) => [d, fn(d)]));
  const linhas = [
    { metrica: 'Leads Criados', key: 'leads', valores: daily((d) => base.leads.filter((l) => d10(l.created_at) === d).length) },
    { metrica: 'Agendados', key: 'agendados', valores: daily((d) => new Set(base.appts.filter((a) => d10(a.created_at) === d).map((a) => a.lead_id)).size) },
    { metrica: 'Comparecimentos', key: 'compareceu', valores: daily((d) => base.appts.filter((a) => a.status === 'Compareceu' && a.date === d).length) },
    { metrica: 'Fechamentos', key: 'fechados', valores: daily((d) => base.budgets.filter((b) => b.status === 'Fechado' && d10(b.data_fechamento) === d).length) },
    { metrica: 'Chamadas', key: 'chamadas', valores: daily((d) => db.prepare("SELECT COUNT(*) c FROM contacts WHERE tipo='Chamada Telefônica' AND substr(date,1,10)=?").get(d).c) },
  ];
  linhas.forEach((l) => { l.total = sum(Object.values(l.valores), (x) => x); });

  // Metas do mês (mês da data inicial do período).
  const month = q.month || from.slice(0, 7);
  const goals = parseJSON(db.prepare('SELECT data FROM goals WHERE month=?').get(month)?.data, {});
  const [yy, mm] = month.split('-').map(Number);
  const lastDay = new Date(yy, mm, 0).getDate();
  const monthDays = eachDay(`${month}-01`, `${month}-${pad(lastDay)}`).filter((d) => diasCfg.includes(d.dow));
  const t = today();
  const elapsed = monthDays.filter((d) => d.date <= t).length || 1;
  const monthBase = load({ ...q, from: `${month}-01`, to: `${month}-${pad(lastDay)}` });
  const mf = funnel(monthBase);
  const metas = ['leads', 'agendados', 'compareceu', 'fechados'].map((k, i) => {
    const meta = Number(goals[k]) || 0;
    const prog = mf[k];
    const proj = monthDays.length ? Math.round((prog / elapsed) * monthDays.length) : prog;
    linhas[i].meta_diaria = meta && monthDays.length ? Math.round((meta / monthDays.length) * 10) / 10 : null;
    return { key: k, label: funil[i].label, meta, progresso: prog, pct: pct(prog, meta), projecao: proj };
  });
  const investimento = Number(goals.investimento) || 0;
  return {
    periodo: { from, to }, funil,
    financeiro: { valor_fechado: f.valor_fechado, valor_oportunidades: f.valor_orcado, ticket_medio: f.ticket_medio, desconto: f.valor_desconto },
    metas: {
      month, itens: metas, investimento, meta_vendas: Number(goals.valor_vendas) || 0, meta_ticket: Number(goals.ticket_medio) || 0,
      valor_lead: mf.leads ? investimento / mf.leads : 0, ticket_real: mf.ticket_medio, vendas_real: mf.valor_fechado,
    },
    diario: { dias, linhas },
  };
}

// ---------------------------------------------------------------- relatórios
const reports = {
  // Usuários por Ação
  usuarios(q) {
    const { from, to } = period(q);
    const origens = toIntArr(q.origens);
    const rows = db.prepare(`SELECT a.*, l.origem_id FROM audit a
      LEFT JOIN appointments ap ON a.entity='appointment' AND ap.id=a.entity_id
      LEFT JOIN leads l ON l.id = CASE WHEN a.entity='lead' THEN a.entity_id WHEN a.entity='appointment' THEN ap.lead_id END
      WHERE substr(a.created_at,1,10) BETWEEN ? AND ?`).all(from, to)
      .filter((r) => !origens.length || origens.includes(r.origem_id) || r.entity === 'contact');
    const users = db.prepare('SELECT id,name FROM users ORDER BY name').all();
    return users.map((u) => {
      const mine = rows.filter((r) => r.user_id === u.id);
      const c = (entity, action) => mine.filter((r) => r.entity === entity && r.action === action).length;
      return { nome: u.name, criados: c('lead', 'create'), modificados: c('lead', 'update'), excluidos: c('lead', 'delete'),
        contato_manual: c('contact', 'contact'), agendamentos: c('appointment', 'create'), faltas: c('appointment', 'faltou'),
        comparecimentos: c('appointment', 'compareceu') };
    });
  },

  // Leads por Status
  leads(q) {
    const { from, to, leads } = load(q);
    const created = leads.filter((l) => inRange(l.created_at, from, to));
    const map = {};
    created.forEach((l) => { const k = listName(l.status_id); map[k] = (map[k] || 0) + 1; });
    return Object.entries(map).map(([status, qtd]) => ({ status, qtd, pct: pct(qtd, created.length) })).sort((a, b) => b.qtd - a.qtd);
  },

  // Métricas de Origem
  origem(q) {
    const base = load(q);
    return groupFunnel(base, (l) => l.origem_id, (b) => b.origem_id, listName);
  },

  // Métricas de Usuários
  'usuarios-metricas'(q) {
    const base = load(q);
    // Atribuição: lead → quem criou; orçamento → responsável pelo follow-up.
    return groupFunnel(base, (l) => l.created_by, (b) => b.followup_user_id || b.responsavel_id, userName);
  },

  // Ferramenta comercial
  'ferramenta-comercial'(q) {
    const t = today();
    const month = `${q.ano || t.slice(0, 4)}-${pad(q.mes || t.slice(5, 7))}`;
    let rows = db.prepare(`SELECT b.*, c.name cliente, c.origem_id, c.responsavel_id, c.data_comparecimento FROM budgets b
      JOIN clients c ON c.id=b.client_id WHERE c.deleted_at IS NULL`).all()
      .filter((b) => d10(b.data_orcamento || b.created_at).startsWith(month) || d10(b.data_fechamento).startsWith(month));
    if (q.tipo_fechamento) rows = rows.filter((b) => b.status === q.tipo_fechamento);
    if (q.crc) rows = rows.filter((b) => String(b.followup_user_id || b.responsavel_id) === String(q.crc));
    if (q.tratamento) rows = rows.filter((b) => String(b.tratamento_id) === String(q.tratamento));
    if (q.avaliador) rows = rows.filter((b) => String(b.avaliador_id) === String(q.avaliador));
    if (q.cliente) rows = rows.filter((b) => b.cliente.toLowerCase().includes(String(q.cliente).toLowerCase()));
    if (q.marketing) {
      const g = db.prepare('SELECT id,grupo FROM lists WHERE type=\'origem\'').all();
      rows = rows.filter((b) => (g.find((x) => x.id === b.origem_id)?.grupo === 'Não marketing') === (q.marketing === 'nao'));
    }
    const orcamentos = rows.map((b) => ({
      id: b.id, cliente: b.cliente, data_orcamento: b.data_orcamento, data_fechamento: b.data_fechamento,
      tratamento: listName(b.tratamento_id), avaliador: listName(b.avaliador_id), status: b.status,
      oportunidade: b.valor_orcado, fechado: b.status === 'Fechado' ? b.valor_fechado : 0,
      conversao: b.valor_orcado ? pct(b.status === 'Fechado' ? b.valor_fechado : 0, b.valor_orcado) : 0,
      desconto: b.status === 'Fechado' ? Math.max(0, b.valor_orcado - b.valor_fechado) : 0,
      entrada: b.entrada ? 'Sim' : 'Não', followup: userName(b.followup_user_id || b.responsavel_id),
    }));
    const agg = (keyFn) => {
      const m = {};
      orcamentos.forEach((o) => {
        const k = keyFn(o);
        m[k] = m[k] || { nome: k, orcamentos: 0, fechados: 0, oportunidade: 0, vendido: 0 };
        m[k].orcamentos++; m[k].oportunidade += o.oportunidade;
        if (o.status === 'Fechado') { m[k].fechados++; m[k].vendido += o.fechado; }
      });
      return Object.values(m).map((r) => ({ ...r, conversao: pct(r.fechados, r.orcamentos), ticket_medio: r.fechados ? r.vendido / r.fechados : 0 }));
    };
    return { orcamentos, porCrc: agg((o) => o.followup), porAvaliador: agg((o) => o.avaliador) };
  },

  // Leads Reaquecidos
  'leads-reaquecidos'(q) {
    const { from, to } = period(q);
    return db.prepare(`SELECT l.id, l.name, l.phone, l.origem_id, l.created_at, COUNT(r.id) qtd, MAX(r.created_at) ultima
      FROM reheats r JOIN leads l ON l.id=r.lead_id WHERE substr(r.created_at,1,10) BETWEEN ? AND ?
      GROUP BY l.id ORDER BY ultima DESC`).all(from, to)
      .map((r) => ({ id: r.id, nome: r.name, telefone: r.phone, qtd: r.qtd, origem: listName(r.origem_id), data_reaquecimento: r.ultima, primeiro_cadastro: r.created_at }));
  },

  // Orçamentos Fechados por vendedor
  'metricas-orcamentos-fechados'(q) {
    const { from, to, budgets } = load(q);
    const m = {};
    budgets.filter((b) => b.status === 'Fechado' && inRange(b.data_fechamento, from, to)).forEach((b) => {
      const k = userName(b.followup_user_id || b.responsavel_id);
      m[k] = m[k] || { vendedor: k, fechados: 0, total: 0 };
      m[k].fechados++; m[k].total += b.valor_fechado;
    });
    return Object.values(m).map((r) => ({ ...r, ticket_medio: r.fechados ? r.total / r.fechados : 0 })).sort((a, b) => b.total - a.total);
  },

  // Comparecidos por distância do agendamento
  'metricas-comparecimento-por-agendamento'(q) {
    const { from, to, appts } = load(q);
    const faixas = [['Mesmo dia', 0, 0], ['1 dia', 1, 1], ['2 dias', 2, 2], ['3 a 7 dias', 3, 7], ['8 a 14 dias', 8, 14], ['15 a 30 dias', 15, 30], ['Mais de 30 dias', 31, 99999]];
    const rel = appts.filter((a) => inRange(a.date, from, to) && a.date <= today());
    return faixas.map(([faixa, a, b]) => {
      const g = rel.filter((x) => { const d = daysBetween(x.created_at, x.date); return d >= a && d <= b; });
      const comp = g.filter((x) => x.status === 'Compareceu').length;
      return { faixa, agendamentos: g.length, comparecimentos: comp, faltas: g.filter((x) => x.status === 'Faltou').length, taxa: pct(comp, g.length) };
    });
  },

  // Diagnóstico do Discador (por mês)
  'diagnostico-discador'(q) {
    const t = today();
    const from = q.from || `${Number(t.slice(0, 4)) - 1}${t.slice(4, 7)}-01`;
    const to = q.to || t;
    const months = [...new Set(eachDay(from, to).map((d) => d.date.slice(0, 7)))].reverse().slice(0, 12);
    const integ = getSetting('integracoes', {});
    const chips = db.prepare("SELECT COUNT(*) c FROM chips WHERE status='Conectado'").get().c;
    const wa = db.prepare("SELECT id FROM lists WHERE type='origem' AND name='WhatsApp'").get();
    return months.map((m) => {
      const leads = db.prepare('SELECT * FROM leads WHERE deleted_at IS NULL AND substr(created_at,1,7)=?').all(m);
      const changed = db.prepare("SELECT COUNT(DISTINCT entity_id) c FROM audit WHERE entity='lead' AND field='status_id' AND substr(created_at,1,7)=?").get(m).c;
      const calls = db.prepare("SELECT COUNT(*) c FROM contacts WHERE tipo='Chamada Telefônica' AND substr(date,1,7)=?").get(m).c;
      const faltantes = db.prepare(`SELECT COUNT(*) c FROM contacts c WHERE c.tipo='Chamada Telefônica' AND substr(c.date,1,7)=?
        AND EXISTS (SELECT 1 FROM appointments a WHERE a.lead_id=c.lead_id AND a.status='Faltou')`).get(m).c;
      return {
        mes: m, api_ativa: chips > 0 ? 'Sim' : 'Não', cloudia: integ.cloudia?.link ? 'Sim' : 'Não',
        leads_whatsapp: wa ? leads.filter((l) => l.origem_id === wa.id).length : 0, leads: leads.length,
        pct_anotacoes: pct(leads.filter((l) => String(l.anotacoes || '').trim()).length, leads.length),
        pct_status: pct(changed, leads.length), ligacoes_faltantes: faltantes,
        retornos_agendados: leads.filter((l) => l.proximo_contato).length, ligacoes: calls,
        media_ligacoes: leads.length ? Math.round((calls / leads.length) * 10) / 10 : 0,
      };
    });
  },

  // Custos IA
  'relatorio-custo-ia'(q) {
    const { from, to } = period(q);
    return db.prepare(`SELECT i.id, i.client_id, i.lead_id, l.name, l.phone, l.origem_id, MIN(i.created_at) criado, SUM(i.pausas) pausas
      FROM ia_interactions i LEFT JOIN leads l ON l.id=i.lead_id WHERE substr(i.created_at,1,10) BETWEEN ? AND ?
      GROUP BY i.lead_id ORDER BY pausas DESC`).all(from, to)
      .map((r) => ({ id: r.id, cliente: r.client_id || '', lead: r.name, telefone: r.phone, data: r.criado, origem: listName(r.origem_id), pausas: r.pausas }));
  },
};

module.exports = { dashboard, reports };
