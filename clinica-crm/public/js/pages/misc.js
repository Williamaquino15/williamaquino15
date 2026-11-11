// Início, ajuda, atualizações e aulas.
import { state, esc, pageHeader, can, card } from '../core.js';

export async function home(view) {
  const tiles = [
    ['Leads', 'Cadastre e acompanhe potenciais clientes', '#/leads', 'leads'],
    ['Clientes', 'Pacientes, orçamentos e atividades', '#/clientes', 'clientes'],
    ['Gerenciar', 'Configurações, usuários e listas', '#/gerenciar'],
    ['Campanhas', 'Disparos agendados de WhatsApp', '#/disparo/campanhas'],
    ['Painel de Indicadores', 'Funil, metas e métricas do período', '#/dashboard', 'dashboard'],
    ['Relatórios', 'Relatórios de desempenho', '#/relatorios'],
  ].filter((t) => !t[3] || can(t[3]));
  view.innerHTML = `${pageHeader(`Olá, ${state.user.name.split(' ')[0]}!`, esc(state.clinica.nome || ''))}
    <div class="tiles">${tiles.map(([t, d, h]) => `<a class="tile" href="${h}"><h3>${esc(t)}</h3><p class="muted">${esc(d)}</p><span class="btn btn-sm btn-primary">Acessar</span></a>`).join('')}</div>`;
}

const FAQ = [
  ['Como cadastrar um lead?', 'Em Leads, clique em "+ Criar Lead". Use "Pesquisar" ao lado do nome para checar duplicidade. Se o telefone já existir, você pode reaquecer o lead existente.'],
  ['Como funciona a fila de Próximos Contatos?', 'Todo lead com "Próximo Contato" preenchido entra na fila, ordenada do mais antigo para o mais novo. Atrasados aparecem em vermelho.'],
  ['Quando um lead vira cliente?', 'Ao marcar um agendamento como "Compareceu", o lead é convertido automaticamente em cliente. Também é possível criar um cliente retroativo.'],
  ['Como registrar um fechamento parcial?', 'Na ficha do cliente, em Orçamentos, use o botão "＋" (Adicionar fechamento). O valor é somado ao fechado do orçamento.'],
  ['Como definir metas?', 'No Painel de Indicadores, em "Metas e vendas", escolha o mês e clique em "Definir metas". A projeção usa os dias configurados em "Configurar métricas".'],
  ['Como importar uma planilha?', 'Em Leads › Mais opções › Importar Leads (ou em Clientes › Importar Clientes). Salve a planilha como CSV; baixe o modelo para ver as colunas.'],
  ['Quem pode ver valores em R$?', 'Somente administradores ou usuários com a permissão "Acesso aos dados financeiros da Dashboard".'],
];
export async function ajuda(view) {
  view.innerHTML = `${pageHeader('Central de Ajuda', 'Perguntas frequentes')}
    ${card('Perguntas frequentes', FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join(''))}`;
}
export async function atualizacoes(view) {
  view.innerHTML = `${pageHeader('Últimas Atualizações')}${card('Versão 1.0', `<ul>
    <li>Leads com filtros avançados, ações em massa, importação e recuperação de excluídos.</li>
    <li>Ficha do lead com conversa, agendamentos, contatos, etiquetas e cadências.</li>
    <li>Clientes com orçamentos, fechamentos parciais e registro de atividades.</li>
    <li>Painel de indicadores com metas e projeção, agenda, indicação, campanhas e 10 relatórios.</li></ul>`)}`;
}
export async function aulas(view) {
  view.innerHTML = `${pageHeader('Aulas Gravadas')}${card('Treinamentos', '<p class="muted">Nenhuma aula cadastrada ainda. Adicione links de vídeos de treinamento da sua equipe aqui.</p>')}`;
}
export async function transmissao(view) {
  view.innerHTML = `${pageHeader('Transmissão ao vivo')}${card('Ao vivo', '<p class="muted">Nenhuma transmissão programada.</p>')}`;
}
