# Deploy do painel na Vercel com Supabase

## Estado da preparação

O repositório possui configuração de build Next.js para Vercel. Quando `VERCEL=1`, o Next usa a saída padrão da plataforma; Docker continua usando `standalone`.

O painel, a API e `campaignWorkflow` estão preparados para Vercel. O projeto principal escolhido é `autocampaign`, no repositório `rafaellustrec-tec/AutoCampaign`. Configurar `JOB_EXECUTOR=vercel` no ambiente desse projeto. Docker continua usando `JOB_EXECUTOR=native` e seu worker contínuo. Não executar o worker nativo com o Transaction pooler.

Não habilitar `ADS_PUBLISH_ENABLED` antes de validar banco, imagens, autorizações Meta e uma criação pausada em conta piloto. Compilar o Workflow não comprova a integração real com as contas de anúncios.

## Execução na Vercel

Depois de persistir uma criação/ativação aprovada, a API chama `start(campaignWorkflow, [jobId])`. Somente o ID é enviado ao Workflow; telefone, briefing, token e lease não são serializados na entrada/saída das etapas. Cada tentativa reivindica atomicamente o job específico com `SKIP LOCKED` e um novo lease. Uma invocação repetida não reutiliza o lease de outra execução. Esse caminho não usa advisory locks de sessão e pode utilizar o Transaction pooler.

O conector registra intenção e resultado de cada mutação Meta no PostgreSQL. O Workflow usa `sleep` durável durante o backoff. Se uma função for interrompida, a expiração do lease bloqueia replay automático e exige reconciliação; não se promete retomada automática de uma chamada Meta sem resposta. Cada etapa tem limite de 300 segundos, e campanhas com muitos materiais podem exigir conferência manual se excederem esse limite.

Definir `CRON_SECRET` com pelo menos 32 caracteres aleatórios. `/api/cron/jobs` exige `Authorization: Bearer <segredo>` e recupera até 20 jobs pendentes por chamada. O agendamento de segurança incluído é diário às 00:00 UTC; o envio normal acontece imediatamente após a ação aprovada. No plano Pro, configurar `* * * * *` em `vercel.json` para recuperar falhas de despacho a cada minuto. Sem isso, uma falha entre gravar o job e iniciar o Workflow pode aguardar até o próximo cron diário. Não agendar chamadas externas com o segredo na URL.

Se a API retornar `dispatchPending=true`, o job continua durável no banco, aguardando recuperação. O painel acompanha o status na tela de execuções. Confirmar Fluid compute, disponibilidade de Workflows, limite de função e Cron no projeto Vercel. As outras aplicações Vercel conectadas ao mesmo repositório não devem receber credenciais de produção.

## GitHub e Vercel

1. Usar um repositório privado exclusivo. Publicar somente arquivos do projeto; `.env*`, `artifacts/`, `.cloudfy.json`, `.vercel/` e `.supabase/` estão ignorados.
2. Importar esse repositório na Vercel, preset Next.js, diretório raiz do projeto, Node 24 (compatível com o ambiente validado). `vercel.json` define instalação e build.
3. Usar Preview com banco de testes separado. Não fornecer credenciais Meta ou banco de produção a previews de branches não confiáveis.
4. Configurar as variáveis de `.env.example` no servidor. `APP_URL` precisa ser a origem HTTPS estável do ambiente, sem barra final. Manter `ADS_PUBLISH_ENABLED=false`.
5. Não executar migrações nem criar usuários no comando de build. Essas operações são feitas uma vez, contra o ambiente identificado e autorizado.

## Supabase: banco

Usar projeto exclusivo para a aplicação. O sistema usa `pg` e autenticação própria; não precisa de chave `anon`, `service_role` ou Supabase Auth no navegador.

As migrações criam tabelas no schema padrão, incluindo `public.users`, que é diferente de `auth.users`. A migração `004_backend_only_rls.sql` habilita RLS nas tabelas da aplicação sem políticas públicas. A conexão do backend precisa usar o proprietário das tabelas ou um papel de servidor apropriado; `anon` e `authenticated` não acessam esses dados. As permissões por cliente continuam aplicadas pelo backend Next.js. Usar projeto exclusivo; opcionalmente desabilitar sua Data API. Não alterar a Data API de um projeto compartilhado com outros sistemas.

Para o painel na Vercel, copiar a URL do **Transaction pooler** em Connect no dashboard e usar em `DATABASE_URL`, com TLS e certificado válidos. Não desabilitar validação de certificado. Não usar prepared statements nomeados. O limite local é de duas conexões por instância na Vercel, configurável por `DB_POOL_MAX`; considerar a soma de instâncias no dimensionamento do banco.

Para migração, usar uma conexão direta ou Session pooler acessível pela máquina de provisionamento. O worker nativo atual também exige conexão direta/Session pooler por usar advisory lock de sessão; não executá-lo no Transaction pooler.

Provisionar com Node 24 e variáveis secretas em `.env.local` ignorado:

```powershell
node --env-file=.env.local --import tsx scripts/migrate.ts
node --env-file=.env.local --import tsx scripts/create-user.ts email@agencia.com Rafael admin
```

O segundo comando exige `INITIAL_PASSWORD` temporária no ambiente. Remover depois de criar o administrador.

Alternativa quando só houver acesso ao SQL Editor do projeto: executar `node scripts/prepare-supabase.mjs` e aplicar `artifacts/supabase-bootstrap.sql` com o proprietário do banco. O arquivo inclui as quatro migrações e registra `schema_migrations` na mesma transação; pode ser reaplicado e permanece compatível com o migrador CLI. Não contém credenciais. Ainda é necessário configurar `DATABASE_URL` no servidor e criar o administrador pelo comando de provisionamento.

## Supabase: imagens

Criar bucket privado `agency-assets`, limitado aos formatos e tamanhos aceitos pelo painel. Gerar credenciais S3 no dashboard e configurar somente no servidor:

- `S3_ENDPOINT`: endpoint S3 fornecido pelo projeto (termina em `/storage/v1/s3`).
- `S3_REGION`: região informada pelo Supabase.
- `S3_BUCKET`: `agency-assets`.
- `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`: credenciais S3; não substituir por chave pública ou `service_role`.

O navegador envia imagens por URLs assinadas. Validar PUT, HEAD, cópia para chave definitiva e GET com o armazenamento real antes de aceitar materiais no piloto. A compatibilidade S3 do Supabase não significa suporte irrestrito a todas as opções do AWS SDK.

## Validação após publicar

- `/` mostra login e `/demo` identifica a demonstração.
- `/api/me` sem sessão responde 401 em JSON.
- Login do administrador e cadastro de cliente funcionam no banco correto.
- Upload e confirmação de imagem funcionam sem tornar o bucket público.
- Criar e revisar briefing, gerar proposta e aprovar estrutura funcionam.
- Com publicação desabilitada, solicitar publicação permanece bloqueado.
- Com conta piloto autorizada: aprovação → job → Workflow → estrutura pausada. Confirmar o cron protegido, a tentativa duplicada e o tratamento de interrupção antes de ampliar.

Pendente de validação no ambiente real: configuração remota Supabase/Vercel, cron, execução do SDK hospedado, upload S3 e integração Meta da conta piloto. Os testes de integração locais usam PostgreSQL real e a API Meta simulada.

Referências: [conexões PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres), [compatibilidade S3](https://supabase.com/docs/guides/storage/s3/compatibility), [configuração Vercel](https://vercel.com/docs/project-configuration), [Workflows](https://vercel.com/docs/workflows).
