// Ponto de entrada da demonstração: SQLite em WebAssembly + servidor no navegador + interface.
const initSqlJs = require('sql.js/dist/sql-wasm.js');
const WASM_B64 = require('wasm-b64');
const { HexBytes } = require('crypto');

globalThis.Buffer = { from: (s) => HexBytes.from(String(s).match(/../g).map((h) => parseInt(h, 16))) };

const DB_NAME = 'clinica-crm-demo';
function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction('kv', mode);
          const r = fn(tx.objectStore('kv'));
          tx.oncomplete = () => resolve(r && 'result' in r ? r.result : null);
          tx.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Dados de exemplo para a primeira abertura.
async function seed(call) {
  const lists = (await call('GET', '/lists')).body;
  const id = (type, name) => lists.find((l) => l.type === type && l.name === name)?.id;
  await call('PUT', '/settings/clinica', { nome: 'Exclusive Odontologia', cidade: 'São Paulo', estado: 'SP' });
  const people = [
    ['Ana Beatriz Souza', '11987651234', 'Instagram', 'Quente', 'Atendeu', -9, 1, 'compareceu', 6800, 'Fechado', 'Implantes'],
    ['Carlos Eduardo Lima', '11991237788', 'Google', 'Muito quente', 'Agendado', -7, 2, 'compareceu', 12500, 'Em Aberto', 'Protocolo'],
    ['Fernanda Ribeiro', '21998764455', 'Facebook', 'Morno', 'Aguardando Resposta', -6, -1],
    ['João Pedro Alves', '11976543210', 'Site', 'Quente', 'Agendado', -5, 3, 'agendado'],
    ['Mariana Costa', '31988776655', 'Indicação', 'Fervendo', 'Atendeu', -4, 0, 'compareceu', 4200, 'Fechado', 'Lentes'],
    ['Rafael Martins', '11965432109', 'Instagram', 'Frio', 'Não atende', -4, -2],
    ['Juliana Pereira', '11954321098', 'Facebook', 'Quente', 'Agendado', -3, 1, 'faltou'],
    ['Lucas Fernandes', '41987659876', 'Google', 'Morno', 'Sem interesse', -3, null],
    ['Patrícia Gomes', '11943210987', 'WhatsApp', 'Muito quente', 'Agendamento pela IA', -2, 2, 'agendado'],
    ['Bruno Carvalho', '11932109876', 'Instagram', 'Quente', 'Atendeu', -2, 0, 'compareceu', 9800, 'Em Acompanhamento', 'Ortodontia'],
    ['Camila Rocha', '11921098765', 'Site', 'Muito frio', 'Número errado', -1, null],
    ['Diego Nascimento', '11910987654', 'Google', 'Quente', 'Aguardando Resposta', 0, 1],
  ];
  for (const [name, phone, origem, temp, status, created, prox, ag, valor, bst, trat] of people) {
    const r = await call('POST', '/leads', {
      name, phone, origem_id: id('origem', origem), temperatura: temp, status_id: id('status', status), created_at: `${day(created)} 09:${pad(10 + phone.length)}:00`,
      proximo_contato: prox == null ? null : `${day(prox)} 14:00:00`, anotacoes: prox != null && prox < 0 ? 'Retornar ligação, pediu horário à tarde.' : null,
      tags: origem === 'Indicação' ? [id('etiqueta', 'VIP')] : [],
    });
    const leadId = r.body.id;
    await call('POST', '/contacts', { lead_id: leadId, tipo: 'Chamada Telefônica', obs: 'Primeiro contato', date: `${day(created)} 10:00:00` });
    if (ag) {
      const a = await call('POST', '/appointments', { lead_id: leadId, date: day(ag === 'agendado' ? Math.abs(created) : created + 1), start: '15:00', profissional_id: id('profissional', 'Dr(a). Profissional 1') });
      if (ag !== 'agendado') await call('PUT', `/appointments/${a.body.id}`, { status: ag === 'compareceu' ? 'Compareceu' : 'Faltou' });
    }
    if (valor) {
      const lead = (await call('GET', `/leads/${leadId}`)).body.lead;
      await call('POST', '/budgets', { client_id: lead.client_id, valor_orcado: valor, valor_fechado: bst === 'Fechado' ? Math.round(valor * 0.92) : 0, status: bst,
        tratamento_id: id('tratamento', trat), avaliador_id: id('avaliador', 'Dr(a). Avaliador 1'), forma_pagamento: 'Cartão de Crédito', parcelas: 10, data_orcamento: day(created + 1) });
      await call('POST', '/activities', { client_id: lead.client_id, fase_id: id('fase', bst === 'Fechado' ? 'Fechado' : 'Negociação'), prob: bst === 'Fechado' ? 100 : 60,
        proximo_contato: bst === 'Fechado' ? null : `${day(1)} 11:00:00`, obs: bst === 'Fechado' ? 'Fechou o tratamento.' : 'Vai conversar com a família e retorna.' });
    }
  }
  await call('PUT', `/goals/${day(0).slice(0, 7)}`, { leads: 60, agendados: 30, compareceu: 20, fechados: 10, investimento: 3000, ticket_medio: 7000, valor_vendas: 70000 });
  const p = await call('POST', '/referrals', { name: 'Mariana Costa', phone: '31988776655', satisfacao: 10, prob_indicacao: 9, ultima_indicacao: day(-1), obs: 'Indicou a irmã e uma colega.' });
  await call('PUT', `/referrals/${p.body.id}`, { indicados: [{ name: 'Helena Costa', phone: '31977665544', data_indicacao: day(-1) }] });
  await call('POST', '/campaigns', { nome: 'Reativação de leads frios', descricao: 'Leads sem resposta há mais de 3 dias', cor: '#2563eb', data: day(2), hora: '10:00',
    chip_tipo: 'Comercial', template_id: 1, filtro: { status: [id('status', 'Não atende'), id('status', 'Aguardando Resposta')] } });
}

async function boot() {
  const SQL = await initSqlJs({ wasmBinary: b64ToBytes(WASM_B64) });
  const saved = await idb('readonly', (s) => s.get('db'));
  let timer = null;
  globalThis.__SQL__ = {
    SQL, data: saved || null,
    onWrite() {
      clearTimeout(timer);
      timer = setTimeout(() => { const bytes = globalThis.__SQL__.db.raw.export(); idb('readwrite', (s) => s.put(bytes, 'db')); }, 300);
    },
  };
  const app = require('../server/index.js');
  // Navegadores que já abriram a demonstração antes da troca de nome.
  if (saved) globalThis.__SQL__.db.raw.exec("UPDATE settings SET value=replace(replace(value,'Clínica Sorriso Exemplo','Exclusive Odontologia'),'Minha Clínica','Exclusive Odontologia') WHERE key IN ('clinica','ia')");

  let sid = lsGet('crm_sid');
  const call = async (method, url, body) => {
    const r = await app.handle({ method, url: '/api' + url, body, cookie: sid ? `sid=${sid}` : '' });
    const sc = r.headers['set-cookie'];
    if (sc) { const m = /^sid=([^;]*)/.exec(sc); sid = m && m[1] ? m[1] : null; lsSet('crm_sid', sid); }
    return r;
  };
  if (!saved) {
    await call('POST', '/login', { email: 'admin@clinica.com', password: 'admin123' });
    await seed(call);
    await call('POST', '/logout');
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api')) return realFetch(input, init);
    const r = await call((init.method || 'GET').toUpperCase(), url.slice(4), init.body ? JSON.parse(init.body) : undefined);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  window.__DEMO__ = {
    async reset() {
      await idb('readwrite', (s) => s.delete('db'));
      lsSet('crm_sid', null);
      location.reload();
    },
  };
  document.getElementById('app').innerHTML = '';
  await import('../public/js/app.js');
}
boot().catch((e) => {
  document.getElementById('app').innerHTML = `<div style="padding:24px">Não foi possível iniciar a demonstração: ${String(e.message || e)}</div>`;
  console.error(e);
});
