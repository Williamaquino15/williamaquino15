// Campanhas de disparo de WhatsApp.
import { state, api, esc, toast, errToast, modal, dataTable, pageHeader, backBtn, card, formHTML, readForm, initMulti, listOpts, fmtDateTime, fmtPhone, ln, todayISO, confirmDialog, opts, loadBoot } from '../core.js';

export async function list(view) {
  view.innerHTML = `${pageHeader('Campanhas', 'Disparos agendados de WhatsApp', `<a class="btn" href="#/gerenciar/modelos">Modelos de mensagem</a><a class="btn btn-primary" href="#/disparo/campanhas/criar">+ Criar campanha</a>`)}<div id="tbl"></div>`;
  const table = dataTable(view.querySelector('#tbl'), {
    id: 'campanhas', exportName: 'campanhas',
    columns: [
      { key: 'nome', label: 'Nome da campanha', render: (r) => `<span class="dot" style="background:${esc(r.cor || '#0f766e')}"></span> ${esc(r.nome)}` },
      { key: 'descricao', label: 'Descrição', render: (r) => `<span class="clip">${esc(r.descricao)}</span>` },
      { key: 'status', label: 'Status', render: (r) => `<span class="pill st-${esc(r.status)}">${esc(r.status)}</span>` },
      { key: 'chip_tipo', label: 'Chip' }, { key: 'template_nome', label: 'Modelo de mensagem' }, { key: 'meta_id', label: 'ID template Meta' },
      { key: 'categoria', label: 'Categoria' }, { key: 'idioma', label: 'Idioma' }, { key: 'total', label: 'Leads total' },
      { key: 'pendentes', label: 'Total pendentes' }, { key: 'concluidos', label: 'Total concluídos' }, { key: 'falhas', label: 'Total com falha' },
      { key: 'disparo', label: 'Disparo', render: (r) => `${esc(r.data || '')} ${esc(r.hora || '')}`, sort: (r) => `${r.data} ${r.hora}` },
      { key: 'created_at', label: 'Criado em', render: (r) => fmtDateTime(r.created_at) }, { key: 'criado_por', label: 'Criado por' },
    ],
    actions: (r) => `${r.status === 'Agendada' ? `<button class="btn btn-sm" data-run="${r.id}">Disparar agora</button><button class="btn btn-sm" data-cancel="${r.id}">Cancelar</button>` : ''}<button class="icon-btn danger" data-del="${r.id}" title="Excluir">✕</button>`,
  });
  const load = async () => table.setRows(await api.get('/campaigns'));
  view.querySelector('#tbl').addEventListener('click', async (e) => {
    const run = e.target.closest('[data-run]');
    const can = e.target.closest('[data-cancel]');
    const del = e.target.closest('[data-del]');
    try {
      if (run && await confirmDialog('Disparar esta campanha agora?')) { const r = await api.post(`/campaigns/${run.dataset.run}/run`); toast(`${r.sent} mensagem(ns) processada(s)`); }
      if (can && await confirmDialog('Cancelar esta campanha?')) await api.post(`/campaigns/${can.dataset.cancel}/cancel`);
      if (del && await confirmDialog('Excluir esta campanha?', { danger: true, ok: 'Excluir' })) await api.del(`/campaigns/${del.dataset.del}`);
      if (run || can || del) load();
    } catch (err) { errToast(err); }
  });
  await load();
}

export async function criar(view) {
  const tplOpts = state.templates.map((t) => ({ value: t.id, label: t.nome }));
  const base = [
    { name: 'nome', label: 'Nome', required: true, maxlength: 200, col: 8 }, { name: 'cor', label: 'Cor', type: 'color', col: 4 },
    { name: 'descricao', label: 'Descrição', type: 'textarea', maxlength: 4000 },
    { name: 'data', label: 'Data do disparo', type: 'date', required: true, col: 4 }, { name: 'hora', label: 'Horário do disparo', type: 'time', required: true, col: 4 },
    { name: 'chip_tipo', label: 'Tipo de chip', type: 'select', noEmpty: true, options: opts(['Agendamento', 'Comercial']), col: 4 },
    { name: 'template_id', label: 'Modelo de mensagem', type: 'select', numeric: true, required: true, options: tplOpts },
  ];
  const filtro = [
    { name: 'inc_de', label: 'Inclusão (mín.)', type: 'date', col: 3 }, { name: 'inc_ate', label: 'Inclusão (máx.)', type: 'date', col: 3 },
    { name: 'tent_min', label: 'Tentativas (mín.)', type: 'number', min: 0, col: 3 }, { name: 'tent_max', label: 'Tentativas (máx.)', type: 'number', min: 0, col: 3 },
    { name: 'uc_de', label: 'Último Contato (mín.)', type: 'date', col: 3 }, { name: 'uc_ate', label: 'Último Contato (máx.)', type: 'date', col: 3 },
    { name: 'ag_de', label: 'Agendamento (mín.)', type: 'date', col: 3 }, { name: 'ag_ate', label: 'Agendamento (máx.)', type: 'date', col: 3 },
    { name: 'sem_ultimo_contato', label: 'Incluir sem Último Contato', type: 'radio', options: opts(['Sim', 'Não']), col: 4 },
    { name: 'anotacoes', label: 'Anotações (contém)', col: 8 },
    { name: 'origem', label: 'Origem', type: 'multi', options: listOpts('origem'), col: 4 },
    { name: 'status', label: 'Status do Lead', type: 'multi', options: listOpts('status'), col: 4 },
    { name: 'ag_status', label: 'Status do Agendamento', type: 'multi', options: listOpts('status_agendamento').map((o) => ({ value: o.label, label: o.label })), col: 4 },
  ];
  view.innerHTML = `${pageHeader('Criar campanha', '', backBtn('#/disparo/campanhas'))}
    <div class="grid-2">
      ${card('Campanha', `<div id="fBase">${formHTML(base, { data: todayISO(), hora: '09:00', cor: '#0f766e', chip_tipo: 'Comercial' })}</div><div id="preview" class="tpl-preview"></div>`)}
      ${card('Filtro de Base de Dados', `<div id="fFiltro">${formHTML(filtro, { sem_ultimo_contato: 'Sim' })}</div>`)}
    </div>
    <div class="row end"><button class="btn" id="ver">Visualizar público</button><button class="btn btn-primary" id="criar">Criar campanha</button></div>
    <div id="publico"></div>`;
  initMulti(view);
  const prev = () => {
    const t = state.templates.find((x) => x.id === +view.querySelector('[name=template_id]').value);
    view.querySelector('#preview').innerHTML = t ? `<small class="muted">Prévia da mensagem</small><div class="msg out">${esc(t.conteudo)}</div>` : '';
  };
  view.querySelector('[name=template_id]').onchange = prev;
  const getFiltro = () => readForm(view.querySelector('#fFiltro'), filtro);
  view.querySelector('#ver').onclick = async () => {
    try {
      const rows = await api.post('/campaigns/preview', { filtro: getFiltro() });
      const box = view.querySelector('#publico');
      box.innerHTML = '<div id="pt"></div>';
      dataTable(box.querySelector('#pt'), { id: 'publico', exportName: 'publico-campanha', rows, columns: [
        { key: 'id', label: 'ID' }, { key: 'name', label: 'Nome' }, { key: 'phone', label: 'Telefone', render: (r) => esc(fmtPhone(r.phone, r.ddi)) },
        { key: 'origem_id', label: 'Origem', render: (r) => esc(ln(r.origem_id)) }, { key: 'status_id', label: 'Status', render: (r) => esc(ln(r.status_id)) },
        { key: 'created_at', label: 'Inclusão', render: (r) => fmtDateTime(r.created_at) }] });
      toast(`${rows.length} lead(s) no público`);
    } catch (e) { errToast(e); }
  };
  view.querySelector('#criar').onclick = async () => {
    try {
      const v = readForm(view.querySelector('#fBase'), base);
      const r = await api.post('/campaigns', { ...v, filtro: getFiltro() });
      toast(`Campanha criada com ${r.total} lead(s)`);
      await loadBoot();
      location.hash = '#/disparo/campanhas';
    } catch (e) { errToast(e); }
  };
}
export { modal };
