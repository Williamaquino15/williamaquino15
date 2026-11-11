// Layout, autenticação e roteamento por hash.
import { state, api, loadBoot, esc, toast, errToast, can, modal } from './core.js';
import * as leads from './pages/leads.js';
import * as clientes from './pages/clientes.js';
import * as dashboard from './pages/dashboard.js';
import * as agenda from './pages/agenda.js';
import * as indicacao from './pages/indicacao.js';
import * as campanhas from './pages/campanhas.js';
import * as gerenciar from './pages/gerenciar.js';
import * as relatorios from './pages/relatorios.js';
import * as misc from './pages/misc.js';

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  heart: '<path d="M12 21s-8-5-8-11a5 5 0 0 1 8-3 5 5 0 0 1 8 3c0 6-8 11-8 11z"/>',
  share: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.6 10.5l6.8-3M8.6 13.5l6.8 3"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
};
export const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

const MENU = [
  { href: '#/home', label: 'Home', icon: 'home' },
  { href: '#/dashboard', label: 'Painel de Indicadores', icon: 'chart', perm: 'dashboard' },
  { href: '#/leads', label: 'Leads', icon: 'users', perm: 'leads' },
  { href: '#/leads/proximos', label: 'Próximos Contatos', icon: 'clock', perm: 'leads' },
  { href: '#/clientes', label: 'Clientes', icon: 'heart', perm: 'clientes' },
  { href: '#/indicacao', label: 'Indicação', icon: 'share' },
  { href: '#/gerenciar', label: 'Gerenciar', icon: 'cog' },
  { href: '#/agenda', label: 'Agenda', icon: 'cal' },
  { href: '#/relatorios', label: 'Relatórios', icon: 'doc' },
];

// Rotas: padrão → [render, permissão]
const ROUTES = [
  ['/home', misc.home], ['/dashboard', dashboard.render, 'dashboard'],
  ['/leads', leads.list, 'leads'], ['/leads/proximos', leads.proximos, 'leads'],
  ['/leads/recuperar-leads-excluidos', leads.recuperar, 'leads'], ['/leads/editar/:id', leads.ficha, 'leads'],
  ['/clientes', clientes.list, 'clientes'], ['/clientes/editar/:id', clientes.ficha, 'clientes'],
  ['/indicacao', indicacao.render], ['/agenda', agenda.render],
  ['/disparo/campanhas', campanhas.list], ['/disparo/campanhas/criar', campanhas.criar],
  ['/gerenciar', gerenciar.home], ['/perfil', gerenciar.perfil], ['/gerenciar/pagamento', gerenciar.pagamento, 'admin'],
  ['/usuarios', gerenciar.usuarios, 'admin'], ['/gerenciar/configuracoes', gerenciar.configuracoes, 'admin'],
  ['/gerenciar/configuracao-ia', gerenciar.ia, 'admin'], ['/gerenciar/listas', gerenciar.listas, 'admin'],
  ['/gerenciar/grupos-de-origem', gerenciar.grupos, 'admin'], ['/gerenciar/whatsapp', gerenciar.whatsapp, 'admin'],
  ['/gerenciar/modelos', gerenciar.modelos, 'admin'], ['/gerenciar/clinicas', gerenciar.clinicas, 'admin'],
  ['/relatorios', relatorios.home], ['/relatorios/:name', relatorios.render], ['/ferramenta-comercial', relatorios.ferramenta],
  ['/ajuda', misc.ajuda], ['/atualizacoes', misc.atualizacoes], ['/aulas', misc.aulas, 'aulas'], ['/transmissao', misc.transmissao, 'aulas'],
];

function match(path) {
  for (const [pattern, fn, perm] of ROUTES) {
    const pp = pattern.split('/'); const xp = path.split('/');
    if (pp.length !== xp.length) continue;
    const params = {};
    if (pp.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(xp[i])), true) : p === xp[i]))) return { fn, perm, params };
  }
  return null;
}

function renderLogin() {
  document.getElementById('app').innerHTML = `<div class="login">
    <form class="login-card" id="loginForm">
      <div class="brand big">${logo()}<span>Clínica CRM</span></div>
      <p class="muted">Entre com sua conta para acessar o sistema.</p>
      <label class="field"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="field"><span>Senha</span><input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn btn-primary btn-block">Entrar</button>
    </form></div>`;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api.post('/login', { email: f.get('email'), password: f.get('password') });
      await start();
      location.hash = '#/home';
    } catch (err) { errToast(err); }
  };
}
const logo = () => `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0f766e"/><path d="M10 16h12M16 10v12" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>`;

function renderShell() {
  const u = state.user;
  document.getElementById('app').innerHTML = `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#/home">${logo()}<span>Clínica CRM</span></a>
      <nav>${MENU.filter((m) => !m.perm || can(m.perm)).map((m) => `<a href="${m.href}" data-nav="${m.href}">${icon(m.icon)}<span>${m.label}</span></a>`).join('')}</nav>
      <div class="side-foot muted">${esc(state.clinica.nome || '')}</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-toggle" id="menuToggle" aria-label="Menu">☰</button>
        <div class="top-right">
          <button class="btn btn-sm btn-ghost" id="installBtn" hidden>Instalar App</button>
          <div class="dropdown" id="notifDd"><button class="icon-btn" id="notifBtn" aria-label="Notificações">🔔<b class="badge" hidden></b></button>
            <div class="dropdown-menu right notif-menu"></div></div>
          <div class="dropdown" id="accDd"><button class="btn btn-sm btn-ghost" id="accBtn">${esc(u.name)} ▾</button>
            <div class="dropdown-menu right">
              <a href="#/perfil">Perfil</a>
              ${u.p_admin ? '<a href="#/gerenciar/configuracoes">Configurações</a><a href="#/usuarios">Usuários e Permissões</a><a href="#/gerenciar/whatsapp">Configuração WhatsApp</a><a href="#/gerenciar/clinicas">Clínicas</a>' : ''}
              ${can('aulas') ? '<a href="#/transmissao">Transmissão ao vivo</a><a href="#/aulas">Aulas Gravadas</a>' : ''}
              <a href="#/atualizacoes">Últimas Atualizações</a><a href="#/ajuda">Central de Ajuda</a>
              <a href="#" id="logoutBtn">Sair</a>
            </div></div>
        </div>
      </header>
      <main id="view" class="view"></main>
    </div>
    <button class="fab" id="fab" aria-label="Ajuda e atalhos">?</button>
  </div>`;
  document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) document.getElementById('sidebar').classList.remove('open'); });
  ['notifDd', 'accDd'].forEach((id) => {
    const dd = document.getElementById(id);
    dd.querySelector('button').onclick = (e) => { e.stopPropagation(); const open = dd.classList.contains('open'); document.querySelectorAll('.dropdown.open').forEach((d) => d.classList.remove('open')); if (!open) dd.classList.add('open'); };
  });
  document.getElementById('logoutBtn').onclick = async (e) => { e.preventDefault(); await api.post('/logout'); state.user = null; location.hash = '#/login'; renderLogin(); };
  document.getElementById('fab').onclick = () => modal({ title: 'Atalhos e suporte', body: `<div class="quick-links">
    ${can('leads') ? '<a href="#/leads?novo=1" class="btn">+ Criar Lead</a><a href="#/leads/proximos" class="btn">Próximos Contatos</a>' : ''}
    <a href="#/agenda" class="btn">Agenda</a><a href="#/ajuda" class="btn">Central de Ajuda</a></div>
    <p class="muted">Dica: use a busca rápida em Leads para encontrar por nome, telefone ou ID.</p>` }) && null;
  document.getElementById('fab').addEventListener('click', () => setTimeout(() => document.querySelectorAll('.quick-links a').forEach((a) => a.addEventListener('click', () => document.querySelector('.modal-wrap')?.remove())), 0));
  setupInstall();
  loadNotifications();
}

async function loadNotifications() {
  try {
    const items = await api.get('/notifications');
    const badge = document.querySelector('#notifBtn .badge');
    badge.hidden = !items.length; badge.textContent = items.length;
    document.querySelector('.notif-menu').innerHTML = items.length
      ? items.map((i) => `<a href="${i.link}" class="notif ${i.level}">${esc(i.text)}</a>`).join('') : '<div class="notif muted">Nenhuma notificação</div>';
  } catch { /* silencioso */ }
}

let deferredPrompt = null;
function setupInstall() {
  const btn = document.getElementById('installBtn');
  if (deferredPrompt) btn.hidden = false;
  btn.onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; btn.hidden = true; };
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; const b = document.getElementById('installBtn'); if (b) b.hidden = false; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

async function route() {
  const hash = location.hash.slice(1) || '/home';
  const path = hash.split('?')[0];
  if (path === '/login') { if (state.user) { location.hash = '#/home'; return; } renderLogin(); return; }
  if (!state.user) { renderLogin(); return; }
  if (!document.getElementById('view')) renderShell();
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const href = a.dataset.nav.slice(1);
    a.classList.toggle('active', path === href || (href !== '/leads' && href !== '/home' && path.startsWith(href + '/')) || (href === '/leads' && /^\/leads\/(editar|recuperar)/.test(path)));
  });
  const view = document.getElementById('view');
  const m = match(path);
  if (!m) { view.innerHTML = '<div class="empty-state"><h2>Página não encontrada</h2><a class="btn" href="#/home">Ir para o início</a></div>'; return; }
  if (m.perm && !can(m.perm)) { view.innerHTML = '<div class="empty-state"><h2>Sem permissão</h2><p class="muted">Seu usuário não tem acesso a esta área.</p></div>'; return; }
  view.innerHTML = '<div class="loading">Carregando…</div>';
  window.scrollTo(0, 0);
  try { await m.fn(view, m.params); } catch (e) { view.innerHTML = `<div class="empty-state"><h2>Erro</h2><p>${esc(e.message)}</p></div>`; }
  loadNotifications();
}

async function start() {
  await loadBoot();
  renderShell();
}

window.addEventListener('hashchange', route);
(async () => {
  try { await start(); } catch { state.user = null; }
  route();
})();
export { toast };
