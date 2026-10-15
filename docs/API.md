# API do painel — Meta WhatsApp

Sessões HttpOnly de 12 horas, perfis e acesso por cliente. Mutações exigem `Origin` igual a `APP_URL`. O navegador não recebe credenciais da Meta, do banco ou do S3. O worker é o único executor da fila: antigos endpoints `/api/internal/*` retornam 404 e não existe callback de orquestrador.

| Método | Rota `/api/...` | Função |
|---|---|---|
| GET | health | saúde do banco |
| POST | auth/login | `{email,password}` |
| POST | auth/logout | encerra sessão |
| GET | me | usuário/perfil |
| GET / POST | clients | listar / criar `{name}` |
| GET | users | IDs de usuários; administrador |
| POST | clients/:id/members | `{userId}`; administrador |
| GET | oauth/meta?clientId=... | inicia conexão oficial; administrador |
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

## Briefing

Schema vigente: `whatsappBriefingSchema` em `src/lib/domain.ts`. Mantém o envelope `channels` por compatibilidade, mas aceita exatamente uma entrada `platform=meta`, `kind=meta_whatsapp`. Campos: conta, orçamento, página, número com DDI, mensagem opcional, destino wa.me correspondente, chave geográfica da cidade e imagens. O telefone é normalizado antes de persistir. Não requer pixel, conversão nem formulário. Google e Meta formulário são rejeitados para novas campanhas e novas conexões Google estão desabilitadas.

Nome, oferta, cidade para conferência e período permanecem no nível principal. O fuso usado para a publicação vem da conta conectada. As configurações fixas de objetivo, otimização e audiência são mostradas na proposta e descritas no README.

## Execução interna, sem HTTP

`claimJob` → `runJob` → `executePublication` → `completeJob`/`failJob`. Aprovações, lease e versão são revalidados. Heartbeat de 30 segundos; lease de 10 minutos. Lock de sessão PostgreSQL impede executores concorrentes da mesma tarefa. O diário de operações preserva identificadores e bloqueia replay ambíguo.

## Compatibilidade futura

Dados antigos de Google, relatórios e métricas são preservados. O módulo de relatórios ainda possui endpoints autenticados `/clients/:id/reports`, `/reports/pdf` e `/reports/history`, mas não participa do fluxo inicial nem tem coleta automática configurada. Não considerar esses dados atualizados sem uma coleta explícita. A evolução desses módulos fica para uma etapa posterior.
