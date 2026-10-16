# API do painel — Meta WhatsApp

Sessões HttpOnly de 12 horas, perfis e acesso por cliente. Mutações exigem `Origin` igual a `APP_URL`. O navegador não recebe credenciais da Meta, do banco ou do S3. A fila é executada pelo worker nativo ou por Vercel Workflows. Antigos endpoints `/api/internal/*` retornam 404.

| Método | Rota `/api/...` | Função |
|---|---|---|
| GET | health | saúde do banco |
| POST | auth/login | `{email,password}` |
| POST | auth/logout | encerra sessão |
| GET | me | usuário/perfil |
| GET / POST | clients | listar / criar `{name}` |
| GET | users | IDs de usuários; administrador |
| POST | clients/:id/members | `{userId}`; administrador |
| GET | oauth/meta ou oauth/google | inicia conexão global; administrador; clientId opcional por compatibilidade |
| GET | connections | autorizações globais e status da importação, sem segredos; administrador |
| POST | connections/:id/sync | importa todas as contas autorizadas; administrador |
| GET | accounts | lista geral de contas salvas, com cliente opcional; administrador |
| POST | accounts/assign | `{assignments:[{accountId,clientId}]}`; lote atômico de até 500; administrador |
| GET | clients/:id/connections | autorizações, sem segredos |
| GET / POST | clients/:id/connections/:connectionId/accounts | listar autorizadas / vincular `{externalId}` |
| GET | clients/:id/accounts | contas vinculadas |
| GET / POST | clients/:id/assets | listar / iniciar upload `{name,contentType,size}`; resposta `{id,url}` |
| POST | clients/:id/assets/:assetId/confirm | confirma e congela a imagem enviada |
| GET / POST | clients/:id/campaigns | listar / salvar briefing |
| PUT | campaigns/:id | nova versão; invalida aprovação anterior |
| POST | campaigns/:id/propose | `{version}` gera proposta determinística |
| POST | campaigns/:id/approve | `{version}` aprova estrutura |
| POST | campaigns/:id/create | `{version}` enfileira criação pausada |
| POST | campaigns/:id/activate | `{version}` autoriza gasto e enfileira ativação |
| GET | clients/:id/jobs | execuções e erros sem lease token |
| POST | jobs/:id/retry | retenta falha sem operações ambíguas |
| GET | clients/:id/audit | histórico de ações |
| GET | cron/jobs | recuperação de jobs; exige Bearer CRON_SECRET; sem sessão de usuário |

## Briefing

Schema vigente: `whatsappBriefingSchema` em `src/lib/domain.ts`. Mantém o envelope `channels` por compatibilidade, mas aceita exatamente uma entrada `platform=meta`, `kind=meta_whatsapp`. Campos: conta vinculada ao cliente, orçamento, página, número com DDI, mensagem opcional, destino wa.me correspondente, chave geográfica da cidade e imagens. O telefone é normalizado antes de persistir. Não requer pixel, conversão nem formulário. Google e Meta formulário são rejeitados para novas campanhas; conexões Google permitem importar e vincular contas.

Nome, oferta, cidade para conferência e período permanecem no nível principal. O fuso usado para a publicação vem da conta conectada. As configurações fixas de objetivo, otimização e audiência são mostradas na proposta e descritas no README.

## Execução da fila

`claimJob` → `runJob` → `executePublication` → `completeJob`/`failJob`. Aprovações, lease e versão são revalidados. Heartbeat de 30 segundos; lease de 10 minutos. Lock de sessão PostgreSQL impede executores concorrentes da mesma tarefa. O diário de operações preserva identificadores e bloqueia replay ambíguo.

Na Vercel, `campaignWorkflow(jobId)` chama uma etapa que reivindica o job por ID e executa `runClaimedJob`. Esse caminho usa a reivindicação atômica em vez de lock de sessão. `sleep` durável respeita o backoff salvo no banco. A API dispara o Workflow depois de persistir o job; se o despacho falhar, retorna `dispatchPending=true` e o cron pode recuperar o pedido. A rota de recuperação é protegida por segredo e não aceita campanha, tokens ou payloads de publicação do navegador.

## Compatibilidade futura

Dados antigos de Google, relatórios e métricas são preservados. O módulo de relatórios ainda possui endpoints autenticados `/clients/:id/reports`, `/reports/pdf` e `/reports/history`, mas não participa do fluxo inicial nem tem coleta automática configurada. Não considerar esses dados atualizados sem uma coleta explícita. A evolução desses módulos fica para uma etapa posterior.
