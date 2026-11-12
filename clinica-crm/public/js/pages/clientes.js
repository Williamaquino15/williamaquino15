// Clientes (pacientes): lista, filtros, criação retroativa, importação e ficha com orçamentos e atividades.
import {
  state, api, esc, toast, errToast, modal, confirmDialog, promptDialog, formModal, dataTable, pageHeader, backBtn, card,
  filterPanel, parseQuery, listOpts, ln, userName, userOpts, opts, fmtDate, fmtDateTime, fmtPhone, fmtMoney, tagsHTML,
  todayISO, nowTime, joinDT, splitDT, bind, kpi,
} from '../core.js';
import { importDialog } from './leads.js';

const SITUACOES = () => listOpts('situacao').map((o) => ({ value: o.label, label: o.label }));
const STATUS_ORC = ['Em Aberto', 'Fechado', 'Reprovado', 'Em Acompanhamento'];
const PAGAMENTOS = ['Boleto', 'Dinheiro', 'Transferência', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Convênio'];
const campName = (id) => state.campaigns.find((c) => c.id === Number(id))?.nome || '';

function columns() {
  return [
    { key: 'name', label: 'Nome', render: (r) => `<a href="#/clientes/editar/${r.id}">${esc(r.name)}</a>` },
    { key: 'created_at', label: 'Data registro', render: (r) => fmtDate(r.created_at) },
    { key: 'phone', label: 'Telefone', render: (r) => `${esc(fmtPhone(r.phone, r.ddi))}${r.dup > 1 ? ' <span class="pill warn">rep.</span>' : ''}` },
    { key: 'proximo_contato', label: 'Próx. Contato', render: (r) => fmtDateTime(r.proximo_contato) },
    { key: 'prob_fechamento', label: 'Prob. de Fechamento', render: (r) => `${r.prob_fechamento || 0}%`, sort: (r) => r.prob_fechamento || 0 },
    { key: 'tentativas', label: 'Tentativas', sort: (r) => r.tentativas || 0 },
    { key: 'fase_id', label: 'Fase', render: (r) => esc(ln(r.fase_id)) },
    { key: 'situacao', label: 'Situação' },
    { key: 'primeiro_fechamento', label: 'Data do primeiro fechamento', render: (r) => fmtDate(r.primeiro_fechamento) },
    { key: 'tratamentos', label: 'Tratamento', render: (r) => esc(r.tratamentos.map(ln).join(', ')), noSort: true },
    { key: 'valor_orcado', label: 'Valor Orçado', render: (r) => fmtMoney(r.valor_orcado), sort: (r) => r.valor_orcado, cls: 'num' },
    { key: 'valor_fechado', label: 'Valor Fechado', render: (r) => fmtMoney(r.valor_fechado), sort: (r) => r.valor_fechado, cls: 'num' },
    { key: 'origem_id', label: 'Origem', render: (r) => esc(ln(r.origem_id)) },
    { key: 'responsavel_id', label: 'Usuário Responsável', render: (r) => esc(userName(r.responsavel_id)) },
    { key: 'avaliadores', label: 'Avaliador', render: (r) => esc(r.avaliadores.map(ln).join(', ')), noSort: true },
    { key: 'updated_at', label: 'Última Modificação', render: (r) => fmtDateTime(r.updated_at) },
    { key: 'updated_by', label: 'Último Modificador', render: (r) => esc(userName(r.updated_by)) },
    { key: 'tags', label: 'Etiquetas', render: (r) => tagsHTML(r.tags), noSort: true },
    { key: 'campanha_id', label: 'Campanha', render: (r) => esc(campName(r.campanha_id)) },
  ];
}

export async function list(view) {
  let filters = { ...parseQuery() };
  view.innerHTML = `${pageHeader('Clientes', 'Base de pacientes que compareceram ou têm orçamento', `
    <span class="pill big" id="count">0 clientes</span>
    <button class="btn" data-import>Importar Clientes</button>
    <button class="btn btn-primary" data-new>+ Criar Cliente Retroativo</button>`)}
    <div class="quick-search card"><div class="card-body row">
      <input id="qs" maxlength="50" placeholder="Buscar por nome, telefone ou ID" value="${esc(filters.q || '')}">
      <button class="btn btn-primary" id="go">Buscar</button><button class="btn" id="dia">Contatos do dia</button>
      <button class="btn" id="toggleF">Filtros</button><button class="btn" id="clearF">Limpar filtros</button></div></div>
    <div id="fbox" hidden></div><div class="kpis" id="totais"></div><div id="tbl"></div>`;
  const ffields = [
    { name: 'name', label: 'Buscar por nome', col: 3 }, { name: 'phone', label: 'Telefone', col: 3 },
    { name: 'reg_de', label: 'Data de registro (mín.)', type: 'date', col: 3 }, { name: 'reg_ate', label: 'Data de registro (máx.)', type: 'date', col: 3 },
    { name: 'fase', label: 'Fase', type: 'multi', options: listOpts('fase'), col: 3 },
    { name: 'situacao', label: 'Situação', type: 'multi', options: SITUACOES(), col: 3 },
    { name: 'tratamento', label: 'Tratamento', type: 'multi', options: listOpts('tratamento'), col: 3 },
    { name: 'origem', label: 'Origem', type: 'multi', options: listOpts('origem'), col: 3 },
    { name: 'etiquetas', label: 'Etiquetas', type: 'multi', options: listOpts('etiqueta'), col: 3 },
    { name: 'avaliador', label: 'Avaliador', type: 'multi', options: listOpts('avaliador'), col: 3 },
    { name: 'responsavel', label: 'Responsável', type: 'multi', options: userOpts(), col: 3 },
    { name: 'modificador', label: 'Último modificador', type: 'multi', options: userOpts(), col: 3 },
    { name: 'prox_de', label: 'Próximo contato (de)', type: 'date', col: 3 }, { name: 'prox_ate', label: 'Próximo contato (até)', type: 'date', col: 3 },
    { name: 'cons_de', label: 'Última consulta (de)', type: 'date', col: 3 }, { name: 'cons_ate', label: 'Última consulta (até)', type: 'date', col: 3 },
    { name: 'fech_de', label: 'Primeiro fechamento (de)', type: 'date', col: 3 }, { name: 'fech_ate', label: 'Primeiro fechamento (até)', type: 'date', col: 3 },
    { name: 'tentativas', label: 'Tentativas', type: 'number', min: 0, col: 3 },
    { name: 'com_tel', label: 'Com telefone', type: 'checkbox', col: 2 }, { name: 'sem_tel', label: 'Sem telefone', type: 'checkbox', col: 2 },
    { name: 'repetidos', label: 'Telefones repetidos', type: 'checkbox', col: 2 }, { name: 'parciais', label: 'Buscar orçamentos parciais', type: 'checkbox', col: 3 },
    { name: 'prox_nao_informado', label: 'Próximo contato "Não informado"', type: 'checkbox', col: 3 },
  ];
  const fbox = view.querySelector('#fbox');
  const mount = () => {
    fbox.innerHTML = '';
    fbox.appendChild(filterPanel(ffields, filters, {
      onFilter: (v) => { filters = { ...v, q: view.querySelector('#qs').value.trim() }; Object.keys(filters).forEach((k) => { if (filters[k] === 0 || filters[k] === null) delete filters[k]; }); load(); },
      onClear: () => { filters = {}; view.querySelector('#qs').value = ''; mount(); load(); },
    }));
  };
  mount();
  const table = dataTable(view.querySelector('#tbl'), {
    id: 'clientes', columns: columns(), exportName: 'clientes', onRowClick: (r) => { location.hash = `#/clientes/editar/${r.id}`; },
    actions: (r) => `<a class="icon-btn" href="#/clientes/editar/${r.id}" title="Abrir">✎</a>`,
  });
  async function load() {
    try {
      const rows = await api.get('/clients', filters);
      table.setRows(rows);
      view.querySelector('#count').textContent = `${rows.length} cliente(s)`;
      // Fechado = cliente com ao menos um orçamento fechado.
      const fechados = rows.filter((r) => r.primeiro_fechamento || r.valor_fechado > 0);
      view.querySelector('#totais').innerHTML =
        kpi('Total não fechados', String(rows.length - fechados.length), 'clientes sem orçamento fechado')
        + kpi('Total fechados', String(fechados.length), 'clientes com orçamento fechado')
        + kpi('Valor orçado', fmtMoney(rows.reduce((t, r) => t + (r.valor_orcado || 0), 0)), 'soma dos orçamentos')
        + kpi('Valor total fechado', fmtMoney(rows.reduce((t, r) => t + (r.valor_fechado || 0), 0)), 'soma dos fechamentos');
    } catch (e) { errToast(e); }
  }
  await load();
  const quick = () => { filters.q = view.querySelector('#qs').value.trim(); load(); };
  view.querySelector('#go').onclick = quick;
  view.querySelector('#qs').onkeydown = (e) => { if (e.key === 'Enter') quick(); };
  view.querySelector('#dia').onclick = () => { filters = { contatos_dia: '1' }; load(); };
  view.querySelector('#toggleF').onclick = () => { fbox.hidden = !fbox.hidden; };
  view.querySelector('#clearF').onclick = () => { filters = {}; view.querySelector('#qs').value = ''; mount(); load(); };
  view.querySelector('[data-import]').onclick = () => importDialog('/clients/import', ['nome', 'telefone', 'data_registro', 'profissao', 'data_comparecimento'], load);
  view.querySelector('[data-new]').onclick = () => formModal({
    title: 'Criar Cliente Retroativo', size: 'lg', submitLabel: 'Criar',
    fields: [
      { name: 'data_inc', label: 'Data de Inclusão', type: 'date', required: true, col: 6 }, { name: 'hora_inc', label: 'Hora', type: 'time', col: 6 },
      { name: 'name', label: 'Nome', required: true }, { name: 'phone', label: 'Telefone', type: 'phone' },
      { name: 'origem_id', label: 'Origem', type: 'select', numeric: true, options: listOpts('origem') },
      { name: 'data_comparecimento', label: 'Comparecimento', type: 'date', col: 6 }, { name: 'hora_comparecimento', label: 'Hora', type: 'time', col: 6 },
      { name: 'anotacoes', label: 'Anotações', type: 'textarea' },
    ],
    values: { data_inc: todayISO(), hora_inc: nowTime() },
    onSubmit: async (v) => {
      const { data_inc, hora_inc, ...rest } = v;
      const r = await api.post('/clients', { ...rest, created_at: joinDT(data_inc, hora_inc) });
      toast('Cliente criado');
      location.hash = `#/clientes/editar/${r.id}`;
    },
  });
}

// ---------------------------------------------------------------- ficha do cliente
export async function ficha(view, { id }) {
  let data = await api.get(`/clients/${id}`);

  const render = () => {
    const c = data.client;
    const acordado = data.budgets.reduce((s, b) => s + (b.valor_orcado || 0), 0);
    const fechado = data.budgets.filter((b) => b.status === 'Fechado').reduce((s, b) => s + (b.valor_fechado || 0), 0);
    const desconto = data.budgets.filter((b) => b.status === 'Fechado').reduce((s, b) => s + Math.max(0, (b.valor_orcado || 0) - (b.valor_fechado || 0)), 0);
    view.innerHTML = `${pageHeader(c.name, `Cliente #${c.id}${c.lead_id ? ` · <a href="#/leads/editar/${c.lead_id}">Lead #${c.lead_id}</a>` : ''} · ${esc(c.situacao || '')}`, backBtn('#/clientes'))}
    <div class="ficha">
      <div class="ficha-main">
        ${card('Orçamentos / Fechamentos', `<div class="kpis">${kpi('Acordado', fmtMoney(acordado))}${kpi('Fechado', fmtMoney(fechado))}${kpi('Desconto', fmtMoney(desconto))}</div>
          <div class="table-wrap"><table class="table"><tr><th>Data</th><th>Tratamento</th><th>Avaliador</th><th>Status</th><th class="num">Orçado</th><th class="num">Fechado</th><th>Pagamento</th><th>Fechamento</th><th></th></tr>
          ${data.budgets.map((b) => {
            const parc = data.closings.filter((x) => x.budget_id === b.id);
            return `<tr><td>${fmtDate(b.data_orcamento)}</td><td>${esc(ln(b.tratamento_id))}</td><td>${esc(ln(b.avaliador_id))}</td><td><span class="pill st-${esc(b.status)}">${esc(b.status)}</span></td>
            <td class="num">${fmtMoney(b.valor_orcado)}</td><td class="num">${fmtMoney(b.valor_fechado)}${parc.length ? `<br><small>${parc.length} fechamento(s) parcial(is)</small>` : ''}</td>
            <td>${esc(b.forma_pagamento || '')}${b.parcelas > 1 ? ` ${b.parcelas}x` : ''}</td><td>${fmtDate(b.data_fechamento)}</td>
            <td class="nowrap"><button class="icon-btn" data-bedit="${b.id}" title="Editar">✎</button><button class="icon-btn" data-bclose="${b.id}" title="Adicionar fechamento">＋</button><button class="icon-btn danger" data-bdel="${b.id}" title="Excluir">✕</button></td></tr>`;
          }).join('') || '<tr><td colspan="9" class="empty">Nenhum orçamento</td></tr>'}</table></div>`,
        '<button class="btn btn-sm btn-primary" data-a="newb">+ Novo</button>')}
        ${card('Registro de atividades', `<div class="timeline">${data.activities.map((a) => `<div class="tl-item"><div class="tl-head"><b>${fmtDateTime(a.date)}</b> · ${esc(userName(a.user_id))}
            ${a.fase_id ? ` · Fase: ${esc(ln(a.fase_id))}` : ''}${a.prob != null ? ` · Prob.: ${a.prob}%` : ''}${a.proximo_contato ? ` · Próx.: ${fmtDateTime(a.proximo_contato)}` : ''}</div><div>${esc(a.obs)}</div></div>`).join('') || '<p class="muted">Nenhuma atividade</p>'}</div>`,
        '<button class="btn btn-sm btn-primary" data-a="newact">+ Nova atividade</button>')}
        ${card('Conversa / Mensagens', `<div class="chat">${data.messages.map((m) => `<div class="msg ${m.direction}"><div>${esc(m.content)}</div><small>${esc(m.kind === 'audio' ? 'Transcrição de áudio' : m.kind === 'template' ? 'Modelo' : 'Mensagem')} · ${fmtDateTime(m.created_at)}</small></div>`).join('') || '<p class="muted center">Sem mensagens</p>'}</div>`,
        '<button class="btn btn-sm" data-a="newmsg">Adicionar Mensagem</button>')}
        ${card('Contatos', `<table class="table"><tr><th>Data</th><th>Tipo</th><th>Observação</th><th>Usuário</th></tr>${data.contacts.map((x) => `<tr><td>${fmtDateTime(x.date)}</td><td>${esc(x.tipo)}</td><td>${esc(x.obs)}</td><td>${esc(userName(x.user_id))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum contato</td></tr>'}</table>`,
        '<button class="btn btn-sm" data-a="newc">+ Novo Contato</button>')}
      </div>
      <aside class="ficha-side">
        ${card('Informações de Contato', `<dl class="dl">
          <dt>Último contato</dt><dd>${fmtDateTime(c.ultimo_contato) || '—'}</dd>
          <dt>Próximo contato</dt><dd>${fmtDateTime(c.proximo_contato) || 'Não informado'}</dd>
          <dt>Telefone</dt><dd>${c.phone ? `<a href="https://wa.me/${esc(String(c.ddi || '').replace('+', '') + c.phone)}" target="_blank" rel="noopener">${esc(fmtPhone(c.phone, c.ddi))}</a>` : '—'}</dd>
          <dt>Profissão</dt><dd>${esc(c.profissao) || '—'}</dd>
          <dt>Sintomas</dt><dd>${esc(c.sintomas) || '—'}</dd>
          <dt>Data cadastro LEAD</dt><dd>${fmtDateTime(c.data_lead) || '—'}</dd>
          <dt>Data de comparecimento</dt><dd>${fmtDate(c.data_comparecimento) || '—'}</dd>
          <dt>Data da última consulta</dt><dd>${fmtDate(c.ultima_consulta) || '—'}</dd>
          <dt>Origem</dt><dd>${esc(ln(c.origem_id)) || '—'}</dd>
          <dt>Usuário responsável</dt><dd>${esc(userName(c.responsavel_id)) || '—'}</dd>
          <dt>Fase</dt><dd>${esc(ln(c.fase_id)) || '—'}</dd>
          <dt>Probabilidade</dt><dd>${c.prob_fechamento || 0}%</dd>
          <dt>Tentativas de Retorno</dt><dd>${c.tentativas || 0}</dd></dl>
          <div class="row wrap"><button class="btn btn-primary" data-a="edit">Editar</button><button class="btn" data-a="resp">Alterar responsável</button><button class="btn btn-danger-o" data-a="del">Remover</button></div>`)}
        ${card('Etiquetas', `<div class="tags-box">${tagsHTML(c.tags) || '<span class="muted">Sem etiquetas</span>'}</div><button class="btn btn-sm" data-a="tags">Gerenciar Etiquetas</button>`)}
        ${card('Anotações', `<textarea id="notes" rows="5">${esc(c.anotacoes)}</textarea><button class="btn btn-sm btn-primary" data-a="notes">Salvar</button>`)}
      </aside>
    </div>`;
    wire();
  };
  const refresh = (d) => { data = d; render(); };
  const save = async (body) => refresh(await api.put(`/clients/${id}`, body));

  function budgetForm(b = {}) {
    const fields = [
      { name: 'avaliador_id', label: 'Avaliador', type: 'select', numeric: true, options: listOpts('avaliador'), col: 6 },
      { name: 'tratamento_id', label: 'Tratamento', type: 'select', numeric: true, options: listOpts('tratamento'), col: 6 },
      { name: 'status', label: 'Status', type: 'select', options: opts(STATUS_ORC), noEmpty: true, col: 6 },
      { name: 'followup_user_id', label: 'CRC responsável pelo follow-up', type: 'select', numeric: true, options: userOpts(), col: 6 },
      { name: 'valor_orcado', label: 'Valor orçado (R$)', type: 'number', min: 0, col: 6 },
      { name: 'valor_fechado', label: 'Valor fechado (R$)', type: 'number', min: 0, col: 6 },
      { name: 'entrada', label: 'Possui entrada?', type: 'radio', options: [{ value: 1, label: 'Sim' }, { value: 0, label: 'Não' }], col: 6 },
      { name: 'forma_pagamento', label: 'Forma de pagamento', type: 'select', options: opts(PAGAMENTOS), col: 6 },
      { name: 'valor_total', label: 'Valor total (R$)', type: 'number', min: 0, col: 6 },
      { name: 'parcelas', label: 'Qtd. de parcelas', type: 'number', min: 1, col: 6 },
      { name: 'data_orcamento', label: 'Data do orçamento', type: 'date', col: 4 },
      { name: 'data_fechamento', label: 'Data de fechamento', type: 'date', col: 4 },
      { name: 'inicio_tratamento', label: 'Início do tratamento', type: 'date', col: 4 },
      { name: 'obs', label: 'Observação', type: 'textarea' },
    ];
    formModal({ title: b.id ? 'Editar orçamento' : 'Novo orçamento', size: 'lg', fields,
      values: { status: 'Em Aberto', entrada: 0, parcelas: 1, data_orcamento: todayISO(), followup_user_id: state.user.id, ...b },
      onSubmit: async (v) => {
        v.entrada = Number(v.entrada) || 0;
        refresh(b.id ? await api.put(`/budgets/${b.id}`, v) : await api.post('/budgets', { ...v, client_id: +id }));
        toast('Orçamento salvo');
      } });
  }

  function wire() {
    bind(view, {
      '[data-bedit]': (e, el) => budgetForm(data.budgets.find((b) => b.id === +el.dataset.bedit)),
      '[data-bdel]': async (e, el) => { if (await confirmDialog('Excluir este orçamento?', { danger: true, ok: 'Excluir' })) refresh(await api.del(`/budgets/${el.dataset.bdel}`)); },
      '[data-bclose]': (e, el) => formModal({ title: 'Adicionar fechamento (parcial)', fields: [
        { name: 'valor', label: 'Valor (R$)', type: 'number', min: 0, required: true, col: 6 }, { name: 'data', label: 'Data', type: 'date', col: 6 },
        { name: 'forma_pagamento', label: 'Forma de pagamento', type: 'select', options: opts(PAGAMENTOS) }, { name: 'obs', label: 'Observação', type: 'textarea' }],
      values: { data: todayISO() }, onSubmit: async (v) => { refresh(await api.post(`/budgets/${el.dataset.bclose}/closings`, v)); toast('Fechamento adicionado'); } }),
      '[data-a]': (e, el) => actions[el.dataset.a] && Promise.resolve(actions[el.dataset.a]()).catch(errToast),
    });
  }
  const actions = {
    newb: () => budgetForm(),
    newact: () => {
      const c = data.client;
      formModal({ title: 'Nova atividade', fields: [
        { name: 'data', label: 'Data de registro', type: 'date', required: true, col: 6 }, { name: 'hora', label: 'Hora', type: 'time', col: 6 },
        { name: 'fase_id', label: 'Fase atual', type: 'select', numeric: true, options: listOpts('fase'), col: 6 },
        { name: 'prob', label: 'Probabilidade de fechamento (%)', type: 'number', min: 0, max: 100, col: 6 },
        { name: 'px_data', label: 'Próximo contato', type: 'date', col: 6 }, { name: 'px_hora', label: 'Hora', type: 'time', col: 6 },
        { name: 'obs', label: 'Observações', type: 'textarea', rows: 4 },
      ], values: { data: todayISO(), hora: nowTime(), fase_id: c.fase_id, prob: c.prob_fechamento }, onSubmit: async (v) => {
        refresh(await api.post('/activities', { client_id: +id, date: joinDT(v.data, v.hora), fase_id: v.fase_id, prob: v.prob,
          proximo_contato: v.px_data ? joinDT(v.px_data, v.px_hora) : null, obs: v.obs }));
        toast('Atividade registrada');
      } });
    },
    newmsg: () => formModal({ title: 'Adicionar Mensagem', fields: [
      { name: 'content', label: 'Conteúdo', type: 'textarea', required: true, rows: 4 },
      { name: 'kind', label: 'Tipo de Contato', type: 'select', noEmpty: true, options: [{ value: 'text', label: 'Mensagem de texto' }, { value: 'audio', label: 'Transcrição de áudio' }], col: 6 },
      { name: 'direction', label: 'Direção', type: 'select', noEmpty: true, options: [{ value: 'out', label: 'Enviada' }, { value: 'in', label: 'Recebida' }], col: 6 },
      { name: 'date', label: 'Data', type: 'date', col: 6 }],
    values: { date: todayISO() }, onSubmit: async (v) => { refresh(await api.post(`/clients/${id}/messages`, { ...v, date: v.date ? `${v.date} ${nowTime()}:00` : undefined })); } }),
    newc: () => formModal({ title: 'Novo Contato', fields: [
      { name: 'tipo', label: 'Tipo de Contato', type: 'select', noEmpty: true, options: opts(['Chamada por Mensagem', 'Chamada Telefônica']) },
      { name: 'obs', label: 'Observações', type: 'textarea' }],
    onSubmit: async (v) => { await api.post('/contacts', { ...v, client_id: +id }); refresh(await api.get(`/clients/${id}`)); } }),
    edit: () => {
      const c = data.client;
      const px = splitDT(c.proximo_contato);
      formModal({ title: 'Atualizar dados do cliente', size: 'lg', fields: [
        { name: 'name', label: 'Nome', required: true }, { name: 'phone', label: 'Telefone', type: 'phone', ddi: c.ddi },
        { name: 'profissao', label: 'Profissão', col: 6 }, { name: 'origem_id', label: 'Origem', type: 'select', numeric: true, options: listOpts('origem'), col: 6 },
        { name: 'sintomas', label: 'Sintomas', type: 'textarea' },
        { name: 'data_comparecimento', label: 'Data de comparecimento', type: 'date', col: 6 }, { name: 'ultima_consulta', label: 'Data da última consulta', type: 'date', col: 6 },
        { name: 'fase_id', label: 'Fase', type: 'select', numeric: true, options: listOpts('fase'), col: 6 },
        { name: 'situacao', label: 'Situação', type: 'select', options: SITUACOES(), col: 6 },
        { name: 'px_data', label: 'Próximo contato', type: 'date', col: 6 }, { name: 'px_hora', label: 'Hora', type: 'time', col: 6 },
        { name: 'tentativas', label: 'Tentativas de Retorno', type: 'number', min: 0, col: 6 },
        { name: 'responsavel_id', label: 'Usuário responsável', type: 'select', numeric: true, options: userOpts(), col: 6 },
      ], values: { ...c, px_data: px.date, px_hora: px.time }, onSubmit: async (v) => {
        const { px_data, px_hora, ...rest } = v;
        await save({ ...rest, proximo_contato: px_data ? joinDT(px_data, px_hora) : null });
        toast('Cliente atualizado');
      } });
    },
    resp: () => formModal({ title: 'Alterar usuário responsável', fields: [{ name: 'responsavel_id', label: 'Responsável', type: 'select', numeric: true, required: true, options: userOpts() }],
      values: data.client, onSubmit: (v) => save(v) }),
    del: async () => {
      const reason = await promptDialog('Remover cliente', 'Motivo da exclusão permanente');
      if (!reason) return;
      await api.del(`/clients/${id}`, { reason });
      toast('Cliente removido'); location.hash = '#/clientes';
    },
    tags: () => formModal({ title: 'Etiquetas', fields: [{ name: 'tags', label: 'Etiquetas', type: 'multi', options: listOpts('etiqueta') }], values: data.client, onSubmit: (v) => save(v) }),
    notes: async () => { await save({ anotacoes: view.querySelector('#notes').value }); toast('Anotações salvas'); },
  };
  render();
}
export { modal };
