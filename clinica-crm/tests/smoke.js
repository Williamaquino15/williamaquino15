// Teste de API: fluxo lead → agendamento → cliente → orçamento, relatórios, campanhas e permissões.
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-smoke-'));
const app = require('../server/index.js');

async function session(base, email, password) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.strictEqual(r.status, 200, `login ${email}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (method, url, body) => {
    const x = await fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    return { status: x.status, body: await x.json() };
  };
}

(async () => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@clinica.com', password: 'x' }) });
    assert.strictEqual(bad.status, 401);
    assert.strictEqual((await fetch(`${base}/api/leads`)).status, 401);

    const A = await session(base, 'admin@clinica.com', 'admin123');
    const l1 = await A('POST', '/leads', { name: 'Maria', phone: '(11) 99999-0000', origem_id: 1 });
    assert.ok(l1.body.id);
    const dup = await A('POST', '/leads', { name: 'Maria 2', phone: '11999990000' });
    assert.ok(dup.body.duplicate, 'detecta telefone repetido');
    const re = await A('POST', '/leads', { name: 'Maria 2', phone: '11999990000', reaquecer: true });
    assert.ok(re.body.reaquecido);
    assert.strictEqual((await A('POST', '/leads', { name: '', phone: '1' })).status, 400);

    const ap = await A('POST', '/appointments', { lead_id: l1.body.id, date: today, start: '10:00' });
    assert.strictEqual(ap.body.end, '10:30', 'duração padrão');
    await A('PUT', `/appointments/${ap.body.id}`, { status: 'Compareceu' });
    const clients = (await A('GET', '/clients')).body;
    assert.strictEqual(clients.length, 1, 'comparecimento cria cliente');
    const det = await A('POST', '/budgets', { client_id: clients[0].id, valor_orcado: 5000, status: 'Em Aberto' });
    await A('POST', `/budgets/${det.body.budgets[0].id}/closings`, { valor: 2000 });
    const after = (await A('GET', `/clients/${clients[0].id}`)).body;
    assert.strictEqual(after.budgets[0].valor_fechado, 2000, 'fechamento parcial');
    assert.strictEqual(after.budgets[0].status, 'Fechado');

    const dash = (await A('GET', '/dashboard')).body;
    assert.deepStrictEqual(dash.funil.map((f) => f.qtd), [1, 1, 1, 1]);
    assert.strictEqual(dash.financeiro.valor_fechado, 2000);

    for (const n of ['usuarios', 'leads', 'origem', 'usuarios-metricas', 'ferramenta-comercial', 'leads-reaquecidos', 'metricas-orcamentos-fechados',
      'metricas-comparecimento-por-agendamento', 'diagnostico-discador', 'relatorio-custo-ia']) {
      assert.strictEqual((await A('GET', `/reports/${n}`)).status, 200, `relatório ${n}`);
    }
    assert.strictEqual((await A('GET', '/reports/leads-reaquecidos')).body[0].qtd, 1);

    const camp = await A('POST', '/campaigns', { nome: 'T', template_id: 1, chip_tipo: 'Comercial', data: today, hora: '23:59', filtro: {} });
    assert.strictEqual(camp.body.total, 1);
    assert.strictEqual((await A('POST', `/campaigns/${camp.body.id}/run`)).body.sent, 1);

    // exclusão e recuperação
    assert.strictEqual((await A('DELETE', `/leads/${l1.body.id}`, {})).status, 400, 'exige motivo');
    await A('DELETE', `/leads/${l1.body.id}`, { reason: 'teste' });
    assert.strictEqual((await A('GET', '/leads/deleted')).body.length, 1);
    await A('POST', '/leads/restore', { ids: [l1.body.id] });
    assert.strictEqual((await A('GET', '/leads')).body.length, 1);

    // permissões
    const u = await A('POST', '/users', { name: 'Vendedor', email: 'v@x.com', password: '123456', confirm: '123456', p_leads: 1, p_dashboard: 1 });
    assert.ok(u.body.id);
    const V = await session(base, 'v@x.com', '123456');
    assert.strictEqual((await V('GET', '/leads')).status, 200);
    assert.strictEqual((await V('GET', '/clients')).status, 403, 'sem acesso a clientes');
    assert.strictEqual((await V('GET', '/users')).status, 403, 'sem acesso a usuários');
    assert.strictEqual((await V('GET', '/dashboard')).body.financeiro, null, 'sem dados financeiros');
    assert.strictEqual((await V('PUT', '/settings/clinica', { nome: 'x' })).status, 403);
    await A('PUT', `/users/${u.body.id}`, { active: 0 });
    assert.strictEqual((await V('GET', '/leads')).status, 401, 'desativado perde a sessão');

    console.log('OK: testes de API passaram');
  } catch (e) {
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    server.close();
    setTimeout(() => process.exit(), 50);
  }
})();
