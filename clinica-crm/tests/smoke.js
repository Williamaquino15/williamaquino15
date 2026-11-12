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

    // sincronização Clinicorp: importa, reimporta sem duplicar e liga agendamento/orçamento ao paciente
    const lote = {
      pacientes: [{ id: 'P1', nome: 'Paciente Clinicorp', telefone: '(11) 97777-1111', origem: 'Google' }],
      agendamentos: [{ id: 'A1', paciente_id: 'P1', data: today, inicio: '09:00', fim: '09:30', status: 'Atendido' }],
      orcamentos: [{ id: 'O1', paciente_id: 'P1', data: today, status: 'Aprovado', valor_orcado: 'R$ 3.500,00' }, { id: 'O2', paciente_id: 'X', valor_orcado: 1 }],
    };
    const s1 = (await A('POST', '/sync/import', lote)).body;
    assert.deepStrictEqual([s1.novos, s1.erros], [3, 1], 'importa e aponta o orçamento sem paciente');
    const s2 = (await A('POST', '/sync/import', lote)).body;
    assert.deepStrictEqual([s2.novos, s2.atualizados], [0, 3], 'reimportar não duplica');
    const pc = (await A('GET', '/clients')).body.find((c) => c.name === 'Paciente Clinicorp');
    assert.strictEqual(pc.valor_fechado, 3500, 'orçamento aprovado entra como fechado');
    const run = await A('POST', '/sync/run');
    assert.strictEqual(run.status, 500);
    assert.match(run.body.error, /credenciais/);
    // paciente só com agendamento entra como lead; depois, com orçamento, vira cliente sem duplicar
    const l2 = { pacientes: [{ id: 'tel:11966665555', nome: 'Só Agendou', telefone: '11966665555', tipo: 'lead' }],
      agendamentos: [{ id: 'A2', paciente_id: 'tel:11966665555', data: today, inicio: '10:00', status: 'Agendado' }] };
    assert.strictEqual((await A('POST', '/sync/import', l2)).body.erros, 0);
    assert.ok(!(await A('GET', '/clients')).body.some((c) => c.name === 'Só Agendou'), 'só agendou = lead');
    const l3 = { pacientes: [{ id: '900', nome: 'Só Agendou', telefone: '+55 11 96666-5555', tipo: 'cliente' }], orcamentos: [{ id: 'O9', paciente_id: '900', valor_orcado: 100 }] };
    assert.strictEqual((await A('POST', '/sync/import', l3)).body.erros, 0);
    assert.strictEqual((await A('GET', '/leads?q=' + encodeURIComponent('Só Agendou'))).body.length, 1, 'não duplica o lead');
    assert.ok((await A('GET', '/clients')).body.some((c) => c.name === 'Só Agendou'), 'com orçamento vira cliente');
    const stt = (await A('GET', '/sync/status')).body;
    assert.strictEqual(stt.execucoes.find((r) => r.origem === 'clinicorp').status, 'Falhou');
    assert.strictEqual(stt.vinculados.pacientes, 2);

    console.log('OK: testes de API passaram');
  } catch (e) {
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    server.close();
    setTimeout(() => process.exit(), 50);
  }
})();
