// Gerenciar: perfil, pagamento, usuários/permissões, configurações, IA, listas, grupos, WhatsApp, modelos e clínicas.
import {
  state, api, esc, toast, errToast, modal, formModal, formHTML, readForm, initMulti, dataTable, pageHeader, backBtn, card,
  confirmDialog, fmtDateTime, fmtMoney, fmtPhone, fmtDate, opts, loadBoot, bind,
} from '../core.js';

const back = backBtn('#/gerenciar');

export async function home(view) {
  const a = state.user.p_admin;
  const cards = [
    ['Perfil', 'Seu nome, e-mail e senha', '#/perfil', true],
    ['Pagamento', 'Plano e histórico de compras', '#/gerenciar/pagamento', a],
    ['Usuários', 'Usuários e permissões de acesso', '#/usuarios', a],
    ['Configurações', 'Dados da clínica, regras de leads e integrações', '#/gerenciar/configuracoes', a],
    ['Configuração IA de Agendamento', 'Parâmetros da secretária virtual', '#/gerenciar/configuracao-ia', a],
    ['Gerenciar listas', 'Origens, status, tratamentos, fases, avaliadores e mais', '#/gerenciar/listas', a],
    ['Grupos de origem', 'Agrupe origens para os relatórios', '#/gerenciar/grupos-de-origem', a],
    ['Configuração WhatsApp', 'Chips conectados (até três)', '#/gerenciar/whatsapp', a],
    ['Modelos de mensagem', 'Templates usados nos disparos', '#/gerenciar/modelos', a],
    ['Campanhas', 'Disparos agendados de WhatsApp', '#/disparo/campanhas', true],
  ].filter((c) => c[3]);
  view.innerHTML = `${pageHeader('Gerenciar', 'Configurações, integrações e cadastros auxiliares')}
    <div class="tiles">${cards.map(([t, d, h]) => `<a class="tile" href="${h}"><h3>${esc(t)}</h3><p class="muted">${esc(d)}</p><span class="btn btn-sm">Acessar</span></a>`).join('')}</div>`;
}

export async function perfil(view) {
  const u = state.user;
  const fi = [{ name: 'name', label: 'Nome', required: true }, { name: 'email', label: 'E-mail', type: 'email', required: true }];
  const fs = [{ name: 'senha_atual', label: 'Senha atual', type: 'password', required: true }, { name: 'senha_nova', label: 'Nova senha', type: 'password', required: true },
    { name: 'confirm', label: 'Confirmação', type: 'password', required: true }];
  view.innerHTML = `${pageHeader('Perfil', '', back)}<div class="grid-2">
    ${card('Informações', `<div id="fi">${formHTML(fi, u)}</div><button class="btn btn-primary" id="si">Salvar</button>`)}
    ${card('Senha', `<div id="fs">${formHTML(fs)}</div><button class="btn btn-primary" id="ss">Salvar</button>`)}</div>`;
  view.querySelector('#si').onclick = async () => {
    try { const v = readForm(view.querySelector('#fi'), fi); await api.put('/me', v); await loadBoot(); toast('Perfil atualizado'); } catch (e) { errToast(e); }
  };
  view.querySelector('#ss').onclick = async () => {
    try {
      const v = readForm(view.querySelector('#fs'), fs);
      if (v.senha_nova !== v.confirm) throw new Error('A confirmação não confere');
      await api.put('/me', v); toast('Senha alterada');
      view.querySelectorAll('#fs input').forEach((i) => { i.value = ''; });
    } catch (e) { errToast(e); }
  };
}

export async function pagamento(view) {
  view.innerHTML = `${pageHeader('Pagamento', 'Histórico de compras', `<button class="btn btn-primary" id="novo">Novo plano</button>${back}`)}<div id="tbl"></div>`;
  const table = dataTable(view.querySelector('#tbl'), { id: 'pagamentos', exportName: 'pagamentos', columns: [
    { key: 'codigo', label: 'Código da compra' }, { key: 'plano', label: 'Plano' }, { key: 'created_at', label: 'Data de Solicitação', render: (r) => fmtDateTime(r.created_at) },
    { key: 'status', label: 'Status', render: (r) => `<span class="pill">${esc(r.status)}</span>` }, { key: 'valor', label: 'Valor total', render: (r) => fmtMoney(r.valor), cls: 'num' },
    { key: 'link', label: 'Links', render: (r) => (r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">Abrir</a>` : '—') }] });
  const load = async () => table.setRows(await api.get('/payments'));
  view.querySelector('#novo').onclick = () => formModal({ title: 'Novo plano', fields: [{ name: 'plano', label: 'Plano', type: 'radio', options: [
    { value: 'Básico', label: 'Básico — R$ 197/mês' }, { value: 'Profissional', label: 'Profissional — R$ 397/mês' }, { value: 'Premium', label: 'Premium — R$ 697/mês' }] },
  { type: 'html', html: '<p class="muted small">O pedido fica como "Pendente". A cobrança real exige integrar um meio de pagamento.</p>' }],
  values: { plano: 'Profissional' }, onSubmit: async (v) => { await api.post('/payments', v); toast('Pedido criado'); load(); } });
  await load();
}

// ---------------------------------------------------------------- usuários e permissões
const PERMS = [
  ['p_admin', 'Permissões de administrador'], ['p_leads', 'Acesso a página Leads'], ['p_clientes', 'Acesso a página Clientes'],
  ['p_dashboard', 'Acesso a página Dashboard'], ['p_financeiro', 'Acesso aos dados financeiros da Dashboard'], ['p_aulas', 'Acesso as aulas'],
];
export async function usuarios(view) {
  const me = state.user;
  view.innerHTML = `${pageHeader('Usuários e Permissões', '', back)}
    ${card('Seu usuário', `<p><b>${esc(me.name)}</b> · ${esc(me.email)}</p><div class="perm-list">${PERMS.map(([k, l]) => `<span class="pill ${me[k] ? 'ok' : ''}">${me[k] ? '✓' : '✕'} ${esc(l)}</span>`).join('')}</div>`,
    '<button class="btn btn-sm" id="editMe">Editar seu Usuário</button>')}
    ${card('Usuários da clínica', '<div id="tbl"></div>', '<button class="btn btn-sm btn-primary" id="add">+ Adicionar Usuário</button>')}
    ${card('Usuários Vinculados à Clínica', '<div id="tblL"></div>', '<button class="btn btn-sm" id="link">Vincular Usuário</button>')}`;
  const table = dataTable(view.querySelector('#tbl'), { id: 'usuarios', exportName: 'usuarios', columns: [
    { key: 'name', label: 'Nome' }, { key: 'email', label: 'Email' },
    { key: 'active', label: 'Status', render: (r) => `<span class="pill ${r.active ? 'ok' : ''}">${r.active ? 'Ativo' : 'Inativo'}</span>` },
    { key: 'p_admin', label: 'Admin', render: (r) => (r.p_admin ? 'Sim' : 'Não') }],
  actions: (r) => `<button class="btn btn-sm" data-edit="${r.id}">Editar</button><button class="btn btn-sm ${r.active ? 'btn-danger-o' : ''}" data-toggle="${r.id}">${r.active ? 'Desativar' : 'Reativar'}</button>` });
  const tl = dataTable(view.querySelector('#tblL'), { id: 'vinculados', exportName: 'usuarios-vinculados', columns: [
    { key: 'name', label: 'Nome' }, { key: 'email', label: 'Email' }, { key: 'access', label: 'Tipo Acesso' },
    { key: 'created_at', label: 'Data Vinculação', render: (r) => fmtDateTime(r.created_at) }, { key: 'status', label: 'Status' }],
  actions: (r) => `<button class="icon-btn danger" data-unlink="${r.id}" title="Remover vínculo">✕</button>` });
  let users = [];
  const load = async () => { users = await api.get('/users'); table.setRows(users); tl.setRows(await api.get('/linked-users')); };
  const userForm = (u) => formModal({
    title: u ? 'Editar usuário' : 'Adicionar Usuário',
    fields: [
      { name: 'name', label: 'Nome', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'password', label: u ? 'Nova senha (opcional)' : 'Senha', type: 'password', required: !u, col: 6 },
      ...(u ? [] : [{ name: 'confirm', label: 'Confirme sua senha', type: 'password', required: true, col: 6 }]),
      { type: 'section', label: 'Permissões' }, ...PERMS.map(([k, l]) => ({ name: k, label: l, type: 'switch' })),
    ],
    values: u || { p_leads: 1, p_clientes: 1, p_aulas: 1 },
    onSubmit: async (v) => {
      if (u) await api.put(`/users/${u.id}`, v); else await api.post('/users', v);
      toast('Usuário salvo'); await loadBoot(); load();
      if (u && u.id === state.user.id) usuarios(view);
    },
  });
  bind(view, {
    '#add': () => userForm(),
    '#editMe': () => userForm(users.find((u) => u.id === me.id) || me),
    '#link': () => formModal({ title: 'Vincular Usuário', fields: [{ name: 'email', label: 'E-mail do usuário', type: 'email', required: true },
      { name: 'viewer', label: 'Acesso como visualizador (somente leitura)', type: 'checkbox' }],
    onSubmit: async (v) => { await api.post('/linked-users', v); toast('Usuário vinculado'); load(); } }),
  });
  view.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); const tg = e.target.closest('[data-toggle]'); const ul = e.target.closest('[data-unlink]');
    try {
      if (ed) userForm(users.find((u) => u.id === +ed.dataset.edit));
      if (tg) {
        const u = users.find((x) => x.id === +tg.dataset.toggle);
        if (u.id === me.id) throw new Error('Você não pode desativar o próprio usuário');
        if (await confirmDialog(`${u.active ? 'Desativar' : 'Reativar'} ${u.name}?`)) { await api.put(`/users/${u.id}`, { active: u.active ? 0 : 1 }); await loadBoot(); load(); }
      }
      if (ul && await confirmDialog('Remover vínculo?')) { await api.del(`/linked-users/${ul.dataset.unlink}`); load(); }
    } catch (err) { errToast(err); }
  });
  await load();
}

// ---------------------------------------------------------------- configurações
export async function configuracoes(view) {
  const [clinica, leads, integ] = await Promise.all([api.get('/settings/clinica'), api.get('/settings/leads'), api.get('/settings/integracoes')]);
  const fc = [
    { name: 'nome', label: 'Nome', col: 6 }, { name: 'fantasia', label: 'Nome Fantasia', col: 6 }, { name: 'email', label: 'E-mail', type: 'email', col: 6 },
    { name: 'cnpj', label: 'CNPJ', col: 3 }, { name: 'telefone', label: 'Telefone', col: 3 }, { name: 'cep', label: 'CEP', col: 3 },
    { name: 'endereco', label: 'Endereço completo', col: 9 }, { name: 'cidade', label: 'Cidade', col: 6 }, { name: 'estado', label: 'Estado', col: 6 },
  ];
  const fl = [
    { name: 'telefone_obrigatorio', label: 'Telefone obrigatório', type: 'switch' }, { name: 'repetir_nome', label: 'Permitir repetir nome', type: 'switch' },
    { name: 'temperatura_manual', label: 'Temperatura manual', type: 'switch' },
    { name: 'duracao_agendamento', label: 'Duração padrão de agendamento', type: 'select', numeric: true, noEmpty: true, options: [15, 30, 45, 60].map((n) => ({ value: n, label: `${n} minutos` })) },
  ];
  const cl = integ.clinicorp || {}; const cd = integ.cloudia || {};
  const fi = [
    { type: 'section', label: 'Cloudia' }, { name: 'cd_link', label: 'Link', col: 8 }, { name: 'cd_sob', label: 'Sobrescrever anotações', type: 'switch', col: 4 },
    { type: 'section', label: 'Clinicorp' }, { name: 'cl_ativo', label: 'Ativar integração', type: 'switch' },
    { name: 'cl_usuario', label: 'Usuário', col: 4 }, { name: 'cl_token', label: 'Token', type: 'password', col: 4 }, { name: 'cl_clinica', label: 'Clínica', col: 4 },
    { name: 'cl_categorias', label: 'Categorias de avaliação', col: 6 },
    { name: 'cl_atualizar', label: 'Atualizar orçamentos', type: 'select', noEmpty: true, options: opts(['Total', 'Por período']), col: 6 },
    { name: 'cl_link', label: 'Link', col: 12 },
    { type: 'section', label: 'Outras' }, { name: 'icombot', label: 'ICOMBOT', type: 'switch', col: 6 }, { name: 'controle_odonto', label: 'Controle Odonto (beta)', type: 'switch', col: 6 },
  ];
  const iv = { cd_link: cd.link, cd_sob: cd.sobrescrever, cl_ativo: cl.ativo, cl_usuario: cl.usuario, cl_token: cl.token, cl_clinica: cl.clinica,
    cl_categorias: cl.categorias, cl_atualizar: cl.atualizar, cl_link: cl.link, icombot: integ.icombot?.ativo, controle_odonto: integ.controle_odonto?.ativo };
  view.innerHTML = `${pageHeader('Configurações', '', back)}
    ${card('Dados Pessoais', `<div id="fc">${formHTML(fc, clinica)}</div><button class="btn btn-primary" id="sc">Salvar</button>`)}
    ${card('Configurações de Leads', `<div id="fl">${formHTML(fl, leads)}</div><button class="btn btn-primary" id="sl">Salvar</button>`)}
    ${card('Integrações', `<p class="muted small">Os dados de acesso ficam salvos para uso das integrações. A sincronização automática com cada sistema externo precisa ser implementada com a API do fornecedor.</p>
      <div id="fi">${formHTML(fi, iv)}</div><button class="btn btn-primary" id="si">Salvar todos os dados de integração</button>`)}`;
  bind(view, {
    '#sc': async () => { try { await api.put('/settings/clinica', readForm(view.querySelector('#fc'), fc)); await loadBoot(); toast('Dados salvos'); } catch (e) { errToast(e); } },
    '#sl': async () => { try { await api.put('/settings/leads', Object.fromEntries(Object.entries(readForm(view.querySelector('#fl'), fl)).map(([k, v]) => [k, k === 'duracao_agendamento' ? v : !!v]))); await loadBoot(); toast('Configurações salvas'); } catch (e) { errToast(e); } },
    '#si': async () => {
      try {
        const v = readForm(view.querySelector('#fi'), fi);
        await api.put('/settings/integracoes', {
          cloudia: { link: v.cd_link, sobrescrever: !!v.cd_sob },
          clinicorp: { ativo: !!v.cl_ativo, usuario: v.cl_usuario, token: v.cl_token, clinica: v.cl_clinica, categorias: v.cl_categorias, atualizar: v.cl_atualizar, link: v.cl_link },
          icombot: { ativo: !!v.icombot }, controle_odonto: { ativo: !!v.controle_odonto },
        });
        toast('Integrações salvas');
      } catch (e) { errToast(e); }
    },
  });
}

export async function ia(view) {
  const cfg = await api.get('/settings/ia');
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const fields = [
    { type: 'section', label: 'Dados da clínica' },
    { name: 'nome', label: 'Nome', required: true, col: 6 }, { name: 'secretaria', label: 'Nome da secretária virtual', col: 6 },
    { name: 'cidade', label: 'Cidade', required: true, col: 4 }, { name: 'estado', label: 'Estado', required: true, col: 2 }, { name: 'cidades_atendidas', label: 'Cidades atendidas', col: 6 },
    { name: 'endereco', label: 'Endereço', col: 6 }, { name: 'telefone', label: 'Telefone', col: 3 }, { name: 'link_endereco', label: 'Link do endereço (mapa)', col: 3 },
    { name: 'estacionamento', label: 'Estacionamento', col: 6 }, { name: 'cro', label: 'CRO do responsável', col: 6 },
    { type: 'section', label: 'Mensagens' },
    { name: 'msg_pos', label: 'Mensagem pós-agendamento', type: 'textarea' }, { name: 'msg_lembrete', label: 'Mensagem de lembrete', type: 'textarea' }, { name: 'msg_falta', label: 'Mensagem de falta', type: 'textarea' },
    { type: 'section', label: 'Horários' },
    { name: 'hora_abre', label: 'Abre às', type: 'time', col: 3 }, { name: 'hora_fecha', label: 'Fecha às', type: 'time', col: 3 },
    { name: 'bloqueio_min', label: 'Bloqueio (minutos de antecedência)', type: 'number', min: 0, col: 3 }, { name: 'horarios_vez', label: 'Horários oferecidos por vez', type: 'number', min: 1, col: 3 },
    { name: 'dias_agendar', label: 'Dias que a IA pode agendar (1–14)', type: 'number', min: 1, max: 14, required: true, col: 6 },
    { name: 'somente_limite', label: 'Agendar só dentro do limite', type: 'switch', col: 6 },
    ...DIAS.map((d, i) => ({ name: `dia${i}`, label: `Liberar ${d}`, type: 'checkbox', col: 3 })),
    { type: 'section', label: 'Profissionais oferecidos' },
    { name: 'profissionais', label: 'Profissionais', type: 'multi', options: state.lists.filter((l) => l.type === 'profissional').map((l) => ({ value: l.id, label: l.name })) },
    { type: 'section', label: 'Perfil clínico' },
    ...[['hof', 'Faz HOF'], ['orto', 'Faz ortodontia'], ['criancas', 'Atende crianças'], ['especiais', 'Atende necessidades especiais'], ['aval_gratis', 'Avaliação gratuita'],
      ['scanner', 'Possui scanner'], ['rx', 'Possui RX panorâmico'], ['camera', 'Câmera intraoral']].map(([n, l]) => ({ name: n, label: l, type: 'switch', col: 6 })),
    { name: 'valor_consulta', label: 'Valor da consulta (R$)', type: 'number', min: 0, col: 6 },
    { type: 'section', label: 'Formas de pagamento e convênios' },
    { name: 'pagamentos', label: 'Formas de pagamento aceitas', col: 6 }, { name: 'convenios', label: 'Convênios', col: 6 },
    { type: 'section', label: 'Voz da IA' },
    { name: 'voz', label: 'Voz', type: 'select', options: opts(['Feminina', 'Masculina']), col: 6 },
    { type: 'section', label: 'Disparos automáticos de áudio' },
    ...[['aud_lembrete', 'Lembretes'], ['aud_primeiro', 'Primeiro contato'], ['aud_firmar', 'Firmar compromisso'], ['aud_proc', 'Procedimentos'], ['aud_geral', 'Clínica geral'], ['aud_falta', 'Falta']]
      .map(([n, l]) => ({ name: n, label: l, type: 'switch', col: 4 })),
  ];
  view.innerHTML = `${pageHeader('Configuração IA de Agendamento', 'Parâmetros usados pela secretária virtual', back)}
    ${card('Parâmetros', `<p class="muted small">Estas configurações ficam salvas para alimentar um assistente de agendamento (IA). A conversa automática pelo WhatsApp depende de integração com a API do WhatsApp e de um provedor de IA/voz.</p><div id="f">${formHTML(fields, cfg)}</div>
    <div class="row end"><a class="btn" href="#/gerenciar">Voltar</a><button class="btn btn-primary" id="s">Salvar</button></div>`)}`;
  initMulti(view);
  view.querySelector('#s').onclick = async () => { try { await api.put('/settings/ia', readForm(view.querySelector('#f'), fields)); toast('Configuração salva'); } catch (e) { errToast(e); } };
}

// ---------------------------------------------------------------- listas
const LIST_TABS = [['origem', 'Origens'], ['status', 'Status'], ['tratamento', 'Tratamentos'], ['fase', 'Fases'], ['avaliador', 'Avaliadores'],
  ['profissional', 'Profissionais'], ['etiqueta', 'Etiquetas'], ['status_agendamento', 'Status de agendamento'], ['situacao', 'Situações']];
export async function listas(view) {
  let tab = 'origem';
  const render = () => {
    const items = state.lists.filter((l) => l.type === tab);
    const col = (st, title) => `<div class="kanban-col" data-state="${st}"><h4>${title}</h4>${items.filter((i) => i.state === st).map((i) =>
      `<div class="kanban-item" draggable="true" data-id="${i.id}"><span>${esc(i.name)}</span><button class="icon-btn" data-ren="${i.id}" title="Renomear">✎</button></div>`).join('') || '<p class="muted small">Arraste itens para cá</p>'}</div>`;
    view.innerHTML = `${pageHeader('Gerenciar listas', 'Arraste os itens entre Padrões, Ativos e Desativados', back)}
      <div class="tabs">${LIST_TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="row"><button class="btn btn-primary" id="novo">+ Criar novo</button></div>
      <div class="kanban">${col('padrao', 'Padrões')}${col('ativo', 'Ativos')}${col('desativado', 'Desativados')}</div>`;
    bind(view, {
      '[data-tab]': (e, el) => { tab = el.dataset.tab; render(); },
      '#novo': () => formModal({ title: 'Criar novo item', fields: [{ name: 'name', label: 'Nome', required: true }], onSubmit: async (v) => {
        const it = await api.post('/lists', { type: tab, name: v.name, state: 'ativo' }); state.lists.push(it); render();
      } }),
      '[data-ren]': (e, el) => {
        const it = state.lists.find((l) => l.id === +el.dataset.ren);
        formModal({ title: 'Renomear', fields: [{ name: 'name', label: 'Nome', required: true }], values: it, onSubmit: async (v) => { Object.assign(it, await api.put(`/lists/${it.id}`, v)); render(); } });
      },
    });
    view.querySelectorAll('.kanban-item').forEach((el) => { el.ondragstart = (e) => e.dataTransfer.setData('text/plain', el.dataset.id); });
    view.querySelectorAll('.kanban-col').forEach((colEl) => {
      colEl.ondragover = (e) => { e.preventDefault(); colEl.classList.add('over'); };
      colEl.ondragleave = () => colEl.classList.remove('over');
      colEl.ondrop = async (e) => {
        e.preventDefault(); colEl.classList.remove('over');
        const id = +e.dataTransfer.getData('text/plain');
        const it = state.lists.find((l) => l.id === id);
        try { Object.assign(it, await api.put(`/lists/${id}`, { state: colEl.dataset.state })); render(); } catch (err) { errToast(err); }
      };
    });
    // Alternativa para telas de toque: clique no item para mover.
    view.querySelectorAll('.kanban-item span').forEach((s) => {
      s.onclick = () => {
        const it = state.lists.find((l) => l.id === +s.parentElement.dataset.id);
        modal({ title: `Mover "${it.name}"`, buttons: [['padrao', 'Padrões'], ['ativo', 'Ativos'], ['desativado', 'Desativados']].filter(([k]) => k !== it.state)
          .map(([k, l]) => ({ label: l, onClick: async () => { Object.assign(it, await api.put(`/lists/${it.id}`, { state: k })); render(); } })) });
      };
    });
  };
  render();
}

export async function grupos(view) {
  let selected = new Set();
  const render = () => {
    const origens = state.lists.filter((l) => l.type === 'origem' && l.state !== 'desativado');
    const gs = [...new Set(['Facebook', 'Google', 'Marketing', 'Não marketing', 'Inválidos', ...origens.map((o) => o.grupo).filter(Boolean)])];
    view.innerHTML = `${pageHeader('Grupos de origem', 'Selecione origens e mova-as para um grupo', back)}
      <div class="row wrap"><select id="dest">${gs.map((g) => `<option>${esc(g)}</option>`).join('')}</select><button class="btn btn-primary" id="mover">Mover para</button>
        <button class="btn" id="novoG">+ Novo grupo</button><span class="muted">${selected.size} selecionada(s)</span></div>
      <div class="kanban">${[...gs, null].map((g) => `<div class="kanban-col"><h4>${g ? esc(g) : 'Sem grupo'}</h4>${origens.filter((o) => (o.grupo || null) === g).map((o) =>
        `<label class="kanban-item"><input type="checkbox" data-o="${o.id}" ${selected.has(o.id) ? 'checked' : ''}> ${esc(o.name)}</label>`).join('') || '<p class="muted small">Vazio</p>'}</div>`).join('')}</div>`;
    view.querySelectorAll('[data-o]').forEach((c) => { c.onchange = () => { if (c.checked) selected.add(+c.dataset.o); else selected.delete(+c.dataset.o); render(); }; });
    bind(view, {
      '#mover': async () => {
        if (!selected.size) return toast('Selecione origens', 'err');
        const grupo = view.querySelector('#dest').value;
        await api.post('/lists/move', { ids: [...selected], grupo });
        state.lists.forEach((l) => { if (selected.has(l.id)) l.grupo = grupo; });
        selected = new Set(); toast('Origens movidas'); render();
      },
      '#novoG': () => formModal({ title: 'Novo grupo', fields: [{ name: 'g', label: 'Nome do grupo', required: true }], onSubmit: (v) => {
        const o = document.createElement('option'); o.textContent = v.g; view.querySelector('#dest').appendChild(o); view.querySelector('#dest').value = v.g;
      } }),
    });
  };
  render();
}

export async function whatsapp(view) {
  const render = (chips) => {
    view.innerHTML = `${pageHeader('Configuração WhatsApp', 'Até três chips', back)}
      <p class="muted">Aqui você registra os números usados pela clínica. A conexão real exige um provedor da API do WhatsApp (por exemplo, a API oficial do WhatsApp Business). Sem ele, as mensagens ficam apenas no histórico do sistema.</p>
      <div class="tiles">${chips.map((c) => `<div class="tile static"><h3>${esc(c.nome)} <span class="pill ${c.status === 'Conectado' ? 'ok' : ''}">${esc(c.status)}</span></h3>
        <p class="muted">Tipo: ${esc(c.tipo || '—')}<br>Número: ${esc(fmtPhone(c.numero)) || '—'}<br>Atualizado: ${fmtDateTime(c.updated_at) || '—'}</p>
        <div class="row wrap">${c.status === 'Conectado' ? `<button class="btn btn-sm" data-dis="${c.id}">Desconectar</button>` : `<button class="btn btn-sm btn-primary" data-con="${c.id}">Conectar</button>`}
        <button class="btn btn-sm" data-upd="${c.id}">Atualizar Dados</button>${c.numero ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(c.numero)}">Abrir Chat</a>` : ''}</div></div>`).join('')}</div>`;
    view.onclick = async (e) => {
      const con = e.target.closest('[data-con]'); const dis = e.target.closest('[data-dis]'); const upd = e.target.closest('[data-upd]');
      try {
        if (con) formModal({ title: 'Conectar chip', fields: [{ type: 'html', html: `<div class="qr" aria-label="QR Code ilustrativo">${fakeQR()}</div><p class="muted small center">QR Code ilustrativo: a leitura real depende do provedor da API do WhatsApp. Informe o número para registrar o chip.</p>` },
          { name: 'numero', label: 'Número com DDD', required: true }], onSubmit: async (v) => { render(await api.post(`/chips/${con.dataset.con}/connect`, v)); await loadBoot(); } });
        if (dis && await confirmDialog('Desconectar este chip?')) { render(await api.post(`/chips/${dis.dataset.dis}/disconnect`)); await loadBoot(); }
        if (upd) {
          const c = chips.find((x) => x.id === +upd.dataset.upd);
          formModal({ title: 'Atualizar dados', fields: [{ name: 'nome', label: 'Nome', required: true }, { name: 'tipo', label: 'Tipo', type: 'select', noEmpty: true, options: opts(['Agendamento', 'Comercial']) }],
            values: c, onSubmit: async (v) => { render(await api.post(`/chips/${c.id}/update`, v)); await loadBoot(); } });
        }
      } catch (err) { errToast(err); }
    };
  };
  render(await api.get('/chips'));
}
function fakeQR() {
  let s = '';
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    const corner = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    const on = corner ? (x % 6 === 0 || y % 6 === 0 || (x % 7 > 1 && x % 7 < 5 && y % 7 > 1 && y % 7 < 5) || x === 20 || y === 20) : ((x * 7 + y * 13 + x * y) % 3 === 0);
    if (on) s += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg viewBox="-1 -1 23 23" width="180" height="180"><rect x="-1" y="-1" width="23" height="23" fill="#fff"/><g fill="#111">${s}</g></svg>`;
}

export async function modelos(view) {
  view.innerHTML = `${pageHeader('Modelos de mensagem', 'Use {{nome}} para inserir o nome do lead', `<button class="btn btn-primary" id="novo">+ Novo modelo</button>${back}`)}<div id="tbl"></div>`;
  const fields = [{ name: 'nome', label: 'Nome', required: true, col: 6 }, { name: 'meta_id', label: 'ID template Meta', col: 6 },
    { name: 'categoria', label: 'Categoria', type: 'select', options: opts(['MARKETING', 'UTILITY', 'AUTHENTICATION']), col: 6 }, { name: 'idioma', label: 'Idioma', col: 6 },
    { name: 'conteudo', label: 'Conteúdo', type: 'textarea', rows: 5, required: true }];
  const table = dataTable(view.querySelector('#tbl'), { id: 'modelos', exportName: 'modelos', columns: [
    { key: 'nome', label: 'Nome' }, { key: 'meta_id', label: 'ID Meta' }, { key: 'categoria', label: 'Categoria' }, { key: 'idioma', label: 'Idioma' },
    { key: 'conteudo', label: 'Conteúdo', render: (r) => `<span class="clip">${esc(r.conteudo)}</span>` }],
  actions: (r) => `<button class="icon-btn" data-edit="${r.id}">✎</button><button class="icon-btn danger" data-del="${r.id}">✕</button>` });
  const load = async () => { await loadBoot(); table.setRows(state.templates); };
  view.querySelector('#novo').onclick = () => formModal({ title: 'Novo modelo', fields, values: { idioma: 'pt_BR' }, onSubmit: async (v) => { await api.post('/templates', v); load(); } });
  view.querySelector('#tbl').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); const d = e.target.closest('[data-del]');
    if (ed) { const t = state.templates.find((x) => x.id === +ed.dataset.edit); formModal({ title: 'Editar modelo', fields, values: t, onSubmit: async (v) => { await api.put(`/templates/${t.id}`, v); load(); } }); }
    if (d && await confirmDialog('Excluir modelo?', { danger: true, ok: 'Excluir' })) { await api.del(`/templates/${d.dataset.del}`); load(); }
  });
  await load();
}

export async function clinicas(view) {
  const c = await api.get('/settings/clinica');
  view.innerHTML = `${pageHeader('Clínicas', 'Clínicas gerenciadas por esta conta', back)}<div id="tbl"></div>`;
  dataTable(view.querySelector('#tbl'), { id: 'clinicas', exportName: 'clinicas', rows: [{ id: 1, ...c }], columns: [
    { key: 'id', label: 'Id' }, { key: 'nome', label: 'Nome' }, { key: 'cnpj', label: 'CNPJ' }, { key: 'email', label: 'E-mail' },
    { key: 'telefone', label: 'Telefone', render: (r) => esc(fmtPhone(r.telefone)) }, { key: 'cidade', label: 'Cidade' }] });
}
export { fmtDate };
