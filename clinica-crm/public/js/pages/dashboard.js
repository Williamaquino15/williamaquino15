// Painel de Indicadores: funil, valores, metas com projeção e tabela diária.
import {
  state, api, esc, toast, errToast, modal, formModal, pageHeader, card, kpi, listOpts, fmtMoney, fmtPct, fmtDate, todayISO,
  formHTML, readForm, initMulti, exportCSV, exportXLS, fmtDateTime, userName,
} from '../core.js';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export async function render(view) {
  const t = todayISO();
  let q = { from: `${t.slice(0, 7)}-01`, to: t, origens: [], etiquetas: [], seg: 'todos' };
  let detalhado = false;
  const ffields = [
    { name: 'from', label: 'Data inicial', type: 'date', col: 2 }, { name: 'to', label: 'Data final', type: 'date', col: 2 },
    { name: 'origens', label: 'Origens', type: 'multi', options: listOpts('origem'), col: 3 },
    { name: 'etiquetas', label: 'Etiquetas', type: 'multi', options: listOpts('etiqueta'), col: 2 },
    { name: 'seg', label: 'Segmentação', type: 'select', noEmpty: true, col: 3, options: [{ value: 'todos', label: 'Todos os dados no período' }, { value: 'criados', label: 'Apenas os dados dos leads criados no período' }] },
  ];
  view.innerHTML = `${pageHeader('Painel de Indicadores', 'Funil comercial, metas e métricas do período')}
    <div class="card filters"><div class="card-body">${formHTML(ffields, q)}<div class="filter-actions"><button class="btn btn-primary" id="apply">Alterar Datas / Aplicar</button></div></div></div>
    <div id="dash"></div>`;
  initMulti(view);
  view.querySelector('#apply').onclick = () => { try { q = readForm(view.querySelector('.filters'), ffields); load(); } catch (e) { errToast(e); } };

  async function load() {
    const box = view.querySelector('#dash');
    box.innerHTML = '<div class="loading">Carregando…</div>';
    try { draw(await api.get('/dashboard', q)); } catch (e) { errToast(e); box.innerHTML = ''; }
  }

  function draw(d) {
    const box = view.querySelector('#dash');
    const max = Math.max(1, d.funil[0].qtd);
    const fin = d.financeiro;
    const m = d.metas;
    const [yy, mm] = m.month.split('-');
    box.innerHTML = `
    ${card('Dados descritivos', `
      <div class="funnel">${d.funil.map((f, i) => `<div class="funnel-row">
        <div class="funnel-label">${esc(f.label)}</div>
        <div class="funnel-bar"><div style="width:${Math.max(4, (f.qtd / max) * 100)}%"><b>${f.qtd}</b></div></div>
        <div class="funnel-conv">${i ? fmtPct(f.conv) : ''}</div></div>`).join('')}</div>
      <label class="check"><input type="checkbox" id="det" ${detalhado ? 'checked' : ''}> Visualizar informações mais detalhadas</label>
      <div id="detBox"></div>
      ${fin ? `<div class="kpis">${kpi('Valor total de fechamentos', fmtMoney(fin.valor_fechado))}${kpi('Valor total de oportunidades', fmtMoney(fin.valor_oportunidades))}
        ${kpi('Ticket médio', fmtMoney(fin.ticket_medio))}${kpi('Total de desconto aplicado', fmtMoney(fin.desconto))}</div>`
        : '<p class="muted">Valores em R$ visíveis apenas com a permissão "dados financeiros da Dashboard".</p>'}`)}
    ${card('Metas e vendas', `
      <div class="row wrap"><label class="field inline"><span>Informe o período</span><input type="month" id="month" value="${m.month}"></label>
        <button class="btn btn-primary" id="editGoals">Definir metas de ${mm}/${yy}</button><button class="btn" id="cfgMet">Configurar métricas</button></div>
      <div class="kpis">${kpi('Valor do Lead', fin ? fmtMoney(m.valor_lead) : '—', 'investimento ÷ leads do mês')}${kpi('Investimento', fin ? fmtMoney(m.investimento) : '—')}
        ${kpi('Ticket Médio', fin ? fmtMoney(m.ticket_real) : '—', m.meta_ticket && fin ? `meta ${fmtMoney(m.meta_ticket)}` : '')}
        ${kpi('Valor de Vendas', fin ? fmtMoney(m.vendas_real) : '—', m.meta_vendas && fin ? `meta ${fmtMoney(m.meta_vendas)} (${fmtPct(m.meta_vendas ? (m.vendas_real / m.meta_vendas) * 100 : 0)})` : '')}</div>
      <div class="goals">${m.itens.map((g) => `<div class="goal"><h4>${esc(g.label)}</h4>
        <div class="goal-nums"><span>Meta <b>${g.meta || '—'}</b></span><span>Progresso <b>${g.progresso}</b></span><span>Projeção Futura <b>${g.projecao}</b></span></div>
        <div class="progress"><div style="width:${Math.min(100, g.pct)}%"></div></div><small>${g.meta ? fmtPct(g.pct) + ' da meta' : 'Sem meta definida'}</small></div>`).join('')}</div>`)}
    ${card('Acompanhamento diário', `<div class="table-wrap"><table class="table daily"><thead><tr><th>Métrica</th><th>Total</th><th>Meta de média diária</th>${d.diario.dias.map((x) => `<th>${fmtDate(x).slice(0, 5)}</th>`).join('')}</tr></thead>
      <tbody>${d.diario.linhas.map((l) => `<tr><td>${esc(l.metrica)}</td><td><b>${l.total}</b></td><td>${l.meta_diaria ?? '—'}</td>${d.diario.dias.map((x) => `<td class="${l.meta_diaria && l.valores[x] >= l.meta_diaria ? 'ok' : ''}">${l.valores[x]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
    `<button class="btn btn-sm" id="calls">Ver Chamadas</button><button class="btn btn-sm" id="xls">Exportar Tabela</button><button class="btn btn-sm" id="csv">Exportar .csv</button>`)}`;

    const detBox = box.querySelector('#detBox');
    const drawDet = async () => {
      if (!detalhado) { detBox.innerHTML = ''; return; }
      const rows = await api.get('/reports/origem', { from: q.from, to: q.to, origens: q.origens, etiquetas: q.etiquetas });
      detBox.innerHTML = `<div class="table-wrap"><table class="table"><tr><th>Origem</th><th>Leads</th><th>Agendados</th><th>Compareceu</th><th>Fechados</th><th>% Conversão</th>${fin ? '<th>Valor Fechado</th>' : ''}</tr>
        ${rows.map((r) => `<tr><td>${esc(r.nome)}</td><td>${r.leads}</td><td>${r.agendados}</td><td>${r.compareceu}</td><td>${r.fechados}</td><td>${fmtPct(r.pct_conversao)}</td>${fin ? `<td>${fmtMoney(r.valor_fechado)}</td>` : ''}</tr>`).join('') || '<tr><td colspan="7" class="empty">Sem dados</td></tr>'}</table></div>`;
    };
    drawDet();
    box.querySelector('#det').onchange = (e) => { detalhado = e.target.checked; drawDet().catch(errToast); };
    const tableData = () => [['Métrica', 'Total', 'Meta diária', ...d.diario.dias.map(fmtDate)], d.diario.linhas.map((l) => [l.metrica, l.total, l.meta_diaria ?? '', ...d.diario.dias.map((x) => l.valores[x])])];
    box.querySelector('#xls').onclick = () => exportXLS('painel-diario', ...tableData());
    box.querySelector('#csv').onclick = () => exportCSV('painel-diario', ...tableData());
    box.querySelector('#month').onchange = (e) => { q.month = e.target.value; load(); };
    box.querySelector('#calls').onclick = async () => {
      const rows = await api.get('/reports/usuarios', { from: q.from, to: q.to });
      modal({ title: 'Chamadas e contatos no período', body: `<table class="table"><tr><th>Usuário</th><th>Contatos manuais</th><th>Agendamentos</th><th>Comparecimentos</th></tr>
        ${rows.map((r) => `<tr><td>${esc(r.nome)}</td><td>${r.contato_manual}</td><td>${r.agendamentos}</td><td>${r.comparecimentos}</td></tr>`).join('')}</table>` });
    };
    box.querySelector('#editGoals').onclick = async () => {
      const month = box.querySelector('#month').value || m.month;
      const g = await api.get(`/goals/${month}`);
      formModal({ title: `Metas de ${month.split('-').reverse().join('/')}`, values: g, fields: [
        { name: 'leads', label: 'Meta de Leads Criados', type: 'number', min: 0, col: 6 }, { name: 'agendados', label: 'Meta de Agendados', type: 'number', min: 0, col: 6 },
        { name: 'compareceu', label: 'Meta de Comparecimentos', type: 'number', min: 0, col: 6 }, { name: 'fechados', label: 'Meta de Fechamentos', type: 'number', min: 0, col: 6 },
        { name: 'investimento', label: 'Investimento (R$)', type: 'number', min: 0, col: 4 }, { name: 'ticket_medio', label: 'Meta de Ticket Médio (R$)', type: 'number', min: 0, col: 4 },
        { name: 'valor_vendas', label: 'Meta de Valor de Vendas (R$)', type: 'number', min: 0, col: 4 },
      ], onSubmit: async (v) => { await api.put(`/goals/${month}`, v); toast('Metas salvas'); q.month = month; load(); } });
    };
    box.querySelector('#cfgMet').onclick = async () => {
      const cfg = await api.get('/settings/metricas');
      const dias = cfg.dias || [1, 2, 3, 4, 5];
      formModal({ title: 'Configurar métricas', fields: [
        { type: 'html', html: '<p class="muted">Dias da semana considerados no acompanhamento diário e na projeção:</p>' },
        ...DIAS.map((n, i) => ({ name: `d${i}`, label: n, type: 'checkbox', col: 6 }))],
      values: Object.fromEntries(DIAS.map((n, i) => [`d${i}`, dias.includes(i) ? 1 : 0])),
      onSubmit: async (v) => { await api.put('/settings/metricas', { dias: DIAS.map((n, i) => (v[`d${i}`] ? i : null)).filter((x) => x !== null) }); toast('Métricas salvas'); load(); } });
    };
  }
  await load();
}
export { state, fmtDateTime, userName };
