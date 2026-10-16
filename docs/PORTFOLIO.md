# Visão geral da carteira

GET /api/portfolio é autenticado e não altera dados. O administrador vê todos os clientes; operadores e aprovadores veem apenas os vínculos de client_members. A autorização é aplicada dentro da consulta SQL, inclusive nos agregados e na atividade. Não há novos grants, políticas públicas, views ou alterações de schema.

Uma única consulta agrega contas, campanhas, trabalhos e membros separadamente, evitando multiplicação dos totais. A atividade retorna até 50 registros por data e ID decrescentes, sem conteúdo de detail, erro bruto, e-mail, credenciais ou informações de armazenamento. A resposta é private, no-store.

Os indicadores são clientes autorizados, clientes precisando de atenção, campanhas para revisão e campanhas registradas como ativas. Atenção inclui conexões com status indisponível/reconexão, contas indisponíveis, falhas de importação, campanhas com erro/anúncio reprovado, trabalhos com falha da versão atual e ausência de conta vinculada. Falhas de versões antigas não entram nas prioridades. Propostas e estruturas pausadas entram em revisão.

As prioridades são ordenadas por conexão, campanha com erro/reprovação, execução com falha, configuração, revisão, estrutura aprovada e rascunho. Há até seis clientes nessa área; a lista completa permanece na carteira. Cada botão abre o cliente e a seção correspondente. A equipe exibida é a lista real de membros vinculados, não um responsável inferido.

Busca por nome ignora caixa e acentos. Os filtros Todos/Atenção/Revisão/Ativos afetam a lista de clientes; totais, prioridades e atividade são globais dentro da carteira autorizada. A atualização é explícita pelo botão Atualizar carteira e ao retornar à visão geral. Falhas não substituem dados existentes por zeros. Sem resultados e carteira vazia têm mensagens próprias.

Esta tela mostra o estado conhecido pelo painel. Não consulta a Meta ou Google em cada carregamento, não infere desempenho, testes ou escala, e não faz alterações em campanhas. Expiração de autorização passa a aparecer quando registrada pela sincronização/conector. ADS_PUBLISH_ENABLED e ADS_ACTIVATION_ENABLED permanecem false.

Validação: testes PostgreSQL de agregação sem duplicação, acesso por administrador/operador/aprovador, usuário sem clientes, limite e isolamento da auditoria, falhas de versão antiga e não exposição de segredos; testes de interface de busca, filtros, totais, navegação de prioridades, atualização com erro, estado vazio e celular; verificação da API real em leitura.
