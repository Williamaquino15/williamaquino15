// Agenda: calendário mensal/semanal com legenda de cores e criação de agendamentos/bloqueios.
import { api, esc, toast, errToast, modal, formModal, pageHeader, listOpts, ln, fmtDate, fmtPhone, todayISO, opts, confirmDialog } from '../core.js';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function colorClass(a) {
  if (a.bloqueio) return 'ev-gray';
  if (a.confirmado_ia) return 'ev-green';
  if (a.integracao_erro) return 'ev-red';
  if (a.origem === 'integracao') return 'ev-blue';
  return 'ev-yellow';
}

export async function render(view) {
  let cur = new Date(); cur.setDate(1);
  let mode = 'mes';
  let weekStart = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d; })();

  view.innerHTML = `${pageHeader('Agenda', 'Agendamentos da clínica')}
    <div class="card"><div class="card-body row wrap cal-tools">
      <select id="mes">${MESES.map((m, i) => `<option value="${i}">${m}</option>`).join('')}</select>
      <input id="ano" type="number" min="2000" max="2100" style="width:100px">
      <button class="btn" id="buscar">Buscar</button>
      <span class="sep"></span>
      <button class="btn" id="prev">‹</button><button class="btn" id="hoje">Hoje</button><button class="btn" id="next">›</button>
      <span class="sep"></span>
      <div class="seg"><button data-mode="mes" class="on">Mês</button><button data-mode="semana">Semana</button></div>
      <button class="btn btn-primary" id="novo">+ Agendamento</button><button class="btn" id="bloq">Bloquear horário</button>
    </div>
    <div class="legend">
      <span><i class="ev-yellow"></i>Agendado pelo sistema sem erro de integração</span><span><i class="ev-red"></i>Com erro de integração</span>
      <span><i class="ev-blue"></i>Agendado pela integração</span><span><i class="ev-gray"></i>Bloqueio na agenda da clínica</span><span><i class="ev-green"></i>Confirmado pela IA</span>
    </div></div>
    <h2 id="title" class="cal-title"></h2><div id="cal"></div>`;
  const $ = (s) => view.querySelector(s);

  async function load() {
    let from; let to;
    if (mode === 'mes') {
      const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const start = new Date(first); start.setDate(1 - first.getDay());
      const end = new Date(start); end.setDate(start.getDate() + 41);
      from = iso(start); to = iso(end);
      $('#title').textContent = `${MESES[cur.getMonth()]} de ${cur.getFullYear()}`;
      $('#mes').value = cur.getMonth(); $('#ano').value = cur.getFullYear();
      const appts = await api.get('/appointments', { from, to });
      drawMonth(start, appts);
    } else {
      const end = new Date(weekStart); end.setDate(weekStart.getDate() + 6);
      from = iso(weekStart); to = iso(end);
      $('#title').textContent = `Semana de ${fmtDate(from)} a ${fmtDate(to)}`;
      drawWeek(await api.get('/appointments', { from, to }));
    }
  }
  const evHTML = (a) => `<button class="ev ${colorClass(a)}" data-ev="${a.id}" title="${esc(a.lead_name || 'Bloqueio')}">${esc(a.start)} ${esc(a.bloqueio ? 'Bloqueio' : a.lead_name || '')}</button>`;
  let current = [];
  function drawMonth(start, appts) {
    current = appts;
    const today = todayISO();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = iso(d);
      const evs = appts.filter((a) => a.date === k);
      cells.push(`<div class="cal-cell ${d.getMonth() !== cur.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''}" data-day="${k}">
        <span class="cal-day">${d.getDate()}</span>${evs.slice(0, 4).map(evHTML).join('')}${evs.length > 4 ? `<a class="more" data-more="${k}">+${evs.length - 4} mais</a>` : ''}</div>`);
    }
    $('#cal').innerHTML = `<div class="cal-month">${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('')}${cells.join('')}</div>`;
  }
  function drawWeek(appts) {
    current = appts;
    const days = [...Array(7)].map((_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; });
    $('#cal').innerHTML = `<div class="cal-week">${days.map((d) => {
      const k = iso(d);
      const evs = appts.filter((a) => a.date === k);
      return `<div class="cal-col ${k === todayISO() ? 'today' : ''}" data-day="${k}"><div class="cal-dow">${DOW[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}</div>
        ${evs.map((a) => `<button class="ev big ${colorClass(a)}" data-ev="${a.id}"><b>${esc(a.start)}–${esc(a.end)}</b><br>${esc(a.bloqueio ? 'Bloqueio' : a.lead_name || '')}<br><small>${esc(ln(a.profissional_id))}</small></button>`).join('') || '<p class="muted small">Livre</p>'}</div>`;
    }).join('')}</div>`;
  }

  function detail(a) {
    modal({
      title: a.bloqueio ? 'Bloqueio de agenda' : 'Detalhe do agendamento',
      body: `<dl class="dl">${a.bloqueio ? '' : `<dt>Origem</dt><dd>${esc(ln(a.origem_id)) || '—'}</dd><dt>Nome</dt><dd><a href="#/leads/editar/${a.lead_id}">${esc(a.lead_name)}</a></dd>`}
        <dt>Data</dt><dd>${fmtDate(a.date)}</dd><dt>Horário início</dt><dd>${esc(a.start)}</dd><dt>Horário final</dt><dd>${esc(a.end)}</dd>
        <dt>Profissional</dt><dd>${esc(ln(a.profissional_id)) || '—'}</dd>${a.bloqueio ? '' : `<dt>Telefone</dt><dd>${esc(fmtPhone(a.phone, a.ddi))}</dd><dt>Status</dt><dd>${esc(a.status)}</dd>`}
        <dt>Descrição</dt><dd>${esc(a.descricao) || '—'}</dd></dl>`,
      buttons: [
        { label: 'Excluir', cls: 'btn-danger-o', onClick: async () => { if (!(await confirmDialog('Excluir?', { danger: true, ok: 'Excluir' }))) return false; await api.del(`/appointments/${a.id}`); load(); } },
        ...(a.bloqueio ? [] : [{ label: 'Alterar status', onClick: () => { statusForm(a); } }]),
        { label: 'Fechar' },
      ],
    });
  }
  function statusForm(a) {
    formModal({ title: 'Status do agendamento', fields: [
      { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: listOpts('status_agendamento').map((o) => ({ value: o.label, label: o.label })) },
      { name: 'confirmado_ia', label: 'Confirmado pela IA', type: 'checkbox' }],
    values: a, onSubmit: async (v) => { await api.put(`/appointments/${a.id}`, v); toast('Agendamento atualizado'); load(); } });
  }
  async function create(date, bloqueio = false) {
    let leadsOpts = [];
    if (!bloqueio) {
      const leads = await api.get('/leads');
      leadsOpts = leads.map((l) => ({ value: l.id, label: `${l.name} — ${fmtPhone(l.phone, l.ddi)}` }));
    }
    formModal({ title: bloqueio ? 'Bloquear horário' : 'Novo agendamento', fields: [
      ...(bloqueio ? [] : [{ name: 'lead_id', label: 'Lead', type: 'select', numeric: true, required: true, options: leadsOpts }]),
      { name: 'date', label: 'Data', type: 'date', required: true, col: 4 }, { name: 'start', label: 'Horário inicial', type: 'time', required: true, col: 4 },
      { name: 'end', label: 'Horário final', type: 'time', col: 4 },
      { name: 'profissional_id', label: 'Profissional', type: 'select', numeric: true, options: listOpts('profissional') },
      ...(bloqueio ? [] : [{ name: 'origem', label: 'Origem do agendamento', type: 'select', noEmpty: true, options: [{ value: 'app', label: 'Sistema' }, { value: 'integracao', label: 'Integração' }] }]),
      { name: 'descricao', label: 'Descrição', type: 'textarea' }],
    values: { date: date || todayISO() }, onSubmit: async (v) => { await api.post('/appointments', { ...v, bloqueio: bloqueio ? 1 : 0, status: bloqueio ? 'Bloqueio' : 'Agendado' }); toast('Salvo'); load(); } });
  }

  view.addEventListener('click', (e) => {
    const ev = e.target.closest('[data-ev]');
    if (ev) { detail(current.find((a) => a.id === +ev.dataset.ev)); return; }
    const more = e.target.closest('[data-more]');
    if (more) { mode = 'semana'; const d = new Date(`${more.dataset.more}T12:00`); d.setDate(d.getDate() - d.getDay()); weekStart = d; syncSeg(); load().catch(errToast); return; }
    const md = e.target.closest('[data-mode]');
    if (md) { mode = md.dataset.mode; syncSeg(); load().catch(errToast); return; }
    const cell = e.target.closest('[data-day]');
    if (cell && e.detail === 2) create(cell.dataset.day).catch(errToast);
  });
  const syncSeg = () => view.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#buscar').onclick = () => { cur = new Date(+$('#ano').value, +$('#mes').value, 1); mode = 'mes'; syncSeg(); load().catch(errToast); };
  $('#prev').onclick = () => { if (mode === 'mes') cur.setMonth(cur.getMonth() - 1); else weekStart.setDate(weekStart.getDate() - 7); load().catch(errToast); };
  $('#next').onclick = () => { if (mode === 'mes') cur.setMonth(cur.getMonth() + 1); else weekStart.setDate(weekStart.getDate() + 7); load().catch(errToast); };
  $('#hoje').onclick = () => { cur = new Date(); cur.setDate(1); weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); load().catch(errToast); };
  $('#novo').onclick = () => create().catch(errToast);
  $('#bloq').onclick = () => create(null, true).catch(errToast);
  await load();
}
export { opts };
