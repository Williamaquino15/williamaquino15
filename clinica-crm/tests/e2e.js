// Teste de navegador: faz login, cria dados e abre todas as telas, falhando em qualquer erro de JS.
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-e2e-'));
const app = require('../server/index.js');

(async () => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const shotDir = process.env.SHOTS;
  const shot = async (n) => shotDir && page.screenshot({ path: path.join(shotDir, `${n}.png`), fullPage: false });

  await page.goto(base);
  await page.fill('input[name=email]', 'admin@clinica.com');
  await page.fill('input[name=password]', 'admin123');
  await page.click('button:has-text("Entrar")');
  await page.waitForSelector('.tiles');
  await shot('01-home');

  // Cria lead pela interface
  await page.goto(base + '/#/leads');
  await page.waitForSelector('.dt');
  await page.click('[data-new]');
  await page.fill('.modal [name=name]', 'Joana Teste');
  await page.fill('.modal [name=phone]', '11988887777');
  await page.selectOption('.modal [name=origem_id]', { label: 'Instagram' });
  await page.selectOption('.modal [name=temperatura]', 'Quente');
  await page.click('.modal button:has-text("Criar")');
  await page.waitForSelector('td:has-text("Joana Teste")');
  await shot('02-leads');

  // Ficha do lead: mensagem, agendamento e comparecimento
  await page.click('a:has-text("Joana Teste")');
  await page.waitForSelector('#msgIn');
  await page.fill('#msgIn', 'Olá Joana!');
  await page.click('[data-a=send]');
  await page.waitForSelector('.msg:has-text("Olá Joana!")');
  await page.click('[data-a=newag]');
  await page.fill('.modal [name=start]', '10:00');
  await page.selectOption('.modal [name=status]', 'Compareceu');
  await page.click('.modal button:has-text("Salvar")');
  await page.waitForSelector('a:has-text("Cliente #")');
  await shot('03-ficha-lead');

  // Ficha do cliente: orçamento fechado
  await page.click('a:has-text("Cliente #")');
  await page.waitForSelector('[data-a=newb]');
  await page.click('[data-a=newb]');
  await page.fill('.modal [name=valor_orcado]', '8000');
  await page.fill('.modal [name=valor_fechado]', '7200');
  await page.selectOption('.modal [name=status]', 'Fechado');
  await page.click('.modal button:has-text("Salvar")');
  await page.waitForSelector('td:has-text("Fechado")');
  await shot('04-ficha-cliente');

  const routes = ['/dashboard', '/leads/proximos', '/leads/recuperar-leads-excluidos', '/clientes', '/indicacao', '/agenda', '/disparo/campanhas',
    '/disparo/campanhas/criar', '/gerenciar', '/perfil', '/gerenciar/pagamento', '/usuarios', '/gerenciar/configuracoes', '/gerenciar/configuracao-ia',
    '/gerenciar/listas', '/gerenciar/grupos-de-origem', '/gerenciar/whatsapp', '/gerenciar/modelos', '/gerenciar/clinicas', '/relatorios',
    '/relatorios/usuarios', '/relatorios/leads', '/relatorios/origem', '/relatorios/usuarios-metricas', '/ferramenta-comercial',
    '/relatorios/leads-reaquecidos', '/relatorios/metricas-orcamentos-fechados', '/relatorios/metricas-comparecimento-por-agendamento',
    '/relatorios/diagnostico-discador', '/relatorios/relatorio-custo-ia', '/ajuda', '/atualizacoes', '/aulas', '/transmissao'];
  for (const r of routes) {
    await page.goto(base + '/#' + r);
    await page.waitForFunction(() => !document.querySelector('#view .loading') || document.querySelector('#dash'), null, { timeout: 8000 });
    await page.waitForTimeout(250);
    const txt = await page.textContent('#view');
    if (/Página não encontrada|^Erro/.test(txt) || txt.includes('Erro\n')) errors.push(`${r}: ${txt.slice(0, 120)}`);
    await shot('r' + r.replace(/\//g, '_'));
  }

  // Campanha pela interface
  await page.goto(base + '/#/disparo/campanhas/criar');
  await page.waitForSelector('#fBase');
  await page.fill('[name=nome]', 'Reativação Novembro');
  await page.selectOption('[name=template_id]', { index: 1 });
  await page.click('#ver');
  await page.waitForSelector('#publico td');
  await page.click('#criar');
  await page.waitForSelector('td:has-text("Reativação Novembro")');

  // Celular
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/#/leads');
  await page.waitForSelector('.dt');
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push('mobile: rolagem horizontal na página de leads');
  await shot('05-mobile-leads');

  await browser.close();
  server.close();
  if (errors.length) { console.error('FALHAS:\n' + errors.join('\n')); process.exit(1); }
  console.log(`OK: fluxo principal e ${routes.length} telas sem erros`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
