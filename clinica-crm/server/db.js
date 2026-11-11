// Banco de dados SQLite: schema, migração e dados iniciais.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, 'crm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, pass TEXT,
  active INTEGER DEFAULT 1, p_admin INTEGER DEFAULT 0, p_leads INTEGER DEFAULT 1,
  p_clientes INTEGER DEFAULT 1, p_dashboard INTEGER DEFAULT 0, p_financeiro INTEGER DEFAULT 0,
  p_aulas INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS linked_users (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), access TEXT DEFAULT 'Completo',
  status TEXT DEFAULT 'Ativo', created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- Listas configuráveis: origem, status, tratamento, fase, avaliador, etiqueta, status_agendamento, profissional, situacao
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, state TEXT DEFAULT 'ativo',
  grupo TEXT, color TEXT, sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT, cor TEXT, data TEXT, hora TEXT,
  chip_tipo TEXT, template_id INTEGER, filtro TEXT, status TEXT DEFAULT 'Agendada',
  created_at TEXT DEFAULT (datetime('now','localtime')), created_by INTEGER
);
CREATE TABLE IF NOT EXISTS campaign_targets (
  id INTEGER PRIMARY KEY, campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id INTEGER, status TEXT DEFAULT 'Pendente', sent_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY, nome TEXT, meta_id TEXT, categoria TEXT, idioma TEXT DEFAULT 'pt_BR', conteudo TEXT
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, created_at TEXT, name TEXT, ddi TEXT DEFAULT '+55', phone TEXT,
  phone_entrada TEXT, origem_id INTEGER, temperatura TEXT, status_id INTEGER, campanha_id INTEGER,
  proximo_contato TEXT, anotacoes TEXT, tags TEXT DEFAULT '[]', indicacao TEXT,
  ultimo_contato TEXT, client_id INTEGER, ia_pausada_por INTEGER,
  deleted_at TEXT, delete_reason TEXT, updated_at TEXT, updated_by INTEGER, created_by INTEGER
);
CREATE TABLE IF NOT EXISTS reheats (id INTEGER PRIMARY KEY, lead_id INTEGER, origem_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')));

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, lead_id INTEGER, date TEXT, start TEXT, end TEXT, profissional_id INTEGER,
  status TEXT DEFAULT 'Agendado', descricao TEXT, origem TEXT DEFAULT 'app', envio TEXT,
  integracao_erro INTEGER DEFAULT 0, confirmado_ia INTEGER DEFAULT 0, bloqueio INTEGER DEFAULT 0,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_by INTEGER, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY, lead_id INTEGER, client_id INTEGER, date TEXT, tipo TEXT, obs TEXT,
  call_center INTEGER DEFAULT 0, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, lead_id INTEGER, client_id INTEGER, chip INTEGER DEFAULT 1,
  direction TEXT DEFAULT 'out', content TEXT, kind TEXT DEFAULT 'text', template_id INTEGER,
  from_ia INTEGER DEFAULT 0, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cadences (
  id INTEGER PRIMARY KEY, lead_id INTEGER, limbo INTEGER, inicio TEXT, termino TEXT,
  user_id INTEGER, status TEXT DEFAULT 'Agendada', obs TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, lead_id INTEGER, created_at TEXT, name TEXT, ddi TEXT DEFAULT '+55', phone TEXT,
  profissao TEXT, sintomas TEXT, data_lead TEXT, data_comparecimento TEXT, ultima_consulta TEXT,
  origem_id INTEGER, responsavel_id INTEGER, fase_id INTEGER, situacao TEXT DEFAULT 'Em negociação',
  prob_fechamento INTEGER DEFAULT 0, proximo_contato TEXT, ultimo_contato TEXT, tentativas INTEGER DEFAULT 0,
  anotacoes TEXT, tags TEXT DEFAULT '[]', campanha_id INTEGER, updated_at TEXT, updated_by INTEGER,
  deleted_at TEXT, delete_reason TEXT
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  avaliador_id INTEGER, tratamento_id INTEGER, status TEXT DEFAULT 'Em Aberto',
  valor_orcado REAL DEFAULT 0, valor_fechado REAL DEFAULT 0, entrada INTEGER DEFAULT 0,
  forma_pagamento TEXT, valor_total REAL DEFAULT 0, parcelas INTEGER DEFAULT 1,
  data_orcamento TEXT, data_fechamento TEXT, inicio_tratamento TEXT, obs TEXT,
  followup_user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS budget_closings (
  id INTEGER PRIMARY KEY, budget_id INTEGER REFERENCES budgets(id) ON DELETE CASCADE,
  valor REAL, data TEXT, forma_pagamento TEXT, obs TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY, client_id INTEGER, date TEXT, fase_id INTEGER, prob INTEGER,
  proximo_contato TEXT, obs TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS referral_patients (
  id INTEGER PRIMARY KEY, name TEXT, phone TEXT, lead_id INTEGER, client_id INTEGER,
  satisfacao INTEGER, prob_indicacao INTEGER, ultima_indicacao TEXT, data_agendamento TEXT,
  obs TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY, patient_id INTEGER REFERENCES referral_patients(id) ON DELETE CASCADE,
  name TEXT, phone TEXT, data_indicacao TEXT, data_comparecimento TEXT, lead_id INTEGER
);

CREATE TABLE IF NOT EXISTS goals (month TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, codigo TEXT, plano TEXT, status TEXT DEFAULT 'Pendente',
  valor REAL, link TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS chips (
  id INTEGER PRIMARY KEY, nome TEXT, tipo TEXT, numero TEXT, status TEXT DEFAULT 'Desconectado', updated_at TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, user_id INTEGER, entity TEXT, entity_id INTEGER, action TEXT,
  field TEXT, old_value TEXT, new_value TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ia_interactions (
  id INTEGER PRIMARY KEY, lead_id INTEGER, client_id INTEGER, pausas INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS ix_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS ix_appt_lead ON appointments(lead_id);
CREATE INDEX IF NOT EXISTS ix_contacts_lead ON contacts(lead_id);
CREATE INDEX IF NOT EXISTS ix_budgets_client ON budgets(client_id);
`);

const getSetting = (k, def) => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
  return r ? JSON.parse(r.value) : def;
};
const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@clinica.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare(`INSERT INTO users(name,email,pass,p_admin,p_leads,p_clientes,p_dashboard,p_financeiro,p_aulas)
              VALUES(?,?,?,1,1,1,1,1,1)`).run('Administrador', adminEmail, hashPassword(adminPass));

  const ins = db.prepare('INSERT INTO lists(type,name,state,grupo,color,sort) VALUES(?,?,?,?,?,?)');
  const add = (type, names, state = 'padrao', grupoFn) =>
    names.forEach((n, i) => ins.run(type, n, state, grupoFn ? grupoFn(n) : null, null, i));
  const grupoOrigem = (n) => ({ Facebook: 'Facebook', Instagram: 'Facebook', Google: 'Google', Site: 'Marketing',
    WhatsApp: 'Marketing', Indicação: 'Não marketing', Passante: 'Não marketing', 'Número inválido': 'Inválidos' }[n] || 'Marketing');
  add('origem', ['Facebook', 'Instagram', 'Google', 'Site', 'WhatsApp', 'Indicação', 'Passante', 'Número inválido'], 'padrao', grupoOrigem);
  add('status', ['Aguardando Resposta', 'Atendeu', 'Não atende', 'Sem interesse', 'Agendado', 'Agendamento pela IA', 'Número errado']);
  add('tratamento', ['Alinhador', 'Geral', 'HOF', 'Implantes', 'Lentes', 'Ortodontia', 'Prótese Móvel', 'Protocolo', 'Reabilitação']);
  add('fase', ['Pós-avaliação', 'Negociação', 'Aguardando retorno', 'Fechado', 'Perdido']);
  add('avaliador', ['Dr(a). Avaliador 1', 'Dr(a). Avaliador 2']);
  add('profissional', ['Dr(a). Profissional 1', 'Dr(a). Profissional 2']);
  add('etiqueta', ['VIP', 'Retorno', 'Urgente', 'Convênio']);
  add('status_agendamento', ['Agendado', 'Confirmado', 'Compareceu', 'Faltou', 'Desmarcado', 'Remarcado']);
  add('situacao', ['Em negociação', 'Fechado', 'Perdido', 'Em tratamento', 'Finalizado']);

  db.prepare('INSERT INTO templates(nome,meta_id,categoria,idioma,conteudo) VALUES(?,?,?,?,?)').run(
    'Reativação', 'tpl_reativacao', 'MARKETING', 'pt_BR', 'Olá {{nome}}! Sentimos sua falta. Que tal agendar uma avaliação?');
  db.prepare('INSERT INTO templates(nome,meta_id,categoria,idioma,conteudo) VALUES(?,?,?,?,?)').run(
    'Lembrete de consulta', 'tpl_lembrete', 'UTILITY', 'pt_BR', 'Olá {{nome}}, lembrando da sua consulta em {{data}} às {{hora}}.');
  for (let i = 1; i <= 3; i++) db.prepare('INSERT INTO chips(id,nome,tipo) VALUES(?,?,?)').run(i, `Chip ${i}`, i === 1 ? 'Agendamento' : 'Comercial');

  setSetting('clinica', { nome: 'Minha Clínica', fantasia: '', email: '', cnpj: '', telefone: '', endereco: '', cidade: '', estado: '', cep: '' });
  setSetting('leads', { telefone_obrigatorio: true, repetir_nome: true, temperatura_manual: true, duracao_agendamento: 30 });
  setSetting('integracoes', { cloudia: { link: '', sobrescrever: false }, clinicorp: { ativo: false, usuario: '', token: '', clinica: '', categorias: '' }, icombot: { ativo: false }, controle_odonto: { ativo: false } });
  setSetting('ia', { nome: 'Minha Clínica', secretaria: 'Ana', cidade: '', estado: '', dias_agendar: 7 });
  setSetting('metricas', { dias: [1, 2, 3, 4, 5] });
}
seed();

module.exports = { db, hashPassword, checkPassword, getSetting, setSetting };
