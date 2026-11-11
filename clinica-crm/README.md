# Clínica CRM

CRM de relacionamento com leads e pacientes para clínicas: leads, próximos contatos, clientes com orçamentos, agenda, programa de indicação, campanhas de WhatsApp, painel de indicadores com metas e 10 relatórios, com permissões por usuário.

Stack: Node.js + Express + SQLite (better-sqlite3) no servidor; interface web em JavaScript puro (ES modules), sem etapa de build. Instalável como app (PWA).

## Como rodar

Requisito: Node.js 18 ou superior.

```bash
cd clinica-crm
npm install
npm start
```

Abra http://localhost:3000 e entre com:

- E-mail: `admin@clinica.com`
- Senha: `admin123`

**Troque a senha em Perfil logo no primeiro acesso.** Para criar o administrador inicial com outros dados, defina as variáveis antes do primeiro `npm start`:

```bash
ADMIN_EMAIL=voce@clinica.com ADMIN_PASSWORD=umaSenhaForte npm start
```

Variáveis opcionais: `PORT` (padrão 3000), `DATA_DIR` (pasta do banco, padrão `./data`), `NODE_ENV=production` (cookie de sessão com `Secure`, exige HTTPS).

O banco fica em `data/crm.db`. Para backup, copie esse arquivo com o servidor parado.

## Testes

```bash
npm test
```

```bash
node tests/e2e.js
```

O primeiro testa a API (fluxo completo, relatórios, campanhas e permissões). O segundo usa Playwright para abrir todas as telas no navegador.

## Módulos

| Menu | O que faz |
|---|---|
| Home | Atalhos para os módulos |
| Painel de Indicadores | Funil Leads → Agendados → Comparecimentos → Fechamentos, valores (fechado, oportunidades, ticket médio, desconto), metas mensais com projeção e tabela diária. Filtros de período, origens, etiquetas e segmentação |
| Leads | Busca rápida, filtros avançados, ações em massa (editar/excluir selecionados ou todos do filtro), criar lead com checagem de duplicidade, reaquecimento de telefone repetido, importação CSV, recuperar excluídos, exportação |
| Ficha do Lead | Conversa por chip, pausar IA, modelos de mensagem, ligações, agendamentos, contatos, etiquetas, anotações e cadências (Limbo 1/2) |
| Próximos Contatos | Fila por data de retorno, atrasados em vermelho |
| Clientes | Lista com 20 filtros, contatos do dia, cliente retroativo, importação |
| Ficha do Cliente | Orçamentos (tratamento, avaliador, pagamento, parcelas), fechamentos parciais, registro de atividades (fase, probabilidade, próximo contato), mensagens, contatos |
| Indicação | Satisfação, probabilidade de indicação, indicados (viram leads com origem "Indicação") e pontuação |
| Agenda | Visões mês e semana, legenda de cores, bloqueios de horário, status do agendamento |
| Campanhas | Público por filtros, prévia, agendamento do disparo e acompanhamento (pendentes, concluídos, falhas) |
| Gerenciar | Perfil, pagamento, usuários e permissões, usuários vinculados, dados da clínica, regras de leads, integrações, IA de agendamento, listas (arrastar entre Padrões/Ativos/Desativados), grupos de origem, chips de WhatsApp, modelos de mensagem |
| Relatórios | Usuários por Ação, Leads por Status, Métricas de Origem, Métricas de Usuários, Ferramenta comercial, Leads Reaquecidos, Orçamentos Fechados, Comparecidos por Distância do Agendamento, Diagnóstico do Discador, Custos IA |

Toda lista tem paginação (4 a Todos), busca, ordenação por coluna, escolha de colunas visíveis e exportação para planilha (.xls) e .csv.

### Regras automáticas

- Agendamento marcado como **Compareceu** converte o lead em cliente.
- Criar agendamento muda o status do lead para "Agendado".
- Telefone já cadastrado: o sistema oferece **reaquecer** o lead existente (conta no relatório de Leads Reaquecidos).
- Campanhas agendadas são disparadas automaticamente quando chega a data/hora.
- Usuário desativado perde a sessão na hora e não é excluído.

### Permissões

Chaves por usuário: administrador, Leads, Clientes, Dashboard, dados financeiros da Dashboard e Aulas. Sem a chave financeira, os valores em R$ do painel não são enviados ao navegador.

## Integrações externas: o que falta

Estas partes têm tela e dados salvos, mas **não se conectam a serviços reais** sem desenvolvimento adicional e contas nos fornecedores:

- **WhatsApp**: mensagens e disparos de campanha ficam no histórico do sistema. O envio real exige a API do WhatsApp (por exemplo, WhatsApp Business Platform) e a troca da função `runCampaign`/envio de mensagens em `server/index.js` por chamadas a ela. O QR Code da tela de chips é ilustrativo.
- **IA de agendamento e voz**: os parâmetros são salvos; falta ligar um provedor de IA e de voz.
- **Clinicorp, Cloudia, ICOMBOT, Controle Odonto**: credenciais salvas; falta a sincronização com a API de cada um.
- **Pagamento**: cria pedidos "Pendente"; a cobrança exige um meio de pagamento.
- **Importação**: aceita CSV (no Excel: Salvar como › CSV).
