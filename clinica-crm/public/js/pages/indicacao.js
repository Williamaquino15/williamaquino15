// Programa de indicação de pacientes.
import { api, esc, toast, errToast, modal, formModal, dataTable, pageHeader, filterPanel, fmtDate, fmtPhone, fmtMoney, confirmDialog, initMulti } from '../core.js';

export async function render(view) {
  let filters = {};
  view.innerHTML = `${pageHeader('Indicação', 'Programa de indicação de pacientes', `
    <button class="btn" id="procurar">Procurar Leads</button><button class="btn" id="toggleF">Filtros</button><button class="btn btn-primary" id="novo">+ Criar Paciente</button>`)}
    <div id="fbox" hidden></div><div id="tbl"></div>`;
  let all = [];
  const table = dataTable(view.querySelector('#tbl'), {
    id: 'indicacao', exportName: 'indicacao',
    columns: [
      { key: 'lead_novo', label: 'Lead novo', render: (r) => (r.indicados_list.some((x) => x.lead_id && !x.data_comparecimento) ? '<span class="pill ok">Sim</span>' : 'Não') },
      { key: 'name', label: 'Nome' }, { key: 'phone', label: 'Telefone', render: (r) => esc(fmtPhone(r.phone)) },
      { key: 'satisfacao', label: 'Nota de satisfação' }, { key: 'prob_indicacao', label: 'Probabilidade de indicação' },
      { key: 'ultima_indicacao', label: 'Última indicação', render: (r) => fmtDate(r.ultima_indicacao) },
      { key: 'data_agendamento', label: 'Data do agendamento', render: (r) => fmtDate(r.data_agendamento) },
      { key: 'obs', label: 'Obs indicação', render: (r) => `<span class="clip">${esc(r.obs)}</span>` },
      { key: 'indicados', label: 'Indicados' }, { key: 'agendados', label: 'Agendados' }, { key: 'comparecidos', label: 'Comparecidos' },
      { key: 'fechados', label: 'Fechados' }, { key: 'pontos', label: 'Pontos' },
      { key: 'oportunidades', label: 'Oportunidades', render: (r) => fmtMoney(r.oportunidades), sort: (r) => r.oportunidades },
      { key: 'fechamentos', label: 'Fechamentos', render: (r) => fmtMoney(r.fechamentos), sort: (r) => r.fechamentos },
    ],
    actions: (r) => `<button class="icon-btn" data-edit="${r.id}" title="Editar">✎</button><button class="icon-btn danger" data-del="${r.id}" title="Excluir">✕</button>`,
    onRowClick: (r) => edit(r),
  });
  const apply = () => table.setRows(all.filter((r) => {
    if (filters.ind_de && !r.indicados_list.some((x) => x.data_indicacao >= filters.ind_de)) return false;
    if (filters.ind_ate && !r.indicados_list.some((x) => x.data_indicacao && x.data_indicacao <= filters.ind_ate)) return false;
    if (filters.ult_de && !(r.ultima_indicacao >= filters.ult_de)) return false;
    if (filters.ult_ate && !(r.ultima_indicacao && r.ultima_indicacao <= filters.ult_ate)) return false;
    return true;
  }));
  const load = async () => { all = await api.get('/referrals'); apply(); };
  const fbox = view.querySelector('#fbox');
  const ff = [
    { name: 'ind_de', label: 'Data de indicação (mín.)', type: 'date', col: 3 }, { name: 'ind_ate', label: 'Data de indicação (máx.)', type: 'date', col: 3 },
    { name: 'ult_de', label: 'Data da última indicação (de)', type: 'date', col: 3 }, { name: 'ult_ate', label: 'Data da última indicação (até)', type: 'date', col: 3 },
  ];
  const mount = () => { fbox.innerHTML = ''; fbox.appendChild(filterPanel(ff, filters, { onFilter: (v) => { filters = v; apply(); }, onClear: () => { filters = {}; mount(); apply(); } })); };
  mount();

  function edit(p) {
    const rowsHTML = (list) => list.map((r, i) => `<tr data-i="${i}" data-id="${r.id || ''}"><td><input name="n" value="${esc(r.name)}" placeholder="Nome"></td><td><input name="t" value="${esc(r.phone)}" placeholder="Telefone"></td>
      <td><input type="date" name="di" value="${esc(r.data_indicacao || '')}"></td><td><input type="date" name="dc" value="${esc(r.data_comparecimento || '')}"></td><td><button class="icon-btn danger" data-rm>✕</button></td></tr>`).join('');
    const fields = [
      { name: 'name', label: 'Nome do paciente', required: true, col: 6 }, { name: 'phone', label: 'Telefone', col: 6 },
      { name: 'satisfacao', label: 'Satisfação (0–10)', type: 'number', min: 0, max: 10, col: 4 },
      { name: 'prob_indicacao', label: 'Probabilidade de Indicação (0–10)', type: 'number', min: 0, max: 10, col: 4 },
      { name: 'ultima_indicacao', label: 'Última vez que pediu indicação', type: 'date', col: 4 },
      { name: 'data_agendamento', label: 'Data do agendamento', type: 'date', col: 4 },
      { name: 'obs', label: 'Observações', type: 'textarea' },
      { type: 'html', html: `<h4>Indicados</h4><p class="muted small">Cada indicado novo é cadastrado automaticamente como lead com origem "Indicação".</p>
        <div class="table-wrap"><table class="table edit-table"><thead><tr><th>Nome</th><th>Telefone</th><th>Data da indicação</th><th>Data de comparecimento</th><th></th></tr></thead>
        <tbody id="inds">${rowsHTML(p.indicados_list)}</tbody></table></div><button type="button" class="btn btn-sm" id="addInd">+ Adicionar indicado</button>` },
    ];
    const m = formModal({ title: 'Editar Indicação', size: 'lg', fields, values: p, onSubmit: async (v, body) => {
      const indicados = [...body.querySelectorAll('#inds tr')].map((tr) => ({
        id: tr.dataset.id ? +tr.dataset.id : undefined, name: tr.querySelector('[name=n]').value.trim(), phone: tr.querySelector('[name=t]').value,
        data_indicacao: tr.querySelector('[name=di]').value || null, data_comparecimento: tr.querySelector('[name=dc]').value || null,
      }));
      await api.put(`/referrals/${p.id}`, { ...v, indicados });
      toast('Indicação salva'); load();
    } });
    const tb = m.body.querySelector('#inds');
    m.body.querySelector('#addInd').onclick = () => { tb.insertAdjacentHTML('beforeend', rowsHTML([{ name: '', phone: '', data_indicacao: new Date().toISOString().slice(0, 10) }])); };
    tb.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('tr').remove(); });
  }

  view.querySelector('#tbl').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return edit(all.find((r) => r.id === +ed.dataset.edit));
    const d = e.target.closest('[data-del]');
    if (d && await confirmDialog('Excluir este paciente do programa de indicação?', { danger: true, ok: 'Excluir' })) { await api.del(`/referrals/${d.dataset.del}`); load(); }
  });
  view.querySelector('#toggleF').onclick = () => { fbox.hidden = !fbox.hidden; };
  view.querySelector('#novo').onclick = () => formModal({ title: 'Criar Paciente', fields: [{ name: 'name', label: 'Nome do paciente', required: true }, { name: 'phone', label: 'Telefone' }],
    onSubmit: async (v) => { await api.post('/referrals', v); toast('Paciente criado'); load(); } });
  view.querySelector('#procurar').onclick = async () => {
    const clients = await api.get('/clients');
    const m = modal({ title: 'Procurar Leads / Clientes', size: 'lg', body: `<input id="s" placeholder="Buscar por nome ou telefone" class="w100"><div id="res" class="search-res"></div>` });
    const draw = (t = '') => {
      const tt = t.toLowerCase();
      m.body.querySelector('#res').innerHTML = clients.filter((c) => !tt || c.name.toLowerCase().includes(tt) || String(c.phone).includes(tt)).slice(0, 50)
        .map((c) => `<div class="res-row"><span>${esc(c.name)} — ${esc(fmtPhone(c.phone, c.ddi))}</span><button class="btn btn-sm" data-add="${c.id}">Adicionar ao programa</button></div>`).join('') || '<p class="muted">Nenhum cliente</p>';
    };
    draw();
    m.body.querySelector('#s').oninput = (e) => draw(e.target.value);
    m.body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      const c = clients.find((x) => x.id === +b.dataset.add);
      await api.post('/referrals', { name: c.name, phone: c.phone, client_id: c.id, lead_id: c.lead_id });
      b.disabled = true; b.textContent = 'Adicionado'; load();
    });
  };
  initMulti(view);
  await load();
}
export { errToast };
