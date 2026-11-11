// Núcleo da interface: API, estado, utilitários e componentes reutilizáveis.
export const state = { user: null, lists: [], users: [], campaigns: [], templates: [], chips: [], clinica: {}, leadSettings: {} };

// ---------------------------------------------------------------- API
async function request(method, url, body) {
  const res = await fetch('/api' + url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !url.startsWith('/login')) { location.hash = '#/login'; throw new Error('Sessão expirada'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}
const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    p.set(k, Array.isArray(v) ? v.join(',') : v);
  });
  const s = p.toString();
  return s ? '?' + s : '';
};
export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body) => request('POST', url, body || {}),
  put: (url, body) => request('PUT', url, body || {}),
  del: (url, body) => request('DELETE', url, body),
};

export async function loadBoot() {
  Object.assign(state, await api.get('/boot'));
}

// ---------------------------------------------------------------- formatação
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : s;
}
export function fmtDateTime(s) {
  if (!s) return '';
  const t = String(s).slice(11, 16);
  return fmtDate(s) + (t ? ' ' + t : '');
}
export const fmtMoney = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtPct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export function fmtPhone(ph, ddi = '+55') {
  const d = String(ph || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11) return `${ddi} (${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${ddi} (${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `${ddi} ${d}`;
}
export const splitDT = (s) => ({ date: s ? String(s).slice(0, 10) : '', time: s ? String(s).slice(11, 16) : '' });
export const joinDT = (date, time) => (date ? `${date} ${time || '00:00'}:00` : '');

// ---------------------------------------------------------------- listas configuráveis
export const lists = (type, includeInactive = false) =>
  state.lists.filter((l) => l.type === type && (includeInactive || l.state !== 'desativado'));
export const listOpts = (type) => lists(type).map((l) => ({ value: l.id, label: l.name }));
export const ln = (id) => (id ? state.lists.find((l) => l.id === Number(id))?.name || '' : '');
export const userName = (id) => state.users.find((u) => u.id === Number(id))?.name || '';
export const userOpts = () => state.users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }));
export const TEMPERATURAS = ['Fervendo', 'Muito quente', 'Quente', 'Morno', 'Frio', 'Muito frio'];
export const TEMP_COLORS = { Fervendo: '#b91c1c', 'Muito quente': '#dc2626', Quente: '#f97316', Morno: '#eab308', Frio: '#3b82f6', 'Muito frio': '#1e40af' };
export const DDIS = ['+55', '+1', '+351', '+44', '+34', '+54', '+595', '+598', '+56', '+57', '+52', '+49', '+33', '+39'];
export const opts = (arr) => arr.map((x) => ({ value: x, label: x }));
export const tagsHTML = (ids) => (ids || []).map((id) => `<span class="tag">${esc(ln(id))}</span>`).join(' ');
export const tempHTML = (t) => (t ? `<span class="temp" style="--c:${TEMP_COLORS[t] || '#888'}">${esc(t)}</span>` : '');
export const can = (perm) => !!(state.user && (state.user.p_admin || state.user['p_' + perm]));

// ---------------------------------------------------------------- toast / modal
export function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}
export const errToast = (e) => toast(e.message || String(e), 'err');

export function modal({ title, body = '', size = '', buttons = [], onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-x aria-label="Fechar">✕</button></div>
    <div class="modal-body"></div><div class="modal-foot"></div></div>`;
  const bodyEl = wrap.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const close = () => { wrap.remove(); onClose && onClose(); };
  const foot = wrap.querySelector('.modal-foot');
  buttons.forEach((b) => {
    const btn = document.createElement('button');
    btn.className = `btn ${b.cls || ''}`;
    btn.textContent = b.label;
    btn.onclick = async () => {
      if (!b.onClick) return close();
      btn.disabled = true;
      try { const r = await b.onClick({ close, body: bodyEl }); if (r !== false) close(); } catch (e) { errToast(e); } finally { btn.disabled = false; }
    };
    foot.appendChild(btn);
  });
  if (!buttons.length) foot.remove();
  wrap.querySelector('[data-x]').onclick = close;
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  const first = bodyEl.querySelector('input,select,textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: wrap, body: bodyEl, close };
}

export function confirmDialog(text, { title = 'Confirmar', ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({ title, body: `<p>${esc(text)}</p>`, onClose: () => resolve(false), buttons: [
      { label: 'Cancelar', onClick: () => resolve(false) },
      { label: ok, cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => resolve(true) },
    ] });
  });
}
export function promptDialog(title, label, { required = true, textarea = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: `<label class="field"><span>${esc(label)}</span>${textarea ? '<textarea name="v" rows="3"></textarea>' : '<input name="v">'}</label>`,
      onClose: () => { if (!done) resolve(null); },
      buttons: [{ label: 'Cancelar' }, { label: 'Confirmar', cls: 'btn-primary', onClick: ({ body }) => {
        const v = body.querySelector('[name=v]').value.trim();
        if (required && !v) { toast('Preencha o campo', 'err'); return false; }
        done = true; resolve(v); return true;
      } }],
    });
  });
}

// ---------------------------------------------------------------- formulários
// Campo: {name, label, type, options, required, col, placeholder, max, min, step, help}
function fieldHTML(f, v) {
  const id = `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`;
  const req = f.required ? 'required' : '';
  const attrs = `id="${id}" name="${f.name}" ${req} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.readonly ? 'readonly' : ''}`;
  let input;
  const val = v ?? f.default ?? '';
  switch (f.type) {
    case 'select':
      input = `<select ${attrs}>${f.noEmpty ? '' : `<option value="">${esc(f.emptyLabel || 'Selecione')}</option>`}${(f.options || [])
        .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      break;
    case 'multi':
      return `<div class="field col-${f.col || 12}"><span>${esc(f.label)}</span>${multiHTML(f.name, f.options || [], val || [])}</div>`;
    case 'textarea':
      input = `<textarea ${attrs} rows="${f.rows || 3}">${esc(val)}</textarea>`; break;
    case 'checkbox':
      return `<label class="check col-${f.col || 12}"><input type="checkbox" name="${f.name}" ${val && val !== '0' ? 'checked' : ''}> <span>${esc(f.label)}</span></label>`;
    case 'switch':
      return `<label class="switch-row col-${f.col || 12}"><span>${esc(f.label)}</span><span class="switch"><input type="checkbox" name="${f.name}" ${val && val !== '0' ? 'checked' : ''}><i></i></span></label>`;
    case 'radio':
      return `<div class="field col-${f.col || 12}"><span>${esc(f.label)}</span><div class="radios">${(f.options || []).map((o) =>
        `<label><input type="radio" name="${f.name}" value="${esc(o.value)}" ${String(o.value) === String(val) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div></div>`;
    case 'phone':
      return `<div class="field col-${f.col || 12}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label><div class="phone-in">
        <select name="${f.ddiName || 'ddi'}">${DDIS.map((d) => `<option ${d === (f.ddi || '+55') ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <input ${attrs} type="tel" value="${esc(val)}" placeholder="(00) 00000-0000"></div></div>`;
    case 'html':
      return `<div class="col-${f.col || 12}">${f.html}</div>`;
    case 'section':
      return `<h4 class="form-section col-12">${esc(f.label)}</h4>`;
    default:
      input = `<input type="${f.type || 'text'}" ${attrs} value="${esc(val)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : (f.type === 'number' ? 'step="any"' : '')}>`;
  }
  return `<div class="field col-${f.col || 12}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.help ? `<small>${esc(f.help)}</small>` : ''}</div>`;
}
export const formHTML = (fields, values = {}) => `<form class="grid-form" onsubmit="return false">${fields.map((f) => fieldHTML(f, values[f.name])).join('')}</form>`;

export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    if (!f.name || ['html', 'section'].includes(f.type)) continue;
    if (f.type === 'multi') { out[f.name] = readMulti(root, f.name); continue; }
    if (f.type === 'checkbox' || f.type === 'switch') { out[f.name] = root.querySelector(`[name="${f.name}"]`)?.checked ? 1 : 0; continue; }
    if (f.type === 'radio') { out[f.name] = root.querySelector(`[name="${f.name}"]:checked`)?.value ?? ''; continue; }
    const el = root.querySelector(`[name="${f.name}"]`);
    let v = el ? el.value.trim() : '';
    if (f.required && !v) throw new Error(`Preencha o campo "${f.label}"`);
    if (f.type === 'number' || f.type === 'money') v = v === '' ? null : Number(v.replace(',', '.'));
    if (f.type === 'select' && f.numeric && v !== '') v = Number(v);
    if (f.type === 'phone') out[f.ddiName || 'ddi'] = root.querySelector(`[name="${f.ddiName || 'ddi'}"]`).value;
    out[f.name] = v === '' ? null : v;
  }
  return out;
}

export function formModal({ title, fields, values = {}, submitLabel = 'Salvar', size = '', onSubmit, extraButtons = [] }) {
  const m = modal({ title, size, body: formHTML(fields, values), buttons: [
    ...extraButtons, { label: 'Cancelar' },
    { label: submitLabel, cls: 'btn-primary', onClick: async ({ body }) => { const v = readForm(body, fields); return onSubmit(v, body); } },
  ] });
  initMulti(m.body);
  return m;
}

// ---------------------------------------------------------------- multisseleção
function multiHTML(name, options, selected) {
  const sel = (selected || []).map(String);
  return `<div class="ms" data-ms="${name}"><button type="button" class="ms-btn">${sel.length ? `${sel.length} selecionado(s)` : 'Todos'}</button>
    <div class="ms-pop"><input class="ms-search" placeholder="Filtrar..."><div class="ms-actions"><a data-all>Marcar todos</a> · <a data-none>Limpar</a></div>
    <div class="ms-list">${options.map((o) => `<label><input type="checkbox" value="${esc(o.value)}" ${sel.includes(String(o.value)) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</div></div></div>`;
}
export function readMulti(root, name) {
  const el = root.querySelector(`[data-ms="${name}"]`);
  if (!el) return [];
  return [...el.querySelectorAll('.ms-list input:checked')].map((i) => (isNaN(i.value) ? i.value : Number(i.value)));
}
export function initMulti(root) {
  root.querySelectorAll('.ms').forEach((ms) => {
    if (ms.dataset.init) return;
    ms.dataset.init = 1;
    const btn = ms.querySelector('.ms-btn');
    const upd = () => { const n = ms.querySelectorAll('.ms-list input:checked').length; btn.textContent = n ? `${n} selecionado(s)` : 'Todos'; };
    btn.onclick = (e) => { e.stopPropagation(); document.querySelectorAll('.ms.open').forEach((o) => o !== ms && o.classList.remove('open')); ms.classList.toggle('open'); };
    ms.querySelector('.ms-pop').addEventListener('click', (e) => e.stopPropagation());
    ms.querySelector('.ms-list').addEventListener('change', upd);
    ms.querySelector('.ms-search').oninput = (e) => {
      const t = e.target.value.toLowerCase();
      ms.querySelectorAll('.ms-list label').forEach((l) => { l.style.display = l.textContent.toLowerCase().includes(t) ? '' : 'none'; });
    };
    ms.querySelector('[data-all]').onclick = () => { ms.querySelectorAll('.ms-list label').forEach((l) => { if (l.style.display !== 'none') l.querySelector('input').checked = true; }); upd(); };
    ms.querySelector('[data-none]').onclick = () => { ms.querySelectorAll('.ms-list input').forEach((i) => { i.checked = false; }); upd(); };
  });
}
document.addEventListener('click', () => document.querySelectorAll('.ms.open, .dropdown.open').forEach((o) => o.classList.remove('open')));

// ---------------------------------------------------------------- exportação
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function exportCSV(name, headers, rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(q).join(';'), ...rows.map((r) => r.map(q).join(';'))].join('\r\n');
  download(`${name}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}
export function exportXLS(name, headers, rows) {
  const cell = (v) => `<td>${esc(v)}</td>`;
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">
    <tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table></body></html>`;
  download(`${name}.xls`, html, 'application/vnd.ms-excel');
}
const stripHTML = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d.textContent.trim(); };

// Lê um CSV (separador ; ou ,) e devolve objetos com cabeçalhos normalizados.
export function parseCSV(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const norm = (h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  const keys = head.map((h) => norm(h.replace(/^﻿/, '')));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
}
export function pickFile(accept = '.csv') {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

// ---------------------------------------------------------------- tabela de dados
// Paginação, busca, ordenação, colunas visíveis e exportação.
const PAGE_SIZES = [4, 10, 25, 50, 100, 200, 0];
export function dataTable(container, cfg) {
  const key = `dt_${cfg.id || 'default'}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { saved = {}; }
  const st = {
    rows: cfg.rows || [], page: 1, size: saved.size ?? cfg.pageSize ?? 25, search: '', sortKey: cfg.sortKey || null, sortDir: cfg.sortDir || 1,
    hidden: new Set(saved.hidden || cfg.columns.filter((c) => c.hidden).map((c) => c.key)), selected: new Set(),
  };
  const persist = () => { try { localStorage.setItem(key, JSON.stringify({ size: st.size, hidden: [...st.hidden] })); } catch { /* sem armazenamento */ } };
  const cols = () => cfg.columns.filter((c) => !st.hidden.has(c.key));
  const cellHTML = (c, r) => (c.render ? c.render(r) : esc(r[c.key] ?? ''));
  const cellText = (c, r) => (c.text ? c.text(r) : stripHTML(String(cellHTML(c, r))));
  const sortVal = (c, r) => (c.sort ? c.sort(r) : (r[c.key] ?? ''));

  function filtered() {
    let rows = st.rows;
    if (st.search) {
      const t = st.search.toLowerCase();
      rows = rows.filter((r) => cfg.columns.some((c) => cellText(c, r).toLowerCase().includes(t)));
    }
    if (st.sortKey) {
      const c = cfg.columns.find((x) => x.key === st.sortKey);
      if (c) rows = [...rows].sort((a, b) => {
        const x = sortVal(c, a); const y = sortVal(c, b);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true })) * st.sortDir;
      });
    }
    return rows;
  }

  container.innerHTML = `<div class="dt">
    <div class="dt-tools">
      <label class="dt-size">Exibir <select>${PAGE_SIZES.map((s) => `<option value="${s}" ${s === st.size ? 'selected' : ''}>${s || 'Todos'}</option>`).join('')}</select> itens</label>
      <input class="dt-search" type="search" placeholder="Buscar na tabela">
      <div class="dt-right">
        ${cfg.toolbar || ''}
        <div class="dropdown"><button class="btn btn-sm" data-cols>Colunas ▾</button><div class="dropdown-menu dt-colmenu">${cfg.columns.map((c) =>
          `<label><input type="checkbox" value="${c.key}" ${st.hidden.has(c.key) ? '' : 'checked'}> ${esc(c.label)}</label>`).join('')}</div></div>
        <button class="btn btn-sm" data-xls>Exportar Tabela</button>
        <button class="btn btn-sm" data-csv>Exportar .csv</button>
      </div>
    </div>
    ${cfg.selectable ? '<div class="dt-bulk"></div>' : ''}
    <div class="dt-scroll"><table class="table"><thead></thead><tbody></tbody></table></div>
    <div class="dt-foot"><span class="dt-info"></span><div class="dt-pages"></div></div></div>`;
  const $ = (s) => container.querySelector(s);

  function render() {
    const rows = filtered();
    const size = st.size || rows.length || 1;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    st.page = Math.min(st.page, pages);
    const pageRows = rows.slice((st.page - 1) * size, st.page * size);
    const cs = cols();
    $('thead').innerHTML = `<tr>${cfg.selectable ? '<th class="dt-chk"><input type="checkbox" data-all></th>' : ''}${cs.map((c) =>
      `<th data-sort="${c.key}" class="${c.noSort ? '' : 'sortable'} ${c.cls || ''} ${st.sortKey === c.key ? (st.sortDir > 0 ? 'asc' : 'desc') : ''}">${esc(c.label)}</th>`).join('')}${cfg.actions ? '<th class="dt-act">Ações</th>' : ''}</tr>`;
    $('tbody').innerHTML = pageRows.length ? pageRows.map((r) => `<tr data-id="${esc(r.id)}" class="${cfg.rowClass ? cfg.rowClass(r) : ''} ${cfg.onRowClick ? 'clickable' : ''}">
      ${cfg.selectable ? `<td class="dt-chk"><input type="checkbox" data-sel="${esc(r.id)}" ${st.selected.has(String(r.id)) ? 'checked' : ''}></td>` : ''}
      ${cs.map((c) => `<td class="${c.cls || ''}">${cellHTML(c, r)}</td>`).join('')}
      ${cfg.actions ? `<td class="dt-act">${cfg.actions(r)}</td>` : ''}</tr>`).join('')
      : `<tr><td colspan="${cs.length + (cfg.selectable ? 1 : 0) + (cfg.actions ? 1 : 0)}" class="empty">Nenhum registro encontrado</td></tr>`;
    $('.dt-info').textContent = rows.length ? `Mostrando ${(st.page - 1) * size + 1} a ${Math.min(st.page * size, rows.length)} de ${rows.length} registros` : '0 registros';
    const btns = [];
    const pb = (p, label, dis) => `<button class="pg ${p === st.page ? 'on' : ''}" data-page="${p}" ${dis ? 'disabled' : ''}>${label}</button>`;
    btns.push(pb(st.page - 1, '‹', st.page === 1));
    for (let p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - st.page) <= 2) btns.push(pb(p, p));
      else if (Math.abs(p - st.page) === 3) btns.push('<span class="pg-gap">…</span>');
    }
    btns.push(pb(st.page + 1, '›', st.page === pages));
    $('.dt-pages').innerHTML = btns.join('');
    if (cfg.selectable) {
      const n = st.selected.size;
      $('.dt-bulk').innerHTML = cfg.bulk ? cfg.bulk(n) : '';
      $('.dt-bulk').style.display = cfg.bulk ? '' : 'none';
    }
    cfg.onRender && cfg.onRender(container);
  }

  $('.dt-size select').onchange = (e) => { st.size = Number(e.target.value); st.page = 1; persist(); render(); };
  $('.dt-search').oninput = (e) => { st.search = e.target.value; st.page = 1; render(); };
  $('[data-cols]').onclick = (e) => { e.stopPropagation(); e.target.closest('.dropdown').classList.toggle('open'); };
  $('.dt-colmenu').addEventListener('click', (e) => e.stopPropagation());
  $('.dt-colmenu').onchange = (e) => { if (e.target.checked) st.hidden.delete(e.target.value); else st.hidden.add(e.target.value); persist(); render(); };
  const exportRows = () => { const cs = cols(); return [cs.map((c) => c.label), filtered().map((r) => cs.map((c) => cellText(c, r)))]; };
  $('[data-xls]').onclick = () => exportXLS(cfg.exportName || 'tabela', ...exportRows());
  $('[data-csv]').onclick = () => exportCSV(cfg.exportName || 'tabela', ...exportRows());
  container.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort].sortable');
    if (th) { st.sortDir = st.sortKey === th.dataset.sort ? -st.sortDir : 1; st.sortKey = th.dataset.sort; render(); return; }
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { st.page = Number(pg.dataset.page); render(); return; }
    if (e.target.matches('[data-sel], [data-all]') || e.target.closest('.dt-act, .dt-chk, a, button')) return;
    const tr = e.target.closest('tbody tr[data-id]');
    if (tr && cfg.onRowClick) { const r = st.rows.find((x) => String(x.id) === tr.dataset.id); if (r) cfg.onRowClick(r); }
  });
  container.addEventListener('change', (e) => {
    if (e.target.matches('[data-sel]')) {
      if (e.target.checked) st.selected.add(e.target.dataset.sel); else st.selected.delete(e.target.dataset.sel);
      render();
    } else if (e.target.matches('[data-all]')) {
      const size = st.size || 1e9;
      filtered().slice((st.page - 1) * size, st.page * size).forEach((r) => (e.target.checked ? st.selected.add(String(r.id)) : st.selected.delete(String(r.id))));
      render();
    }
  });
  render();
  return {
    setRows(rows) { st.rows = rows; st.selected = new Set([...st.selected].filter((id) => rows.some((r) => String(r.id) === id))); render(); },
    selected: () => [...st.selected].map(Number),
    clearSelection() { st.selected.clear(); render(); },
    visibleRows: filtered,
  };
}

// ---------------------------------------------------------------- utilidades de página
export function pageHeader(title, subtitle = '', right = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</div><div class="page-actions">${right}</div></div>`;
}
export const backBtn = (href) => `<a class="btn" href="${href || 'javascript:history.back()'}">← Voltar</a>`;
export function card(title, body, right = '') {
  return `<section class="card"><div class="card-head"><h3>${esc(title)}</h3><div>${right}</div></div><div class="card-body">${body}</div></section>`;
}
export const kpi = (label, value, extra = '') => `<div class="kpi"><span>${esc(label)}</span><strong>${value}</strong>${extra ? `<small>${extra}</small>` : ''}</div>`;
export function bind(root, map) {
  Object.entries(map).forEach(([sel, fn]) => root.querySelectorAll(sel).forEach((el) => { el.onclick = (e) => { e.preventDefault(); fn(e, el); }; }));
}
// Painel de filtros recolhível.
export function filterPanel(fields, values, { onFilter, onClear }) {
  const el = document.createElement('div');
  el.className = 'filters card';
  el.innerHTML = `<div class="card-body">${formHTML(fields, values)}<div class="filter-actions"><button class="btn" data-clear>Limpar Filtros</button><button class="btn btn-primary" data-go>Filtrar</button></div></div>`;
  initMulti(el);
  el.querySelector('[data-go]').onclick = () => { try { onFilter(readForm(el, fields)); } catch (e) { errToast(e); } };
  el.querySelector('[data-clear]').onclick = () => onClear();
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') el.querySelector('[data-go]').click(); });
  return el;
}
export function parseQuery() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}
