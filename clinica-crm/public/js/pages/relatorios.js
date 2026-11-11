// Relatórios: catálogo, filtros, legendas, tabela e exportação.
import { state, api, esc, errToast, modal, dataTable, pageHeader, backBtn, card, formHTML, readForm, initMulti, listOpts, userOpts, fmtMoney, fmtPct, fmtDate, fmtDateTime, fmtPhone, todayISO, opts } from '../core.js';

const money = (k, label) => ({ key: k, label, render: (r) => fmtMoney(r[k]), sort: (r) => r[k], cls: 'num', text: (r) => (Number(r[k]) || 0).toFixed(2).replace('.', ',') });
const perc = (k, label) => ({ key: k, label, render: (r) => fmtPct(r[k]), sort: (r) => r[k], cls: 'num' });
const num = (k, label) => ({ key: k, label, sort: (r) => r[k], cls: 'num' });
const dates = [{ name: 'from', label: 'Data Inicial', type: 'date', col: 3 }, { name: 'to', label: 'Data Final', type: 'date', col: 3 }];
const origensF = () => ({ name: 'origens', label: 'Origens', type: 'multi', options: listOpts('origem'), col: 3 });
const avalF = () => ({ name: 'avaliadores', label: 'Avaliadores', type: 'multi', options: listOpts('avaliador'), col: 3 });
const tratF = () => ({ name: 'tratamentos', label: 'Tratamentos', type: 'multi', options: listOpts('tratamento'), col: 3 });
const funnelCols = (first) => [first, num('leads', 'Leads'), num('agendamentos', 'Agendamentos'), perc('pct_agend', '% Agend.'), num('agendados', 'Agendados'),
  num('compareceu', 'Compareceu'), perc('pct_comp', '% Comp.'), num('fechados', 'Fechados'), perc('pct_fecha', '% Fecha.'), money('valor_orcado', 'Valor Orçado'),
  money('valor_fechado', 'Valor Fechado'), money('valor_desconto', 'Valor Desconto'), perc('pct_conversao', '% Conversão'), money('ticket_medio', 'Ticket Médio')];
const FUNNEL_LEGEND = {
  Leads: 'Leads criados no período', Agendamentos: 'Agendamentos criados no período', '% Agend.': 'Leads agendados ÷ leads criados',
  Agendados: 'Leads distintos com agendamento criado no período', Compareceu: 'Leads distintos que compareceram (data da consulta no período)',
  '% Comp.': 'Compareceram ÷ agendados', Fechados: 'Orçamentos fechados no período', '% Fecha.': 'Fechados ÷ compareceram',
  'Valor Orçado': 'Soma dos orçamentos emitidos no período', 'Valor Fechado': 'Soma dos valores fechados no período',
  'Valor Desconto': 'Orçado − fechado nos orçamentos fechados', '% Conversão': 'Fechados ÷ leads', 'Ticket Médio': 'Valor fechado ÷ fechados',
};

export const REPORTS = {
  usuarios: { title: 'Usuários por Ação', desc: 'Ações realizadas por cada usuário', filters: () => [...dates, origensF()],
    columns: [{ key: 'nome', label: 'Nome' }, num('criados', 'Leads criados'), num('modificados', 'Leads modificados'), num('excluidos', 'Leads excluídos'),
      num('contato_manual', 'Contato Manual'), num('agendamentos', 'Agendamentos'), num('faltas', 'Faltas'), num('comparecimentos', 'Comparecimentos')],
    legend: { 'Contato Manual': 'Contatos registrados manualmente (ligação ou mensagem)', Faltas: 'Agendamentos marcados como "Faltou"', Comparecimentos: 'Agendamentos marcados como "Compareceu"' } },
  leads: { title: 'Leads por Status', desc: 'Distribuição dos leads por status', filters: () => [...dates, origensF()], chart: true,
    columns: [{ key: 'status', label: 'Status' }, num('qtd', 'Quantidade'), perc('pct', '%')], legend: { Quantidade: 'Leads criados no período com o status atual' } },
  origem: { title: 'Métricas de Origem', desc: 'Funil e valores por origem', filters: () => [...dates, origensF(),
    { name: 'grupos', label: 'Base de origem', type: 'multi', options: [...new Set(state.lists.filter((l) => l.type === 'origem' && l.grupo).map((l) => l.grupo))].map((g) => ({ value: g, label: g })), col: 3 },
    avalF(), tratF(), { name: 'disparos_leads', label: 'Disparos para Leads', type: 'checkbox', col: 3 }, { name: 'disparos_pacientes', label: 'Disparos para Pacientes', type: 'checkbox', col: 3 }],
  columns: funnelCols({ key: 'nome', label: 'Origem' }), legend: FUNNEL_LEGEND },
  'usuarios-metricas': { title: 'Métricas de Usuários', desc: 'Mesmas métricas do funil, por usuário', filters: () => [...dates, origensF(), avalF(), tratF()],
    columns: funnelCols({ key: 'nome', label: 'Usuário' }), legend: { ...FUNNEL_LEGEND, Usuário: 'Leads: quem criou. Orçamentos: CRC responsável pelo follow-up' } },
  'ferramenta-comercial': { title: 'Ferramenta comercial', desc: 'Orçamentos, vendas por CRC e por avaliador', href: '#/ferramenta-comercial' },
  'leads-reaquecidos': { title: 'Leads Reaquecidos', desc: 'Leads que voltaram a entrar em contato', filters: () => dates,
    columns: [num('id', 'ID Lead'), { key: 'nome', label: 'Nome' }, { key: 'telefone', label: 'Telefone', render: (r) => esc(fmtPhone(r.telefone)) }, num('qtd', 'Qtd. Reaquecimentos'),
      { key: 'origem', label: 'Origem Inicial' }, { key: 'data_reaquecimento', label: 'Data de Reaquecimento', render: (r) => fmtDateTime(r.data_reaquecimento) },
      { key: 'primeiro_cadastro', label: 'Data do primeiro cadastro', render: (r) => fmtDateTime(r.primeiro_cadastro) }],
    legend: { 'Qtd. Reaquecimentos': 'Vezes em que o mesmo telefone voltou como lead novo no período' } },
  'metricas-orcamentos-fechados': { title: 'Orçamentos Fechados', desc: 'Fechamentos por vendedor', filters: () => [...dates, origensF(), avalF(), tratF()],
    columns: [{ key: 'vendedor', label: 'Vendedor' }, num('fechados', 'Fechados'), money('total', 'Total Fechado'), money('ticket_medio', 'Ticket Médio')],
    legend: { Vendedor: 'CRC responsável pelo follow-up do orçamento' } },
  'metricas-comparecimento-por-agendamento': { title: 'Comparecidos por Distância do Agendamento', desc: 'Taxa de comparecimento conforme os dias entre marcação e consulta',
    filters: () => [...dates, origensF()], chart: 'taxa',
    columns: [{ key: 'faixa', label: 'Distância', noSort: true }, num('agendamentos', 'Agendamentos'), num('comparecimentos', 'Comparecimentos'), num('faltas', 'Faltas'), perc('taxa', 'Taxa de comparecimento')],
    legend: { Distância: 'Dias entre a criação do agendamento e a data da consulta' } },
  'diagnostico-discador': { title: 'Diagnóstico do Discador', desc: 'Indicadores mensais de uso do discador e da operação', filters: () => dates,
    columns: [{ key: 'mes', label: 'Mês' }, { key: 'api_ativa', label: 'API WhatsApp ativa' }, { key: 'cloudia', label: 'Cloudia' }, num('leads', 'Leads criados'),
      num('leads_whatsapp', 'Leads criados pelo WhatsApp'), perc('pct_anotacoes', '% com anotações'), perc('pct_status', '% com alteração de status'),
      num('ligacoes_faltantes', 'Ligações a faltantes'), num('retornos_agendados', 'Retornos agendados'), num('ligacoes', 'Ligações'), num('media_ligacoes', 'Média de ligações por lead')],
    legend: { 'Ligações a faltantes': 'Ligações para leads com agendamento marcado como "Faltou"', 'Retornos agendados': 'Leads criados no mês com próximo contato definido' } },
  'relatorio-custo-ia': { title: 'Custos IA', desc: 'Interações entre leads e a IA', filters: () => dates,
    columns: [num('id', 'ID'), { key: 'cliente', label: 'Cliente' }, { key: 'lead', label: 'Lead' }, { key: 'telefone', label: 'Telefone', render: (r) => esc(fmtPhone(r.telefone)) },
      { key: 'data', label: 'Data Criação', render: (r) => fmtDateTime(r.data) }, { key: 'origem', label: 'Origem' }, num('pausas', 'Quantidade de pausas')],
    legend: { 'Quantidade de pausas': 'Vezes em que a IA foi pausada na conversa com o lead' } },
};

export async function home(view) {
  view.innerHTML = `${pageHeader('Relatórios', 'Relatórios de desempenho')}
    <div class="tiles">${Object.entries(REPORTS).map(([k, r]) => `<a class="tile" href="${r.href || `#/relatorios/${k}`}"><h3>${esc(r.title)}</h3><p class="muted">${esc(r.desc)}</p><span class="btn btn-sm">Acessar</span></a>`).join('')}</div>`;
}

function legendBtn(legend) {
  return () => modal({ title: 'Legendas', body: `<dl class="dl wide">${Object.entries(legend || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` });
}

function barChart(rows, labelKey, valueKey, fmt = (v) => v) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span>${esc(r[labelKey])}</span><div><i style="width:${(r[valueKey] / max) * 100}%"></i></div><b>${fmt(r[valueKey])}</b></div>`).join('')}</div>`;
}

export async function render(view, { name }) {
  const rep = REPORTS[name];
  if (!rep || rep.href) { view.innerHTML = '<div class="empty-state"><h2>Relatório não encontrado</h2></div>'; return; }
  const t = todayISO();
  const fields = rep.filters();
  let q = { from: `${t.slice(0, 7)}-01`, to: t };
  view.innerHTML = `${pageHeader(rep.title, esc(rep.desc), `<button class="btn" id="leg">Legendas</button>${backBtn('#/relatorios')}`)}
    <div class="card filters"><div class="card-body">${formHTML(fields, q)}<div class="filter-actions"><button class="btn" id="clr">Limpar</button><button class="btn btn-primary" id="go">Filtrar</button></div></div></div>
    <div id="chart"></div><div id="tbl"></div>`;
  initMulti(view);
  view.querySelector('#leg').onclick = legendBtn(rep.legend);
  const table = dataTable(view.querySelector('#tbl'), { id: `rel_${name}`, columns: rep.columns, exportName: name, pageSize: 50 });
  const load = async () => {
    try {
      const rows = await api.get(`/reports/${name}`, q);
      table.setRows(rows.map((r, i) => ({ id: i, ...r })));
      const ch = view.querySelector('#chart');
      if (rep.chart === true) ch.innerHTML = rows.length ? card('Gráfico', barChart(rows, 'status', 'qtd')) : '';
      else if (rep.chart) ch.innerHTML = card('Taxa de comparecimento', barChart(rows, 'faixa', rep.chart, fmtPct));
    } catch (e) { errToast(e); }
  };
  view.querySelector('#go').onclick = () => { try { q = readForm(view.querySelector('.filters'), fields); Object.keys(q).forEach((k) => { if (q[k] === 0) delete q[k]; }); load(); } catch (e) { errToast(e); } };
  view.querySelector('#clr').onclick = () => render(view, { name });
  await load();
}

export async function ferramenta(view) {
  const t = todayISO();
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const fields = [
    { name: 'mes', label: 'Mês', type: 'select', noEmpty: true, options: MESES.map((m, i) => ({ value: i + 1, label: m })), col: 2 },
    { name: 'ano', label: 'Ano', type: 'number', col: 2 },
    { name: 'tipo_fechamento', label: 'Tipo de fechamento', type: 'select', options: opts(['Em Aberto', 'Fechado', 'Reprovado', 'Em Acompanhamento']), emptyLabel: 'Todos', col: 2 },
    { name: 'crc', label: 'CRC responsável pelo follow-up', type: 'select', options: userOpts(), emptyLabel: 'Todos', col: 3 },
    { name: 'tratamento', label: 'Tipo de tratamento', type: 'select', options: listOpts('tratamento'), emptyLabel: 'Todos', col: 3 },
    { name: 'marketing', label: 'Tipo de marketing', type: 'select', options: [{ value: 'sim', label: 'Marketing' }, { value: 'nao', label: 'Não marketing' }], emptyLabel: 'Todos', col: 3 },
    { name: 'cliente', label: 'Cliente', col: 3 }, { name: 'avaliador', label: 'Avaliador', type: 'select', options: listOpts('avaliador'), emptyLabel: 'Todos', col: 3 },
  ];
  let q = { mes: Number(t.slice(5, 7)), ano: Number(t.slice(0, 4)) };
  view.innerHTML = `${pageHeader('Ferramenta comercial', 'Orçamentos e vendas do mês', `<button class="btn" id="leg">Legendas</button>${backBtn('#/relatorios')}`)}
    <div class="card filters"><div class="card-body">${formHTML(fields, q)}<div class="filter-actions"><button class="btn btn-primary" id="go">Filtrar</button></div></div></div>
    ${card('Orçamentos', '<div id="t1"></div>')}<div class="grid-2">${card('Vendas por CRC Comercial', '<div id="t2"></div>')}${card('Vendas por Avaliador', '<div id="t3"></div>')}</div>`;
  view.querySelector('#leg').onclick = legendBtn({ Oportunidade: 'Valor orçado', Conversão: 'Valor fechado ÷ valor orçado', Desconto: 'Orçado − fechado (orçamentos fechados)', 'Follow-up': 'CRC responsável pelo acompanhamento' });
  const aggCols = (label) => [{ key: 'nome', label }, num('orcamentos', 'Orçamentos'), num('fechados', 'Fechados'), money('oportunidade', 'Oportunidade'), money('vendido', 'Vendido'), perc('conversao', '% Conversão'), money('ticket_medio', 'Ticket médio')];
  const t1 = dataTable(view.querySelector('#t1'), { id: 'fc1', exportName: 'orcamentos', columns: [num('id', 'ID'), { key: 'cliente', label: 'Cliente' },
    { key: 'data_orcamento', label: 'Data orçamento', render: (r) => fmtDate(r.data_orcamento) }, { key: 'data_fechamento', label: 'Data fechamento', render: (r) => fmtDate(r.data_fechamento) },
    { key: 'tratamento', label: 'Tipo' }, { key: 'avaliador', label: 'Avaliador' }, { key: 'status', label: 'Status' }, money('oportunidade', 'Oportunidade'), money('fechado', 'Fechado'),
    perc('conversao', 'Conversão'), money('desconto', 'Desconto'), { key: 'entrada', label: 'Entrada' }, { key: 'followup', label: 'Follow-up' }] });
  const t2 = dataTable(view.querySelector('#t2'), { id: 'fc2', exportName: 'vendas-por-crc', columns: aggCols('CRC') });
  const t3 = dataTable(view.querySelector('#t3'), { id: 'fc3', exportName: 'vendas-por-avaliador', columns: aggCols('Avaliador') });
  const load = async () => {
    try {
      const d = await api.get('/reports/ferramenta-comercial', q);
      t1.setRows(d.orcamentos); t2.setRows(d.porCrc.map((r, i) => ({ id: i, ...r }))); t3.setRows(d.porAvaliador.map((r, i) => ({ id: i, ...r })));
    } catch (e) { errToast(e); }
  };
  view.querySelector('#go').onclick = () => { try { q = readForm(view.querySelector('.filters'), fields); load(); } catch (e) { errToast(e); } };
  await load();
}
