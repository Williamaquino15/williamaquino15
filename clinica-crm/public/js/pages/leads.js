// Leads: lista, filtros, criação, importação, próximos contatos, excluídos e ficha do lead.
import {
  state, api, esc, toast, errToast, modal, confirmDialog, promptDialog, formModal, formHTML, readForm, initMulti,
  dataTable, pageHeader, backBtn, card, filterPanel, parseQuery, listOpts, ln, userName, opts, TEMPERATURAS,
  fmtDate, fmtDateTime, fmtPhone, tagsHTML, tempHTML, todayISO, nowTime, splitDT, joinDT, parseCSV, pickFile, bind,
} from '../core.js';

const campOpts = () => state.campaigns.map((c) => ({ value: c.id, label: c.nome }));
const campName = (id) => state.campaigns.find((c) => c.id === Number(id))?.nome || '';
const AG_STATUS = () => listOpts('status_agendamento').map((o) => ({ value: o.label, label: o.label }));
const TIPOS_CONTATO = ['Chamada por Mensagem', 'Chamada Telefônica'];

const editBtns = (r) => `<a class="icon-btn" href="#/leads/editar/${r.id}" title="Editar">✎</a><button class="icon-btn danger" data-del="${r.id}" title="Excluir">✕</button>`;

export function leadColumns() {
  return [
    { key: 'name', label: 'Nome', render: (r) => `<a href="#/leads/editar/${r.id}">${esc(r.name)}</a>` },
    { key: 'created_at', label: 'Inclusão', render: (r) => fmtDateTime(r.created_at) },
    { key: 'phone', label: 'Telefone', render: (r) => `${esc(fmtPhone(r.phone, r.ddi))}${r.dup > 1 ? ' <span class="pill warn" title="Telefone repetido">rep.</span>' : ''}` },
    { key: 'origem_id', label: 'Origem', render: (r) => esc(ln(r.origem_id)), sort: (r) => ln(r.origem_id) },
    { key: 'temperatura', label: 'Temperatura', render: (r) => tempHTML(r.temperatura), sort: (r) => TEMPERATURAS.indexOf(r.temperatura) },
    { key: 'status_id', label: 'Status Lead', render: (r) => esc(ln(r.status_id)), sort: (r) => ln(r.status_id) },
    { key: 'proximo_contato', label: 'Próximo Contato', render: (r) => fmtDateTime(r.proximo_contato) },
    { key: 'ag_status', label: 'Status Agendamento' },
    { key: 'ag_data', label: 'Agendamento', render: (r) => fmtDate(r.ag_data) },
    { key: 'ag_hora', label: 'Hora' },
    { key: 'anotacoes', label: 'Anotações', render: (r) => `<span class="clip" title="${esc(r.anotacoes)}">${esc(r.anotacoes)}</span>` },
    { key: 'tags', label: 'Etiquetas', render: (r) => tagsHTML(r.tags), noSort: true },
    { key: 'campanha_id', label: 'Campanha', render: (r) => esc(campName(r.campanha_id)) },
    { key: 'ligacoes', label: 'Ligações', sort: (r) => r.ligacoes },
  ];
}

function leadFields(v = {}) {
  const dt = splitDT(v.created_at || `${todayISO()} ${nowTime()}`);
  const px = splitDT(v.proximo_contato);
  return {
    fields: [
      { name: 'data_inc', label: 'Data de Inclusão', type: 'date', col: 6, required: true },
      { name: 'hora_inc', label: 'Hora', type: 'time', col: 6 },
      { name: 'name', label: 'Nome', required: true, col: 9, maxlength: 150 },
      { name: '_pesq', type: 'html', col: 3, html: '<label class="field-label-sp">&nbsp;</label><button type="button" class="btn btn-block" data-pesq>Pesquisar</button>' },
      { name: 'phone', label: 'Telefone', type: 'phone', col: 12, ddi: v.ddi, required: !!state.leadSettings.telefone_obrigatorio },
      { name: 'origem_id', label: 'Origem', type: 'select', numeric: true, options: listOpts('origem'), col: 6 },
      { name: 'campanha_id', label: 'Campanha', type: 'select', numeric: true, options: campOpts(), col: 6 },
      { name: 'tags', label: 'Etiquetas', type: 'multi', options: listOpts('etiqueta'), col: 12 },
      { name: 'temperatura', label: 'Temperatura', type: 'select', options: opts(TEMPERATURAS), col: 6 },
      { name: 'status_id', label: 'Status', type: 'select', numeric: true, options: listOpts('status'), col: 6 },
      { name: 'px_data', label: 'Próximo Contato', type: 'date', col: 6 },
      { name: 'px_hora', label: 'Hora', type: 'time', col: 6 },
      { name: 'anotacoes', label: 'Anotações', type: 'textarea', col: 12 },
    ],
    values: { ...v, data_inc: dt.date, hora_inc: dt.time, px_data: px.date, px_hora: px.time },
  };
}
const leadPayload = (x) => {
  const { data_inc, hora_inc, px_data, px_hora, _pesq, ...rest } = x;
  return { ...rest, created_at: joinDT(data_inc, hora_inc), proximo_contato: px_data ? joinDT(px_data, px_hora) : null };
};

async function showDuplicates(name, phone) {
  const rows = await api.get('/leads/check', { name, phone });
  modal({ title: 'Verificação de duplicidade', body: rows.length
    ? `<p>Encontrados ${rows.length} registro(s) parecidos:</p><table class="table"><tr><th>ID</th><th>Nome</th><th>Telefone</th><th>Inclusão</th></tr>${rows.map((r) =>
      `<tr><td>${r.id}</td><td><a href="#/leads/editar/${r.id}">${esc(r.name)}</a></td><td>${esc(fmtPhone(r.phone))}</td><td>${fmtDateTime(r.created_at)}</td></tr>`).join('')}</table>`
    : '<p>Nenhum lead com este nome ou telefone.</p>' });
}

export function openCreateLead(onDone) {
  const { fields, values } = leadFields();
  const m = formModal({
    title: 'Criar Lead', fields, values, submitLabel: 'Criar', size: 'lg',
    onSubmit: async (v) => {
      const body = leadPayload(v);
      let r = await api.post('/leads', body);
      if (r.duplicate) {
        const choice = await new Promise((resolve) => modal({
          title: 'Telefone já cadastrado',
          body: `<p>O telefone já pertence ao lead <b>${esc(r.duplicate.name)}</b> (ID ${r.duplicate.id}).</p><p>Você pode <b>reaquecer</b> o lead existente (registra o retorno dele) ou criar um novo mesmo assim.</p>`,
          onClose: () => resolve(null),
          buttons: [{ label: 'Cancelar', onClick: () => resolve(null) }, { label: 'Criar novo', onClick: () => resolve('force') }, { label: 'Reaquecer lead', cls: 'btn-primary', onClick: () => resolve('reaquecer') }],
        }));
        if (!choice) return false;
        r = await api.post('/leads', { ...body, [choice]: true });
      }
      toast(r.reaquecido ? 'Lead reaquecido' : 'Lead criado');
      onDone && onDone(r.id);
    },
  });
  m.body.querySelector('[data-pesq]').onclick = () => {
    const name = m.body.querySelector('[name=name]').value; const phone = m.body.querySelector('[name=phone]').value;
    showDuplicates(name, phone).catch(errToast);
  };
}

const FILTER_KEY = 'leadFilters';
function loadFilters() { try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; } }
function saveFilters(f) { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* ignore */ } }

export async function list(view) {
  let filters = loadFilters();
  view.innerHTML = `${pageHeader('Leads', 'Cadastro e acompanhamento de potenciais clientes', `
    <div class="dropdown" id="moreDd"><button class="btn">Mais opções ▾</button><div class="dropdown-menu right">
      <a href="#/leads/recuperar-leads-excluidos">Recuperar leads excluídos</a><a href="#" data-import>Importar Leads</a></div></div>
    <button class="btn btn-primary" data-new>+ Criar Lead</button>`)}
    <div class="quick-search card"><div class="card-body row">
      <input id="qs" maxlength="50" placeholder="Buscar lead ou cliente (telefone, nome, ID do lead ou do cliente)" value="${esc(filters.q || '')}">
      <button class="btn btn-primary" id="qsGo">Buscar</button><button class="btn" id="toggleF">Filtros</button><button class="btn" id="clearF">Limpar filtros</button>
    </div></div>
    <div id="fbox" hidden></div><div id="tbl"></div>`;

  const ffields = [
    { name: 'name', label: 'Nome', col: 3 }, { name: 'phone', label: 'Telefone', col: 3 },
    { name: 'inc_de', label: 'Inclusão de', type: 'date', col: 3 }, { name: 'inc_ate', label: 'Inclusão até', type: 'date', col: 3 },
    { name: 'ag_de', label: 'Agendamento de', type: 'date', col: 3 }, { name: 'ag_ate', label: 'Agendamento até', type: 'date', col: 3 },
    { name: 'origem', label: 'Origem', type: 'multi', options: listOpts('origem'), col: 3 },
    { name: 'temperatura', label: 'Temperatura', type: 'multi', options: opts(TEMPERATURAS), col: 3 },
    { name: 'status', label: 'Status do Lead', type: 'multi', options: listOpts('status'), col: 3 },
    { name: 'ag_status', label: 'Status do Agendamento', type: 'multi', options: AG_STATUS(), col: 3 },
    { name: 'etiquetas', label: 'Etiquetas', type: 'multi', options: listOpts('etiqueta'), col: 3 },
    { name: 'anotacoes', label: 'Anotações', col: 3 },
    { name: 'com_tel', label: 'Buscar Apenas Com Telefone', type: 'checkbox', col: 4 },
    { name: 'sem_tel', label: 'Buscar Apenas Sem Telefone', type: 'checkbox', col: 4 },
    { name: 'repetidos', label: 'Apenas Telefones Repetidos', type: 'checkbox', col: 4 },
  ];
  const fbox = view.querySelector('#fbox');
  const mountFilters = () => {
    fbox.innerHTML = '';
    fbox.appendChild(filterPanel(ffields, filters, {
      onFilter: (v) => { filters = { ...v, q: view.querySelector('#qs').value.trim() }; Object.keys(filters).forEach((k) => { if (filters[k] === 0) delete filters[k]; }); saveFilters(filters); load(); },
      onClear: () => { filters = {}; saveFilters(filters); view.querySelector('#qs').value = ''; mountFilters(); load(); },
    }));
  };
  mountFilters();
  if (Object.keys(filters).some((k) => k !== 'q')) fbox.hidden = false;

  const table = dataTable(view.querySelector('#tbl'), {
    id: 'leads', columns: leadColumns(), selectable: true, exportName: 'leads', actions: editBtns,
    onRowClick: (r) => { location.hash = `#/leads/editar/${r.id}`; },
    bulk: (n) => `<span>${n} selecionado(s)</span>
      <button class="btn btn-sm" data-bulk="edit" ${n ? '' : 'disabled'}>Editar selecionados</button>
      <button class="btn btn-sm btn-danger-o" data-bulk="delete" ${n ? '' : 'disabled'}>Excluir selecionados</button>
      <span class="sep"></span>
      <button class="btn btn-sm" data-bulk="edit-all">Editar todos (filtro)</button>
      <button class="btn btn-sm btn-danger-o" data-bulk="delete-all">Excluir todos (filtro)</button>`,
  });
  async function load() {
    try { table.setRows(await api.get('/leads', filters)); } catch (e) { errToast(e); }
  }
  await load();

  const apiQuery = () => ({ ...filters });
  async function bulk(action, all) {
    const ids = table.selected();
    const count = all ? table.visibleRows().length : ids.length;
    if (!count) return toast('Nenhum lead', 'err');
    if (action === 'delete') {
      const reason = await promptDialog(`Excluir ${count} lead(s)`, 'Motivo da exclusão');
      if (!reason) return;
      await api.post('/leads/bulk', { action, ids, all, filter: apiQuery(), reason });
    } else {
      const fields = [
        { name: 'origem_id', label: 'Origem', type: 'select', numeric: true, options: listOpts('origem'), emptyLabel: '(manter)', col: 6 },
        { name: 'status_id', label: 'Status', type: 'select', numeric: true, options: listOpts('status'), emptyLabel: '(manter)', col: 6 },
        { name: 'temperatura', label: 'Temperatura', type: 'select', options: opts(TEMPERATURAS), emptyLabel: '(manter)', col: 6 },
        { name: 'campanha_id', label: 'Campanha', type: 'select', numeric: true, options: campOpts(), emptyLabel: '(manter)', col: 6 },
        { name: 'proximo_contato', label: 'Próximo contato', type: 'datetime-local', col: 6 },
        { name: 'add_tags', label: 'Adicionar etiquetas', type: 'multi', options: listOpts('etiqueta'), col: 6 },
      ];
      await new Promise((resolve) => formModal({ title: `Editar ${count} lead(s)`, fields, onSubmit: async (v) => {
        if (v.proximo_contato) v.proximo_contato = v.proximo_contato.replace('T', ' ') + ':00';
        await api.post('/leads/bulk', { action, ids, all, filter: apiQuery(), data: v });
        resolve();
      } }));
    }
    toast('Operação concluída');
    table.clearSelection();
    load();
  }
  view.querySelector('#tbl').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bulk]');
    if (b) { const [a, all] = b.dataset.bulk.split('-'); bulk(a, !!all).catch(errToast); return; }
    const d = e.target.closest('[data-del]');
    if (d) {
      const reason = await promptDialog('Excluir lead', 'Motivo da exclusão');
      if (!reason) return;
      api.del(`/leads/${d.dataset.del}`, { reason }).then(() => { toast('Lead excluído'); load(); }).catch(errToast);
    }
  });

  const doQuick = () => { filters.q = view.querySelector('#qs').value.trim(); saveFilters(filters); load(); };
  view.querySelector('#qsGo').onclick = doQuick;
  view.querySelector('#qs').onkeydown = (e) => { if (e.key === 'Enter') doQuick(); };
  view.querySelector('#toggleF').onclick = () => { fbox.hidden = !fbox.hidden; };
  view.querySelector('#clearF').onclick = () => { filters = {}; saveFilters(filters); view.querySelector('#qs').value = ''; mountFilters(); load(); };
  view.querySelector('[data-new]').onclick = () => openCreateLead(() => load());
  const dd = view.querySelector('#moreDd');
  dd.querySelector('button').onclick = (e) => { e.stopPropagation(); dd.classList.toggle('open'); };
  view.querySelector('[data-import]').onclick = (e) => { e.preventDefault(); importDialog('/leads/import', ['nome', 'telefone', 'origem', 'status', 'temperatura', 'anotacoes', 'inclusao'], load); };
  if (parseQuery().novo) openCreateLead(() => load());
}

export function importDialog(url, columns, onDone) {
  modal({
    title: 'Importar planilha',
    body: `<p>Envie um arquivo <b>.csv</b> (separado por ; ou ,) com a primeira linha de cabeçalho. Colunas reconhecidas:</p>
      <p><code>${columns.join('; ')}</code></p><p class="muted">No Excel/Google Planilhas: Arquivo › Salvar como / Fazer download › CSV. Origens e status desconhecidos são criados automaticamente.</p>
      <button class="btn" data-model>Baixar modelo</button>`,
    buttons: [{ label: 'Cancelar' }, { label: 'Escolher arquivo', cls: 'btn-primary', onClick: async () => {
      const f = await pickFile('.csv,text/csv');
      if (!f) return false;
      const rows = parseCSV(await f.text());
      if (!rows.length) throw new Error('Arquivo vazio ou sem cabeçalho');
      const r = await api.post(url, { rows });
      modal({ title: 'Importação concluída', body: `<p>${r.ok} registro(s) importado(s).</p>${r.errors.length ? `<p>Erros:</p><ul>${r.errors.slice(0, 50).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` });
      onDone && onDone();
    } }],
  }).body.querySelector('[data-model]').onclick = () => {
    const blob = new Blob(['﻿' + columns.join(';') + '\r\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'modelo-importacao.csv'; a.click();
  };
}

export async function proximos(view) {
  view.innerHTML = `${pageHeader('Próximos Contatos', 'Fila de leads com retorno marcado, mais antigos primeiro. Atrasados em vermelho.', backBtn('#/leads'))}
    <div class="quick-search card"><div class="card-body row"><input id="qs" placeholder="Buscar por telefone, nome ou ID"><button class="btn btn-primary" id="go">Buscar</button></div></div><div id="tbl"></div>`;
  const now = `${todayISO()} ${nowTime()}`;
  const cols = leadColumns();
  const order = ['proximo_contato', 'name', 'created_at', 'phone', 'origem_id', 'temperatura', 'status_id', 'ag_data', 'ag_hora', 'anotacoes', 'campanha_id', 'ligacoes', 'tags'];
  const table = dataTable(view.querySelector('#tbl'), {
    id: 'proximos', columns: order.map((k) => cols.find((c) => c.key === k)), exportName: 'proximos-contatos', actions: editBtns,
    rowClass: (r) => (String(r.proximo_contato).slice(0, 16) < now ? 'late' : ''), onRowClick: (r) => { location.hash = `#/leads/editar/${r.id}`; },
  });
  const load = async () => table.setRows(await api.get('/leads/proximos', { q: view.querySelector('#qs').value.trim() }));
  view.querySelector('#go').onclick = () => load().catch(errToast);
  view.querySelector('#qs').onkeydown = (e) => { if (e.key === 'Enter') load().catch(errToast); };
  view.querySelector('#tbl').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (!d) return;
    const reason = await promptDialog('Excluir lead', 'Motivo da exclusão');
    if (reason) api.del(`/leads/${d.dataset.del}`, { reason }).then(load).catch(errToast);
  });
  await load();
}

export async function recuperar(view) {
  view.innerHTML = `${pageHeader('Recuperar leads excluídos', '', backBtn('#/leads'))}<div id="tbl"></div>`;
  const table = dataTable(view.querySelector('#tbl'), {
    id: 'deleted', selectable: true, exportName: 'leads-excluidos',
    columns: [
      { key: 'name', label: 'Nome' }, { key: 'phone', label: 'Telefone', render: (r) => esc(fmtPhone(r.phone, r.ddi)) },
      { key: 'delete_reason', label: 'Motivo da Exclusão' }, { key: 'deleted_at', label: 'Data de exclusão', render: (r) => fmtDateTime(r.deleted_at) },
    ],
    bulk: (n) => `<span>${n} selecionado(s)</span><button class="btn btn-sm btn-primary" data-rec ${n ? '' : 'disabled'}>Recuperar selecionado(s)</button>`,
  });
  const load = async () => table.setRows(await api.get('/leads/deleted'));
  view.querySelector('#tbl').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-rec]')) return;
    await api.post('/leads/restore', { ids: table.selected() });
    toast('Leads recuperados'); table.clearSelection(); load();
  });
  await load();
}

// ---------------------------------------------------------------- ficha do lead
export async function ficha(view, { id }) {
  let data = await api.get(`/leads/${id}`);
  let chipFilter = 0;
  let tab = 'whatsapp';

  const render = () => {
    const l = data.lead;
    const msgs = data.messages.filter((m) => !chipFilter || m.chip === chipFilter);
    const ativos = data.cadences.filter((c) => ['Em execução', 'Agendada'].includes(c.status));
    view.innerHTML = `${pageHeader(l.name, `ID do Lead: ${l.id}${l.client_id ? ` · <a href="#/clientes/editar/${l.client_id}">Cliente #${l.client_id}</a>` : ''}`, `
      <div class="dropdown" id="optDd"><button class="btn">Opções ▾</button><div class="dropdown-menu right">
        <a href="#" data-a="clear">Limpar histórico de conversa</a><a href="#" data-a="resend">Reenviar última mensagem</a><a href="#" data-a="cad">Ajustes de cadência</a></div></div>
      ${backBtn('#/leads')}`)}
    <div class="ficha">
      <div class="ficha-main">
        ${card('Conversa', `
          <div class="tabs"><button class="${tab === 'whatsapp' ? 'on' : ''}" data-tab="whatsapp">WhatsApp</button><button class="${tab === 'ligacao' ? 'on' : ''}" data-tab="ligacao">Ligação</button></div>
          ${tab === 'whatsapp' ? `
          <div class="chip-filter">${[0, 1, 2, 3].map((c) => `<button class="pill ${chipFilter === c ? 'on' : ''}" data-chip="${c}">${c ? `Chip ${c}` : 'Todos'}</button>`).join('')}
            <span class="muted">${l.ia_pausada_por ? `IA pausada por ${esc(userName(l.ia_pausada_por))}` : 'IA ativa'}</span>
            <button class="btn btn-sm" data-a="ia">${l.ia_pausada_por ? 'Retomar IA' : 'Pausar IA'}</button></div>
          <div class="chat" id="chat">${msgs.length ? msgs.map((m) => `<div class="msg ${m.direction}"><div>${esc(m.content)}</div><small>Chip ${m.chip} · ${fmtDateTime(m.created_at)}${m.kind === 'template' ? ' · modelo' : ''}${m.user_id ? ' · ' + esc(userName(m.user_id)) : ''}</small></div>`).join('') : '<p class="muted center">Sem mensagens</p>'}</div>
          <div class="chat-input">
            <select id="chipSel">${state.chips.map((c) => `<option value="${c.id}">${esc(c.nome)}${c.status === 'Conectado' ? '' : ' (desconectado)'}</option>`).join('')}</select>
            <input id="msgIn" placeholder="Digite uma mensagem"><button class="btn btn-primary" data-a="send">Enviar</button>
            <button class="btn" data-a="tpl" title="Enviar modelo de mensagem">Modelo</button>
            <button class="btn" data-a="in" title="Registrar mensagem recebida">Recebida</button>
          </div>
          <p class="muted small">As mensagens ficam registradas no histórico. O envio real pelo WhatsApp depende de uma integração com a API do WhatsApp (veja Gerenciar › Configuração WhatsApp).</p>`
          : `<div class="call-box"><a class="btn btn-primary" href="tel:${esc((l.ddi || '') + l.phone)}">📞 Ligar para ${esc(fmtPhone(l.phone, l.ddi))}</a>
            <button class="btn" data-a="callreg">Registrar ligação</button></div>
            <table class="table"><tr><th>Data</th><th>Observação</th><th>Usuário</th></tr>${data.contacts.filter((c) => c.tipo === 'Chamada Telefônica').map((c) =>
            `<tr><td>${fmtDateTime(c.date)}</td><td>${esc(c.obs)}</td><td>${esc(userName(c.user_id))}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhuma ligação</td></tr>'}</table>`}
        `)}
        ${card('Agendamentos', `<table class="table"><tr><th>Status</th><th>Data</th><th>Horário</th><th>Profissional</th><th>Descrição</th><th>Criado</th><th>Modificado</th><th></th></tr>
          ${data.appointments.map((a) => `<tr><td><span class="pill st-${esc(a.status)}">${esc(a.status)}</span></td><td>${fmtDate(a.date)}</td><td>${esc(a.start)}–${esc(a.end)}</td>
            <td>${esc(ln(a.profissional_id))}</td><td>${esc(a.descricao)}</td><td>${esc(userName(a.created_by))}<br><small>${fmtDateTime(a.created_at)}</small></td>
            <td>${a.updated_by ? `${esc(userName(a.updated_by))}<br><small>${fmtDateTime(a.updated_at)}</small>` : ''}</td>
            <td class="nowrap"><button class="icon-btn" data-ag="${a.id}" title="Editar">✎</button><button class="icon-btn danger" data-agdel="${a.id}" title="Excluir">✕</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhum agendamento</td></tr>'}</table>`,
          '<button class="btn btn-sm btn-primary" data-a="newag">+ Novo</button>')}
        ${card('Contatos', `<table class="table"><tr><th>Data</th><th>Tipo</th><th>Observação</th><th>Usuário</th><th></th></tr>
          ${data.contacts.map((c) => `<tr><td>${fmtDateTime(c.date)}</td><td>${esc(c.tipo)}${c.call_center ? ' <span class="pill">Call Center</span>' : ''}</td><td>${esc(c.obs)}</td><td>${esc(userName(c.user_id))}</td>
            <td><button class="icon-btn danger" data-cdel="${c.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum contato</td></tr>'}</table>`,
          '<button class="btn btn-sm btn-primary" data-a="newc">+ Novo Contato</button>')}
        ${card('Cadências', `
          <div class="row wrap">
            <button class="btn" data-limbo="1">Colocar em Limbo 1</button><button class="btn" data-limbo="2">Colocar em Limbo 2</button>
            <button class="btn btn-danger-o" data-a="reset">Resetar cadências</button>
            <span class="muted">${ativos.length ? `${ativos.length} cadência(s) ativa(s)` : 'Nenhuma cadência ativa'}</span></div>
          <table class="table"><tr><th>Cadência</th><th>Início</th><th>Término</th><th>Usuário</th><th>Status</th><th>Observação</th></tr>
          ${data.cadences.map((c) => `<tr><td>Limbo ${c.limbo}</td><td>${fmtDateTime(c.inicio)}</td><td>${fmtDateTime(c.termino)}</td><td>${esc(userName(c.user_id))}</td><td>${esc(c.status)}</td><td>${esc(c.obs)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma cadência</td></tr>'}</table>`)}
      </div>
      <aside class="ficha-side">
        ${card('Dados do lead', `<dl class="dl">
          <dt>Data de Cadastro</dt><dd>${fmtDateTime(l.created_at)}</dd>
          <dt>Origem</dt><dd>${esc(ln(l.origem_id)) || '—'}</dd>
          <dt>Status do lead</dt><dd>${esc(ln(l.status_id)) || '—'}</dd>
          <dt>Telefone</dt><dd>${l.phone ? `<a href="https://wa.me/${esc(String(l.ddi || '').replace('+', '') + l.phone)}" target="_blank" rel="noopener">${esc(fmtPhone(l.phone, l.ddi))}</a>` : '—'}</dd>
          <dt>Telefone de entrada</dt><dd>${esc(fmtPhone(l.phone_entrada)) || '—'}</dd>
          <dt>Agendamento</dt><dd>${l.ag_data ? `${fmtDate(l.ag_data)} ${esc(l.ag_hora)} (${esc(l.ag_status)})` : '—'}</dd>
          <dt>Último Contato</dt><dd>${fmtDateTime(l.ultimo_contato) || '—'}</dd>
          <dt>Próximo Contato</dt><dd>${fmtDateTime(l.proximo_contato) || '—'}</dd>
          <dt>Temperatura</dt><dd>${tempHTML(l.temperatura) || '—'}</dd>
          <dt>Campanha</dt><dd>${esc(campName(l.campanha_id)) || '—'}</dd>
          <dt>Indicação</dt><dd>${esc(l.indicacao) || '—'}</dd>
          <dt>Reaquecimentos</dt><dd>${data.reheats.length}</dd></dl>
          <div class="row"><button class="btn btn-primary" data-a="edit">Editar</button><button class="btn btn-danger-o" data-a="del">Excluir</button></div>`)}
        ${card('Etiquetas e Anotações', `<div class="tags-box">${tagsHTML(l.tags) || '<span class="muted">Sem etiquetas</span>'}</div>
          <div class="row"><button class="btn btn-sm" data-a="tags">Gerenciar Etiquetas</button><button class="btn btn-sm" data-a="newtag">Criar Nova Etiqueta</button></div>
          <label class="field"><span>Anotações</span><textarea id="notes" rows="5">${esc(l.anotacoes)}</textarea></label>
          <button class="btn btn-sm btn-primary" data-a="savenotes">Salvar anotações</button>`)}
      </aside>
    </div>`;
    const chat = view.querySelector('#chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    wire();
  };

  const refresh = (d) => { data = d; render(); };
  const save = async (body) => refresh(await api.put(`/leads/${id}`, body));

  function apptForm(a = {}) {
    const fields = [
      { name: 'date', label: 'Agendamento', type: 'date', required: true, col: 6 },
      { name: 'profissional_id', label: 'Profissional', type: 'select', numeric: true, options: listOpts('profissional'), col: 6 },
      { name: 'start', label: 'Horário inicial', type: 'time', required: true, col: 6 },
      { name: 'end', label: 'Horário final', type: 'time', col: 6, help: 'Em branco: usa a duração padrão' },
      { name: 'status', label: 'Status do agendamento', type: 'select', options: AG_STATUS(), noEmpty: true, col: 6 },
      { name: 'envio', label: 'Forma de envio do disparo', type: 'select', options: opts(['Não enviar', 'WhatsApp - Chip de Agendamento', 'WhatsApp - Chip Comercial']), noEmpty: true, col: 6 },
      { name: 'descricao', label: 'Descrição', type: 'textarea', col: 12 },
    ];
    formModal({ title: a.id ? 'Editar agendamento' : 'Criar novo agendamento', fields, values: { status: 'Agendado', date: todayISO(), ...a }, onSubmit: async (v) => {
      if (a.id) await api.put(`/appointments/${a.id}`, v); else await api.post('/appointments', { ...v, lead_id: +id });
      toast('Agendamento salvo');
      refresh(await api.get(`/leads/${id}`));
    } });
  }
  function contactForm(tipo) {
    const fields = [
      { name: 'date', label: 'Data', type: 'datetime-local', col: 6, required: true },
      { name: 'tipo', label: 'Tipo de Contato', type: 'select', options: opts(TIPOS_CONTATO), noEmpty: true, col: 6 },
      { name: 'call_center', label: 'Contato Call Center', type: 'checkbox', col: 12 },
      { name: 'obs', label: 'Observações', type: 'textarea', col: 12 },
    ];
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    formModal({ title: 'Novo Contato', fields, values: { date: d.toISOString().slice(0, 16), tipo: tipo || TIPOS_CONTATO[0] }, onSubmit: async (v) => {
      await api.post('/contacts', { ...v, date: v.date.replace('T', ' ') + ':00', lead_id: +id });
      toast('Contato registrado');
      refresh(await api.get(`/leads/${id}`));
    } });
  }

  function wire() {
    const dd = view.querySelector('#optDd');
    dd.querySelector('button').onclick = (e) => { e.stopPropagation(); dd.classList.toggle('open'); };
    bind(view, {
      '[data-tab]': (e, el) => { tab = el.dataset.tab; render(); },
      '[data-chip]': (e, el) => { chipFilter = +el.dataset.chip; render(); },
      '[data-limbo]': async (e, el) => {
        const v = await new Promise((resolve) => formModal({ title: `Agendar Limbo ${el.dataset.limbo}`, fields: [
          { name: 'inicio', label: 'Início do disparo', type: 'datetime-local', required: true }, { name: 'obs', label: 'Observação', type: 'textarea' }],
        onSubmit: (x) => resolve(x) }));
        refresh(await api.post(`/leads/${id}/cadences`, { limbo: +el.dataset.limbo, inicio: v.inicio.replace('T', ' ') + ':00', obs: v.obs }));
        toast(`Lead colocado em Limbo ${el.dataset.limbo}`);
      },
      '[data-ag]': (e, el) => apptForm(data.appointments.find((a) => a.id === +el.dataset.ag)),
      '[data-agdel]': async (e, el) => { if (await confirmDialog('Excluir este agendamento?', { danger: true, ok: 'Excluir' })) { await api.del(`/appointments/${el.dataset.agdel}`); refresh(await api.get(`/leads/${id}`)); } },
      '[data-cdel]': async (e, el) => { if (await confirmDialog('Excluir este contato?', { danger: true, ok: 'Excluir' })) { await api.del(`/contacts/${el.dataset.cdel}`); refresh(await api.get(`/leads/${id}`)); } },
      '[data-a]': (e, el) => actions[el.dataset.a] && actions[el.dataset.a]().catch(errToast),
    });
    const inp = view.querySelector('#msgIn');
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') actions.send().catch(errToast); };
  }

  const actions = {
    async send() {
      const content = view.querySelector('#msgIn').value.trim();
      if (!content) return;
      refresh(await api.post(`/leads/${id}/messages`, { content, chip: +view.querySelector('#chipSel').value }));
    },
    async in() {
      const content = await promptDialog('Registrar mensagem recebida', 'Conteúdo', { textarea: true });
      if (content) refresh(await api.post(`/leads/${id}/messages`, { content, direction: 'in', chip: +view.querySelector('#chipSel').value }));
    },
    async tpl() {
      formModal({ title: 'Disparar modelo de mensagem', fields: [
        { name: 'template_id', label: 'Modelo', type: 'select', numeric: true, required: true, options: state.templates.map((t) => ({ value: t.id, label: `${t.nome} (${t.categoria || ''})` })) },
        { name: 'chip', label: 'Chip', type: 'select', numeric: true, noEmpty: true, options: state.chips.map((c) => ({ value: c.id, label: c.nome })) }],
      onSubmit: async (v) => { refresh(await api.post(`/leads/${id}/messages`, v)); toast('Modelo enviado'); } });
    },
    async clear() { if (await confirmDialog('Apagar todo o histórico de conversa deste lead?', { danger: true, ok: 'Limpar' })) refresh(await api.del(`/leads/${id}/messages`)); },
    async resend() {
      const last = [...data.messages].reverse().find((m) => m.direction === 'out');
      if (!last) return toast('Nenhuma mensagem enviada', 'err');
      refresh(await api.post(`/leads/${id}/messages`, { content: last.content, chip: last.chip }));
      toast('Mensagem reenviada');
    },
    async cad() { view.querySelector('[data-limbo]').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    async ia() { refresh(await api.post(`/leads/${id}/ia`, { pause: !data.lead.ia_pausada_por })); },
    async callreg() { contactForm('Chamada Telefônica'); },
    async newag() { apptForm(); },
    async newc() { contactForm(); },
    async reset() { if (await confirmDialog('Resetar (cancelar) todas as cadências ativas?', { ok: 'Sim' })) refresh(await api.post(`/leads/${id}/cadences/reset`)); },
    async edit() {
      const l = data.lead;
      const px = splitDT(l.proximo_contato);
      formModal({ title: 'Editar Lead', fields: [
        { name: 'name', label: 'Nome', required: true }, { name: 'phone', label: 'Telefone', type: 'phone', ddi: l.ddi },
        { name: 'temperatura', label: 'Temperatura', type: 'select', options: opts(TEMPERATURAS), col: 6 },
        { name: 'origem_id', label: 'Origem', type: 'select', numeric: true, options: listOpts('origem'), col: 6 },
        { name: 'status_id', label: 'Status do lead', type: 'select', numeric: true, options: listOpts('status'), col: 6 },
        { name: 'campanha_id', label: 'Campanha', type: 'select', numeric: true, options: campOpts(), col: 6 },
        { name: 'px_data', label: 'Próximo Contato', type: 'date', col: 6 }, { name: 'px_hora', label: 'Hora', type: 'time', col: 6 },
      ], values: { ...l, px_data: px.date, px_hora: px.time }, onSubmit: async (v) => {
        const { px_data, px_hora, ...rest } = v;
        await save({ ...rest, proximo_contato: px_data ? joinDT(px_data, px_hora) : null });
        toast('Lead atualizado');
      } });
    },
    async del() {
      const reason = await promptDialog('Excluir lead', 'Motivo da exclusão');
      if (!reason) return;
      await api.del(`/leads/${id}`, { reason });
      toast('Lead excluído'); location.hash = '#/leads';
    },
    async tags() {
      formModal({ title: 'Gerenciar Etiquetas', fields: [{ name: 'tags', label: 'Etiquetas', type: 'multi', options: listOpts('etiqueta') }],
        values: { tags: data.lead.tags }, onSubmit: async (v) => { await save({ tags: v.tags }); } });
    },
    async newtag() {
      const name = await promptDialog('Criar Nova Etiqueta', 'Nome da etiqueta');
      if (!name) return;
      const it = await api.post('/lists', { type: 'etiqueta', name });
      state.lists.push(it);
      await save({ tags: [...data.lead.tags, it.id] });
      toast('Etiqueta criada');
    },
    async savenotes() { await save({ anotacoes: view.querySelector('#notes').value }); toast('Anotações salvas'); },
  };

  render();
}
export { formHTML, readForm, initMulti };
